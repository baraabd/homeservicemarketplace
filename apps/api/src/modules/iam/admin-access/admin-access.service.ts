import { Injectable, Logger } from '@nestjs/common';
import type {
  AdminAccessRequestStatus as ContractStatus,
  AdminAccessRequestReviewItem,
  AdminAccessRequestSummary,
  AdminUserStatus,
  ListAdminAccessRequestsQuery,
  ListAdminAccessRequestsResponse,
  MyAdminAccessResponse,
} from '@homeservicemarketplace/contracts';
import type {
  AdminAccessRequest,
  AdminAccessRequestStatus,
} from '@homeservicemarketplace/database';

import {
  AdminAccessRequestRepository,
  type AdminAccessRequestWithApplicant,
} from '../../../infrastructure/persistence/iam/admin-access-request.repository';
import { RoleRepository } from '../../../infrastructure/persistence/iam/role.repository';
import { SessionRepository } from '../../../infrastructure/persistence/iam/session.repository';
import { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { SecurityEventsBus } from '../../../shared/security-events/security-events.bus';
import { AppError } from '../../../shared/errors/app-error';
import { AuditService } from '../audit/audit.service';

export const ADMIN_ROLE_NAME = 'admin';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_JUSTIFICATION_LENGTH = 2000;

// Phase 4 — the admin ACCESS-REQUEST lifecycle.
//
// ── The rule this exists to enforce ──────────────────────────────────────────
// A public signup must NEVER grant the admin role. Signing up through the
// Admin-themed entry point produces an ordinary verified User identity, exactly
// like any other signup. If that person wants admin access they submit an
// explicit request, and a DIFFERENT, currently authorized administrator grants
// it. Nothing a client can send — not a theme, not a role field, not a status —
// short-circuits that.
//
// ── Why this is a separate axis ──────────────────────────────────────────────
// The platform has three independent account axes and screens kept collapsing
// them, which is how a user ended up being described as "Admin active" purely
// because `User.status === ACTIVE`:
//
//   1. User.status / isActive     — may this identity authenticate?
//   2. UserRole                   — what may it do?
//   3. AdminAccessRequest.status  — where does its request for admin stand?
//
// This service owns (3) and is the only thing that writes (2) for the admin
// role.
//
// ── Invariants ───────────────────────────────────────────────────────────────
//   - No self-review: a reviewer may never decide their own request, even
//     while holding the required permission.
//   - One PENDING request per user at a time, enforced inside the insert
//     transaction.
//   - Every transition is transactional and audited.
//   - Approval grants ONLY the admin role. It never creates or activates a
//     ProviderProfile — that is a different axis with its own review.
//   - Approval revokes the applicant's sessions, so the new role is picked up
//     from a freshly issued token rather than waiting for the old one to
//     expire (RolesGuard reads the token's role claim).
@Injectable()
export class AdminAccessService {
  private readonly logger = new Logger(AdminAccessService.name);

  constructor(
    private readonly requests: AdminAccessRequestRepository,
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
    private readonly securityEvents: SecurityEventsBus,
  ) {}

  // ─── Applicant side ────────────────────────────────────────────────────────

  /**
   * GET /v1/me/admin-access — the signed-in user's own admin standing.
   *
   * Returns `hasAdminRole` explicitly so no screen has to infer admin standing
   * from the account status. "My account is ACTIVE" and "I have admin access"
   * are different questions.
   */
  async getMine(userId: string): Promise<MyAdminAccessResponse> {
    const [roleRows, latest] = await Promise.all([
      this.users.listRoles(userId),
      this.requests.findLatestByUserId(userId),
    ]);
    const hasAdminRole = roleRows.some((r) => r.role.name === ADMIN_ROLE_NAME);
    const isPending = latest?.status === 'PENDING';

    return {
      hasAdminRole,
      latestRequest: latest ? toApplicantSummary(latest) : null,
      isPending,
      // Nothing to request if they already hold the role, and no second
      // request while one is outstanding.
      canSubmit: !hasAdminRole && !isPending,
    };
  }

  /**
   * POST /v1/me/admin-access — submit a request. Grants nothing.
   */
  async submit(
    userId: string,
    input: { justification?: string },
  ): Promise<AdminAccessRequestSummary> {
    const justification = normalizeJustification(input.justification);

    const created = await this.tx.run(async (trx) => {
      const user = await this.users.findById(userId, trx);
      if (!user) throw new AppError('NOT_FOUND', 'User not found.', 404);

      // An unverified identity must not be able to queue for admin access —
      // otherwise anyone who can reach the signup form can occupy the review
      // queue with addresses they do not control.
      if (user.emailVerifiedAt === null) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Verify your email address before requesting admin access.',
          400,
        );
      }

      const roleRows = await this.users.listRoles(userId, trx);
      if (roleRows.some((r) => r.role.name === ADMIN_ROLE_NAME)) {
        throw new AppError('CONFLICT', 'This account already has admin access.', 409);
      }

      // One PENDING request at a time, checked inside the transaction so two
      // concurrent submissions cannot both pass the check.
      const pending = await this.requests.findPendingByUserId(userId, trx);
      if (pending) {
        throw new AppError('CONFLICT', 'An admin access request is already pending.', 409);
      }

      const row = await this.requests.create({ userId, justification }, trx);
      await this.audit.record(
        {
          type: 'ADMIN_ACCESS_REQUESTED',
          userId,
          metadata: { requestId: row.id },
        },
        trx,
      );
      return row;
    });

    return toApplicantSummary(created);
  }

  /**
   * POST /v1/me/admin-access/cancel — withdraw an outstanding request.
   */
  async cancelMine(userId: string): Promise<AdminAccessRequestSummary> {
    const updated = await this.tx.run(async (trx) => {
      const pending = await this.requests.findPendingByUserId(userId, trx);
      if (!pending) {
        throw new AppError('NOT_FOUND', 'No pending admin access request.', 404);
      }
      const count = await this.requests.decideIfPending(
        pending.id,
        // Cancellation is the applicant's own act, so there is no reviewer to
        // record and no decision note to write.
        { status: 'CANCELLED', decidedByUserId: null, decisionNote: null },
        trx,
      );
      if (count === 0) {
        // Someone decided it between the read and the write.
        throw new AppError('CONFLICT', 'This request has already been decided.', 409);
      }
      await this.audit.record(
        { type: 'ADMIN_ACCESS_CANCELLED', userId, metadata: { requestId: pending.id } },
        trx,
      );
      const fresh = await this.requests.findById(pending.id, trx);
      if (!fresh) throw new AppError('INTERNAL_ERROR', 'Failed to reload request.', 500);
      return fresh;
    });

    return toApplicantSummary(updated);
  }

  // ─── Reviewer side ─────────────────────────────────────────────────────────

  async listForReview(
    query: ListAdminAccessRequestsQuery,
  ): Promise<ListAdminAccessRequestsResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    // Default to the review queue rather than every request ever made.
    const status = (query.status ?? 'PENDING') as AdminAccessRequestStatus;
    const rows = await this.requests.listForReview({
      status,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    return {
      items: page.map(toReviewItem),
      nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async detail(id: string): Promise<AdminAccessRequestReviewItem> {
    const row = await this.requests.findById(id);
    if (!row) throw new AppError('NOT_FOUND', 'Admin access request not found.', 404);
    return toReviewItem(row);
  }

  /**
   * Approve. Grants the MINIMUM admin role and nothing else.
   */
  async approve(
    reviewerUserId: string,
    requestId: string,
    input: { decisionNote?: string },
  ): Promise<AdminAccessRequestReviewItem> {
    return this.decide(reviewerUserId, requestId, 'APPROVED', input.decisionNote);
  }

  async reject(
    reviewerUserId: string,
    requestId: string,
    input: { decisionNote?: string },
  ): Promise<AdminAccessRequestReviewItem> {
    return this.decide(reviewerUserId, requestId, 'REJECTED', input.decisionNote);
  }

  private async decide(
    reviewerUserId: string,
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    decisionNote: string | undefined,
  ): Promise<AdminAccessRequestReviewItem> {
    const note = normalizeJustification(decisionNote);

    const { row, granted } = await this.tx.run(async (trx) => {
      const existing = await this.requests.findById(requestId, trx);
      if (!existing) throw new AppError('NOT_FOUND', 'Admin access request not found.', 404);

      // No self-review. Holding the permission is not the same as being
      // allowed to grant yourself the role it protects — that would make the
      // whole review step a formality for anyone who ever gets it once.
      if (existing.userId === reviewerUserId) {
        throw new AppError('FORBIDDEN', 'You cannot decide your own admin access request.', 403);
      }

      if (existing.status !== 'PENDING') {
        throw new AppError('CONFLICT', 'This request has already been decided.', 409);
      }

      // Approving access for an account that cannot authenticate (suspended,
      // locked, deleted) would create a dormant admin grant that springs to
      // life if the account is ever restored. Refuse, and make the reviewer
      // deal with the account axis first.
      const applicantOk =
        existing.user &&
        existing.user.isActive &&
        existing.user.status === 'ACTIVE' &&
        existing.user.emailVerifiedAt !== null;
      if (decision === 'APPROVED' && !applicantOk) {
        throw new AppError(
          'VALIDATION_ERROR',
          'The applicant account must be active and verified before admin access can be granted.',
          400,
        );
      }

      const count = await this.requests.decideIfPending(
        requestId,
        { status: decision, decidedByUserId: reviewerUserId, decisionNote: note },
        trx,
      );
      if (count === 0) {
        // Lost the race with a concurrent reviewer.
        throw new AppError('CONFLICT', 'This request has already been decided.', 409);
      }

      let didGrant = false;
      if (decision === 'APPROVED') {
        const adminRole = await this.roles.findByName(ADMIN_ROLE_NAME, trx);
        if (!adminRole) {
          // Catalog row missing — cannot self-heal, and silently "approving"
          // without granting anything would be worse than failing.
          throw new AppError(
            'INTERNAL_ERROR',
            'Admin role is not configured. Run the database seed.',
            500,
          );
        }
        // ONLY the admin role. No provider role, no ProviderProfile — those
        // are a separate axis with their own review.
        await this.users.assignRole(existing.userId, adminRole.id, trx);
        // The role claim lives in the access token, so the grant is not
        // visible to RolesGuard until a new token is minted. Revoking the
        // applicant's sessions in the SAME transaction forces re-authentication
        // and makes the role change authoritative rather than eventual.
        await this.sessions.revokeAllForUser(existing.userId, trx);
        didGrant = true;
      }

      await this.audit.record(
        {
          type: decision === 'APPROVED' ? 'ADMIN_ACCESS_APPROVED' : 'ADMIN_ACCESS_REJECTED',
          userId: existing.userId,
          metadata: {
            requestId,
            reviewerUserId,
            ...(note ? { reason: note } : {}),
          },
        },
        trx,
      );

      const fresh = await this.requests.findById(requestId, trx);
      if (!fresh) throw new AppError('INTERNAL_ERROR', 'Failed to reload request.', 500);
      return { row: fresh, granted: didGrant };
    });

    if (granted) {
      // Post-commit. Sessions were revoked inside the transaction, so REST is
      // already enforcing it; this tears down live sockets, which have no
      // per-message re-auth and would otherwise keep a pre-grant identity
      // (including its room membership) attached.
      this.securityEvents.emitAllSessionsRevoked({ userId: row.userId, reason: 'roles-changed' });
      this.securityEvents.emitRolesChanged({ userId: row.userId });
      this.logger.log({
        msg: 'admin-access.granted',
        requestId,
        reviewerUserId,
      });
    }

    return toReviewItem(row);
  }
}

// ─── mappers ─────────────────────────────────────────────────────────────────

// Applicant-facing view. Deliberately omits `decidedByUserId`: the applicant
// does not need to know which administrator reviewed them, and exposing it
// would leak the operator roster to anyone who can submit a request.
function toApplicantSummary(row: AdminAccessRequest): AdminAccessRequestSummary {
  return {
    id: row.id,
    status: row.status as ContractStatus,
    justification: row.justification,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Reviewer-facing view. Carries the three axes side by side so the review
// screen cannot collapse them into one "status" column.
function toReviewItem(row: AdminAccessRequestWithApplicant): AdminAccessRequestReviewItem {
  return {
    id: row.id,
    status: row.status as ContractStatus,
    justification: row.justification,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decidedByUserId: row.decidedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    applicant: {
      id: row.user.id,
      email: row.user.email,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      accountStatus: row.user.status as AdminUserStatus,
      roles: row.user.userRoles.map((ur) => ur.role.name),
      emailVerifiedAt: row.user.emailVerifiedAt ? row.user.emailVerifiedAt.toISOString() : null,
    },
  };
}

function normalizeJustification(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (value.length === 0) return null;
  return value.slice(0, MAX_JUSTIFICATION_LENGTH);
}
