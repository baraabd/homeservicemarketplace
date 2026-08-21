import { Injectable } from '@nestjs/common';
import type {
  AdminUserMutationResponse,
  AdminUserSummary,
  ListAdminRolesResponse,
  ListAdminUsersQuery,
  ListAdminUsersResponse,
  UpdateUserStatusRequest,
} from '@homeservicemarketplace/contracts';
import type { AccountStatus, AuditEventType, User } from '@homeservicemarketplace/database';

import { AdminAccessRequestRepository } from '../../../infrastructure/persistence/iam/admin-access-request.repository';
import { RoleRepository } from '../../../infrastructure/persistence/iam/role.repository';
import { SessionRepository } from '../../../infrastructure/persistence/iam/session.repository';
import { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { SecurityEventsBus } from '../../../shared/security-events/security-events.bus';
import { AppError } from '../../../shared/errors/app-error';
import { AdminAuditService } from '../admin-audit.service';

const DEFAULT_PAGE_SIZE = 50;

// Sprint 6.1 — admin user control. List / search / suspend / restore.
// Soft-delete is intentionally NOT exposed here (admin should not be
// able to nuke a user account from the UI; that path is reserved for
// the user themselves via the deactivate-my-account flow). Suspending
// blocks login (isActive=false + status=SUSPENDED); restoring puts
// the account back to ACTIVE.
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly audit: AdminAuditService,
    private readonly tx: TransactionRunner,
    private readonly sessions: SessionRepository,
    // Phase 4 — axis 3. Read alongside status and roles so the dashboard
    // renders three columns instead of inferring admin standing from one.
    private readonly adminAccessRequests: AdminAccessRequestRepository,
    // D-2/D-4: the per-request session check reads Postgres directly, so no
    // cache needs busting after a status flip — the in-transaction session
    // revoke below is immediately authoritative on every instance. What the
    // bus is still needed for is tearing down live WebSockets, which have no
    // per-message re-auth.
    private readonly securityEvents: SecurityEventsBus,
  ) {}

  async list(query: ListAdminUsersQuery): Promise<ListAdminUsersResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    // `query` (Sprint 6.1 canonical) wins when both are set; falls
    // back to the legacy `q` so existing callers keep working.
    const searchTerm = (query.query ?? query.q)?.trim() || undefined;
    const rows = await this.users.searchForAdmin({
      q: searchTerm,
      status: query.status,
      roleName: query.role,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items = await Promise.all(page.map((u) => this.toSummary(u)));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async listRoles(): Promise<ListAdminRolesResponse> {
    const roleRows = await this.roles.listAll();
    return {
      items: roleRows.map((r) => ({ id: r.id, name: r.name, description: r.description })),
    };
  }

  async detail(userId: string): Promise<AdminUserSummary> {
    const u = await this.users.findById(userId);
    if (!u) throw new AppError('NOT_FOUND', 'User not found.', 404);
    return this.toSummary(u);
  }

  // Sprint 6.1 canonical PATCH path. Unified replacement for the
  // suspend / restore POST pair. `status` is one of ACTIVE,
  // SUSPENDED, LOCKED — the wire DTO refuses PENDING_VERIFICATION
  // and DELETED. Self-protection: an admin cannot flip themselves
  // to anything other than ACTIVE (i.e., they can't lock themselves
  // out of the dashboard mid-session).
  async setStatus(
    adminUserId: string,
    targetUserId: string,
    body: UpdateUserStatusRequest,
  ): Promise<AdminUserMutationResponse> {
    const nextStatus = body.status as AccountStatus;
    if (adminUserId === targetUserId && nextStatus !== 'ACTIVE') {
      throw new AppError('VALIDATION_ERROR', 'Admins cannot disable their own account.', 400);
    }
    const isActive = nextStatus === 'ACTIVE';
    const updated = await this.tx.run(async (tx) => {
      const existing = await this.users.findById(targetUserId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'User not found.', 404);
      // Idempotent: if the target already has the requested status,
      // skip the write but still emit an audit row so the operator's
      // intent is captured. This stops an accidental double-click
      // from creating two state-flip rows for one action.
      if (existing.status !== nextStatus) {
        await this.users.update(targetUserId, { isActive }, tx);
        await tx?.user.update({
          where: { id: targetUserId, deletedAt: null },
          data: { status: nextStatus },
        });
      }
      // Sprint 01 hardening: locking someone out must also kill their
      // live access. Flipping the status alone left every issued refresh
      // token AND every unexpired access token usable. Revoke every
      // session inside THIS transaction so the account flip and the
      // session kill commit atomically — an admin can never observe a
      // half-applied suspension where the row says SUSPENDED but a
      // session survives. Runs whenever the target lands in a locked-out
      // state (SUSPENDED / LOCKED), including a re-suspend, so stale
      // sessions from a prior partial state are cleaned up too.
      let revokedSessionCount: number | undefined;
      if (nextStatus === 'SUSPENDED' || nextStatus === 'LOCKED') {
        const { count } = await this.sessions.revokeAllForUser(targetUserId, tx);
        revokedSessionCount = count;
      }
      // Reuse the existing audit types so dashboards / queries that
      // group by event type don't have to learn a new one. We pick
      // RESTORED when flipping to ACTIVE and SUSPENDED otherwise; the
      // metadata.targetStatus carries the precise new status for the
      // less common LOCKED case.
      const auditType: AuditEventType =
        nextStatus === 'ACTIVE'
          ? ('ADMIN_USER_RESTORED' as AuditEventType)
          : ('ADMIN_USER_SUSPENDED' as AuditEventType);
      await this.audit.record(
        {
          adminUserId,
          type: auditType,
          metadata: {
            targetUserId,
            targetStatus: nextStatus,
            previousStatus: existing.status,
            previousIsActive: existing.isActive,
            ...(revokedSessionCount !== undefined ? { revokedSessionCount } : {}),
            ...(body.reason ? { reason: body.reason } : {}),
          },
        },
        tx,
      );
      return { ...existing, isActive, status: nextStatus };
    });
    // D-2/D-4 — post-commit. REST-side revocation is already durable: the
    // status flip AND the session revoke committed together above, and
    // SessionValidationService reads the Session row on every request, so no
    // already-issued access token survives the suspension anywhere.
    // What still needs doing is evicting sockets that completed their
    // handshake before this ran.
    if (nextStatus !== 'ACTIVE') {
      this.securityEvents.emitAllSessionsRevoked({
        userId: targetUserId,
        reason: 'account-suspended',
      });
    }
    return { user: await this.toSummary(updated) };
  }

  async suspend(adminUserId: string, targetUserId: string): Promise<AdminUserMutationResponse> {
    if (adminUserId === targetUserId) {
      // Suspending your own account would lock you out; refuse explicitly.
      throw new AppError('VALIDATION_ERROR', 'Admins cannot suspend themselves.', 400);
    }
    const updated = await this.tx.run(async (tx) => {
      const existing = await this.users.findById(targetUserId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'User not found.', 404);
      const next = await this.users.update(targetUserId, { isActive: false }, tx);
      // status flip via raw update — `status` isn't on UpdateUserInput.
      await tx?.user.update({
        where: { id: targetUserId, deletedAt: null },
        data: { status: 'SUSPENDED' as AccountStatus },
      });
      // Sprint 01 hardening: revoke every session in the same transaction
      // so the suspension and the session kill are atomic (see setStatus).
      const { count: revokedSessionCount } = await this.sessions.revokeAllForUser(targetUserId, tx);
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_USER_SUSPENDED' as AuditEventType,
          metadata: {
            targetUserId,
            previousStatus: existing.status,
            previousIsActive: existing.isActive,
            revokedSessionCount,
          },
        },
        tx,
      );
      return { ...next, status: 'SUSPENDED' as AccountStatus };
    });
    // Post-commit socket teardown; see setStatus for why REST needs nothing.
    this.securityEvents.emitAllSessionsRevoked({
      userId: targetUserId,
      reason: 'account-suspended',
    });
    return { user: await this.toSummary(updated) };
  }

  async restore(adminUserId: string, targetUserId: string): Promise<AdminUserMutationResponse> {
    const updated = await this.tx.run(async (tx) => {
      const existing = await this.users.findById(targetUserId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'User not found.', 404);
      const next = await this.users.update(targetUserId, { isActive: true }, tx);
      await tx?.user.update({
        where: { id: targetUserId, deletedAt: null },
        data: { status: 'ACTIVE' as AccountStatus },
      });
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_USER_RESTORED' as AuditEventType,
          metadata: {
            targetUserId,
            previousStatus: existing.status,
            previousIsActive: existing.isActive,
          },
        },
        tx,
      );
      return { ...next, status: 'ACTIVE' as AccountStatus };
    });
    // Restore does NOT resurrect sessions: they were revoked when the account
    // was suspended and stay revoked. The user signs in again, which is the
    // correct outcome — nothing to publish here.
    return { user: await this.toSummary(updated) };
  }

  private async toSummary(u: User): Promise<AdminUserSummary> {
    const [userRoles, latestAccessRequest] = await Promise.all([
      this.users.listRoles(u.id),
      this.adminAccessRequests.findLatestByUserId(u.id),
    ]);
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      status: u.status as AdminUserSummary['status'],
      isActive: u.isActive,
      emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
      mfaEnabled: u.mfaEnabled,
      roles: userRoles.map((r) => r.role.name),
      // Axis 3, reported independently of the two above. Null means the user
      // has never asked for admin access — which is NOT the same as having
      // been refused, and the dashboard renders the two differently.
      adminAccessRequestStatus: latestAccessRequest
        ? (latestAccessRequest.status as AdminUserSummary['adminAccessRequestStatus'])
        : null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }
}
