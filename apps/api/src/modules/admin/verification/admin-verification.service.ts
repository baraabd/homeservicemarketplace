import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { ADMIN_PROVIDER_TRANSITIONS } from '@homeservicemarketplace/contracts';
import type {
  AdminProviderMutationResponse,
  AdminProviderSummary,
  ListAdminProvidersQuery,
  ListAdminProvidersResponse,
  ListProviderAuditEventsQuery,
  ListProviderAuditEventsResponse,
  ProviderAuditEvent,
} from '@homeservicemarketplace/contracts';
import {
  NotificationResourceType,
  NotificationType,
  type AuditEventType,
  type ProviderOnboardingState,
  type ProviderProfileStatus,
} from '@homeservicemarketplace/database';

import { AuditEventRepository } from '../../../infrastructure/persistence/iam/audit-event.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { NotificationsService } from '../../notifications/notifications.service';
import { SecurityEventsBus } from '../../../shared/security-events/security-events.bus';
import { AdminAuditService } from '../admin-audit.service';
import { ProviderCapabilityService } from '../../provider/capability/provider-capability.service';
import { toAdminProviderSummary } from './admin-provider-summary';
import {
  adminSubmissionDate,
  type AdminProviderDirectoryRow,
} from '../../../infrastructure/persistence/bids/admin-provider-directory.query';

const DEFAULT_PAGE_SIZE = 50;

const AUDIT_DEFAULT_PAGE_SIZE = 50;

/**
 * Sprint 9B.29 — the onboarding axis each admin decision implies.
 *
 * This is ADR 0007's legacy-status → onboarding-state mapping, and it is
 * deliberately the SAME table that `ProviderCapabilityService.onboardingFromLegacy`
 * and `ProviderOnboardingWizardService.lifecycleState` already apply as a
 * fallback for rows the Sprint 7 backfill never reached. Those two read the
 * mapping when the axis is NULL; this one WRITES it, so new decisions stop
 * producing rows that need the fallback in the first place.
 *
 * REJECTED → RETURNED is the entry that fixes the deadlock: `RETURNED` is the
 * only decided state the submit claim accepts as a source, and the only one
 * `hubStatusOf` renders as ACTION_REQUIRED. The schema says it plainly — "a
 * returned applicant is in good standing and may edit and resubmit" — and
 * before this nothing in the API ever wrote the value.
 *
 * SUSPENDED → ACCEPTED because suspension is a CONDUCT decision, not an
 * application one: a suspended provider's application was still accepted, and
 * rewriting their onboarding axis would tell them to fill the wizard in again
 * to fix a problem the wizard cannot fix.
 */
const ONBOARDING_AXIS_FOR: Partial<Record<ProviderProfileStatus, ProviderOnboardingState>> = {
  ACTIVE: 'ACCEPTED',
  SUSPENDED: 'ACCEPTED',
  REJECTED: 'RETURNED',
};

@Injectable()
export class AdminVerificationService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly auditEvents: AuditEventRepository,
    private readonly tx: TransactionRunner,
    // Phase 4 / D-4: a status change withdraws marketplace access, so any
    // socket already sitting in `provider:{id}` must be evicted post-commit.
    private readonly securityEvents: SecurityEventsBus,
    private readonly config: AppConfigService,
    private readonly capabilities: ProviderCapabilityService,
  ) {}

  private summary(row: AdminProviderDirectoryRow): AdminProviderSummary {
    const capabilitySet = this.capabilities.forContext({
      accountEligible:
        !!row.user &&
        row.user.status === 'ACTIVE' &&
        row.user.isActive &&
        row.user.deletedAt === null,
      hasProfile: true,
      onboardingState: row.onboardingState ?? null,
      standingState: row.standingState ?? null,
      legacyStatus: row.status,
      verificationState: row.verificationState ?? null,
      hasLiveWorkAccessGrant: (row.workAccessGrants?.length ?? 0) > 0,
    });
    const summary = toAdminProviderSummary(row, capabilitySet);
    if (this.config.get('VERIFICATION_ENFORCED') || this.config.get('WORK_ACCESS_ENFORCED')) {
      summary.availableActions = summary.availableActions?.filter((action) => action !== 'approve');
    }
    return summary;
  }

  async list(
    query: ListAdminProvidersQuery,
    reviewerUserId?: string,
  ): Promise<ListAdminProvidersResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const status = query.status === 'ALL' ? undefined : (query.status ?? 'PENDING_REVIEW');
    if (query.assignment === 'MINE' && !reviewerUserId) {
      throw new AppError('FORBIDDEN', 'A reviewer is required for this filter.', 403);
    }
    const from = query.submittedFrom ? adminSubmissionDate(query.submittedFrom) : null;
    const to = query.submittedTo ? adminSubmissionDate(query.submittedTo, true) : null;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime())) ||
      (from && to && from > to)
    ) {
      throw new AppError('VALIDATION_ERROR', 'Invalid submission date range.', 400, {
        reason: 'INVALID_DATE_RANGE',
      });
    }
    const filters = {
      query: query.query?.trim() || undefined,
      userId: query.userId,
      sort: query.sort ?? (status === 'PENDING_REVIEW' ? 'SUBMITTED_OLDEST' : 'UPDATED_NEWEST'),
      assignment: query.assignment,
      reviewerUserId,
      identityState: query.identityState,
      portfolioState: query.portfolioState,
      country: query.country,
      submittedFrom: query.submittedFrom,
      submittedTo: query.submittedTo,
    };
    const [rows, grouped] = await Promise.all([
      this.providers.listForAdmin({ ...filters, status, take: take + 1, cursor: query.cursor }),
      this.providers.countForAdmin(filters),
    ]);
    const counts = { all: 0, pendingReview: 0, active: 0, returned: 0, suspended: 0, draft: 0 };
    const keys = {
      PENDING_REVIEW: 'pendingReview',
      ACTIVE: 'active',
      REJECTED: 'returned',
      SUSPENDED: 'suspended',
      DRAFT: 'draft',
    } as const;
    for (const group of grouped) {
      counts.all += group._count._all;
      counts[keys[group.status]] = group._count._all;
    }
    const items = rows.slice(0, take).map((row) => this.summary(row));
    return {
      items,
      nextCursor: rows.length > take ? items[items.length - 1].id : null,
      total: status ? counts[keys[status]] : counts.all,
      counts,
    };
  }

  async detail(id: string): Promise<AdminProviderSummary> {
    const row = await this.providers.findByIdForAdmin(id);
    if (!row) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    return this.summary(row);
  }

  async approve(
    adminUserId: string,
    providerProfileId: string,
    note: string | null | undefined,
  ): Promise<AdminProviderMutationResponse> {
    if (this.config.get('VERIFICATION_ENFORCED') || this.config.get('WORK_ACCESS_ENFORCED')) {
      throw new AppError(
        'CONFLICT',
        'Review the complete application before approving this provider.',
        409,
        { reason: 'USE_REVIEW_WORKSPACE' },
      );
    }
    return this.transition({
      adminUserId,
      providerProfileId,
      // Phase 4: DRAFT is NO LONGER an approvable source state.
      //
      // A DRAFT profile has not been submitted, so nothing has been checked
      // against the onboarding completeness policy — approving one activates a
      // provider with no headline, no service area, and no categories, and
      // makes the whole submit-for-review gate optional. Approval now requires
      // a submitted application.
      from: ADMIN_PROVIDER_TRANSITIONS.approve as ProviderProfileStatus[],
      to: 'ACTIVE' as ProviderProfileStatus,
      auditType: 'ADMIN_PROVIDER_APPROVED' as AuditEventType,
      auditMetadata: note ? { note } : {},
      // An APPLICATION decision: this reviewer read the submission.
      stampsSubmissionAs: 'ACCEPTED',
      notification: {
        type: NotificationType.SYSTEM,
        title: 'You are approved',
        body: 'Your provider account is now active.',
      },
      conflictMessage:
        'Only a provider who has submitted an application for review can be approved.',
    });
  }

  async reject(
    adminUserId: string,
    providerProfileId: string,
    reason: string | null | undefined,
  ): Promise<AdminProviderMutationResponse> {
    const reasonText = reason && reason.length > 0 ? reason : null;
    return this.transition({
      adminUserId,
      providerProfileId,
      from: ADMIN_PROVIDER_TRANSITIONS.reject as ProviderProfileStatus[],
      to: 'REJECTED' as ProviderProfileStatus,
      auditType: 'ADMIN_PROVIDER_REJECTED' as AuditEventType,
      auditMetadata: reasonText ? { reason: reasonText } : {},
      // Also an APPLICATION decision: sending it back IS a verdict on it.
      stampsSubmissionAs: 'RETURNED',
      // Persisted on the profile so the Provider app can tell a rejected
      // applicant WHAT TO FIX, instead of showing a generic account-problem
      // message that conflates provider standing with account standing.
      rejectionReason: reasonText,
      notification: {
        type: NotificationType.SYSTEM,
        title: 'Provider account rejected',
        body: reasonText
          ? `Your provider application was rejected: ${reasonText}`
          : 'Your provider application was rejected.',
      },
      conflictMessage: 'Provider is already rejected.',
    });
  }

  async suspend(
    adminUserId: string,
    providerProfileId: string,
    reason: string | null | undefined,
  ): Promise<AdminProviderMutationResponse> {
    const reasonText = reason && reason.length > 0 ? reason : null;
    return this.transition({
      adminUserId,
      providerProfileId,
      from: ADMIN_PROVIDER_TRANSITIONS.suspend as ProviderProfileStatus[],
      to: 'SUSPENDED' as ProviderProfileStatus,
      auditType: 'ADMIN_PROVIDER_SUSPENDED' as AuditEventType,
      auditMetadata: reasonText ? { reason: reasonText } : {},
      notification: {
        type: NotificationType.SYSTEM,
        title: 'Provider account suspended',
        body: reasonText
          ? `Your provider account was suspended: ${reasonText}`
          : 'Your provider account was suspended.',
      },
      conflictMessage: 'Only an ACTIVE provider can be suspended.',
    });
  }

  // Sprint 5.1.4: lift the suspension. Mirrors `approve` but is a
  // distinct verb / audit type so the operator timeline can tell
  // "was approved for the first time" apart from "had their
  // suspension lifted". Conditional on status === SUSPENDED;
  // anything else returns 409.
  async reactivate(
    adminUserId: string,
    providerProfileId: string,
  ): Promise<AdminProviderMutationResponse> {
    return this.transition({
      adminUserId,
      providerProfileId,
      from: ADMIN_PROVIDER_TRANSITIONS.reactivate as ProviderProfileStatus[],
      to: 'ACTIVE' as ProviderProfileStatus,
      // Re-uses the APPROVED audit type — the metadata's
      // previousStatus = SUSPENDED already disambiguates this from
      // a fresh approval, and adding a new enum value would
      // require another forward-only migration. Documented here so
      // a future audit-event split has clear motivation.
      auditType: 'ADMIN_PROVIDER_APPROVED' as AuditEventType,
      auditMetadata: { reactivate: true },
      notification: {
        type: NotificationType.SYSTEM,
        title: 'Provider account reactivated',
        body: 'Your provider account is active again.',
      },
      conflictMessage: 'Only a SUSPENDED provider can be reactivated.',
    });
  }

  // ─── helper ─────────────────────────────────────────────────────────────────
  private async transition(args: {
    adminUserId: string;
    providerProfileId: string;
    from: ProviderProfileStatus[];
    to: ProviderProfileStatus;
    auditType: AuditEventType;
    auditMetadata: Record<string, unknown>;
    notification: { type: NotificationType; title: string; body: string };
    conflictMessage: string;
    rejectionReason?: string | null;
    /**
     * The verdict to record against the submission this decision decided, for
     * APPLICATION decisions only.
     *
     * Deliberately separate from the onboarding axis. `approve` and
     * `reactivate` both move the status to ACTIVE and both map the axis to
     * ACCEPTED, but only one of them is a judgement about an application:
     * reactivation lifts a suspension and says nothing about the paperwork.
     * Omitted by `suspend` and `reactivate`, so a conduct decision can never
     * put a reviewer's name and a verdict on an application nobody read.
     */
    stampsSubmissionAs?: ProviderOnboardingState;
  }): Promise<AdminProviderMutationResponse> {
    const result = await this.tx.run(async (tx) => {
      const existing = await this.providers.findByIdForAdmin(args.providerProfileId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      if (!args.from.includes(existing.status as ProviderProfileStatus)) {
        throw new AppError('CONFLICT', args.conflictMessage, 409);
      }

      // Phase 4 — the state-machine edge is enforced by the WRITE, not by the
      // read above. Prisma's interactive transactions run at READ COMMITTED,
      // so two reviewers acting at once could both read ACTIVE and both
      // proceed; scoping the UPDATE to the legal source statuses makes exactly
      // one of them win. The read stays for the 404 and for the friendly
      // per-source-state conflict message.
      // Sprint 9B.29 — the ONBOARDING axis moves with the status, in the same
      // conditional write. See `decideIfInStatus` for the deadlock that came
      // of leaving it behind, and ONBOARDING_AXIS_FOR for the mapping.
      const onboardingState = ONBOARDING_AXIS_FOR[args.to];
      // ...and it is DELIBERATELY not the same thing as deciding the
      // application. See `stampsSubmissionAs`.
      const stampsSubmissionAs = args.stampsSubmissionAs;

      const moved = await this.providers.decideIfInStatus(
        args.providerProfileId,
        {
          from: args.from,
          to: args.to,
          reviewedByUserId: args.adminUserId,
          // Cleared on any non-rejection so a provider is never shown a stale
          // rejection reason after being approved or reactivated.
          rejectionReason: args.to === 'REJECTED' ? (args.rejectionReason ?? null) : null,
          onboardingState,
        },
        tx,
      );
      if (moved === 0) {
        throw new AppError('CONFLICT', args.conflictMessage, 409);
      }

      // Stamp the decision onto the submission it decided, in the same
      // transaction, so the profile and its history cannot disagree.
      //
      // Driven by `stampsSubmissionAs` — set ONLY by `approve` and `reject` —
      // rather than by the onboarding axis. Keying it off the axis was wrong:
      // `suspend` and `reactivate` also map to ACCEPTED, so a suspension would
      // stamp any still-undecided application with a verdict, a date and a
      // reviewer, from an operator who was making a CONDUCT decision and had
      // not looked at the application at all.
      if (stampsSubmissionAs) {
        await this.providers.stampSubmissionDecision(
          args.providerProfileId,
          { decidedByUserId: args.adminUserId, decision: stampsSubmissionAs },
          tx,
        );
      }

      await this.audit.record(
        {
          adminUserId: args.adminUserId,
          type: args.auditType,
          metadata: {
            providerProfileId: args.providerProfileId,
            targetUserId: existing.user?.id ?? null,
            previousStatus: existing.status,
            newStatus: args.to,
            ...args.auditMetadata,
          },
        },
        tx,
      );
      if (existing.user?.id) {
        await this.notifications.createForUser(
          {
            userId: existing.user.id,
            type: args.notification.type,
            title: args.notification.title,
            body: args.notification.body,
            resourceType: NotificationResourceType.REVIEW,
            resourceId: args.providerProfileId,
            deepLink: `/provider/profile`,
            metadata: { providerProfileId: args.providerProfileId, status: args.to },
          },
          tx,
        );
      }
      const reloaded = await this.providers.findByIdForAdmin(args.providerProfileId, tx);
      if (!reloaded) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      return reloaded;
    });

    // Phase 4 / D-4 — post-commit, never inside the transaction.
    //
    // Losing marketplace approval must NOT log the person out: a suspended or
    // rejected provider who is also a customer keeps their Customer access.
    // The gateway therefore evicts them from `provider:{id}` rather than
    // disconnecting the socket. Publishing on every transition (including
    // promotion to ACTIVE, which the handler ignores) keeps the call site
    // free of policy.
    this.securityEvents.emitProviderStatusChanged({
      userId: result.user?.id ?? null,
      providerProfileId: args.providerProfileId,
      status: args.to as 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED',
    });

    return { provider: this.summary(result) };
  }

  // Sprint 6.2: persist admin-facing review notes on the provider
  // profile. Free-text, no length cap beyond the DTO's (4 KB). Audited
  // via ADMIN_PROVIDER_NOTES_UPDATED so the verification timeline can
  // show every notes mutation alongside the status transitions. Does
  // NOT fan out a user-facing notification — review notes are an
  // admin-private surface.
  async updateReviewNotes(
    adminUserId: string,
    providerProfileId: string,
    notes: string,
  ): Promise<AdminProviderMutationResponse> {
    const result = await this.tx.run(async (tx) => {
      const existing = await this.providers.findByIdForAdmin(providerProfileId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      const trimmed = notes ?? '';
      const previousNotes = (existing as { reviewNotes?: string | null }).reviewNotes ?? null;
      // Idempotent: if the notes haven't changed, skip the DB write
      // but still emit an audit row. This stops a double-click from
      // doubling up audit history; the operator's intent is captured.
      if (previousNotes !== trimmed) {
        await this.providers.updateReviewNotesById(providerProfileId, trimmed, tx);
      }
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_PROVIDER_NOTES_UPDATED' as AuditEventType,
          metadata: {
            providerProfileId,
            targetUserId: existing.user?.id ?? null,
            previousNotesLength: previousNotes ? previousNotes.length : 0,
            newNotesLength: trimmed.length,
          },
        },
        tx,
      );
      const reloaded = await this.providers.findByIdForAdmin(providerProfileId, tx);
      if (!reloaded) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      return reloaded;
    });
    return { provider: this.summary(result) };
  }

  // Sprint 6.2: provider-scoped verification timeline. Returns audit
  // events filtered by metadata.providerProfileId — covers every
  // ADMIN_PROVIDER_* mutation written by the methods above. Cursor-
  // paginated by [createdAt desc, id desc].
  async getAuditHistory(
    providerProfileId: string,
    query: ListProviderAuditEventsQuery,
  ): Promise<ListProviderAuditEventsResponse> {
    // Existence check first so a request for a deleted / non-existent
    // profile returns 404 instead of an empty list (no IDOR cover).
    const existing = await this.providers.findByIdForAdmin(providerProfileId);
    if (!existing) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    const take = Math.min(Math.max(query.limit ?? AUDIT_DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.auditEvents.listForProviderProfile({
      providerProfileId,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items: ProviderAuditEvent[] = page.map((r) => ({
      id: r.id,
      type: r.type as string,
      adminUserId: r.userId ?? null,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }
}
