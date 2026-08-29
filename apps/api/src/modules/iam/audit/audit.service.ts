import { Injectable, Logger } from '@nestjs/common';
import type { AuditEventType, PrismaTx } from '@homeservicemarketplace/database';

import { AuditEventRepository } from '../../../infrastructure/persistence/iam/audit-event.repository';

// Allowlisted metadata keys. Anything outside this set is dropped — no raw
// error payloads, no request bodies, no token material. Keep this list small
// and reviewed.
const ALLOWED_METADATA_KEYS = new Set<string>([
  'sessionId',
  'familyId',
  'jti',
  'reason',
  'provider',
  'outcome',
  'previousStatus',
  'newStatus',
  'roleName',
  // Sprint 2 — provider skill moderation. Ids and a slug only: enough to
  // answer "which provider, which category, which application" from the
  // timeline, with nothing free-text that could carry a payload in.
  'applicationId',
  'providerProfileId',
  'serviceCategoryId',
  'categorySlug',
  'removedCategoryIds',
  // Sprint 9B.2 — verification policy and case lifecycle. Identifiers and
  // enum-valued state only. Deliberately NOT the requirements payload: an
  // audit row must stay readable and bounded, and the policy version already
  // points at the exact requirement set, immutably.
  'policyVersion',
  'caseId',
  'caseState',
  // Sprint 9B.20 — earned service-area expansion. Identifiers, enum-valued
  // tier keys and the two DISTANCES a decision produced. Deliberately NOT
  // the ladder payload or the signal values: the policy version already
  // points at the exact ladder, immutably, and re-recording a provider
  // metric into an audit row would put a performance history somewhere
  // nobody is expecting to find one.
  'country',
  'tierKey',
  'previousTierKey',
  'earnedMaxKm',
  'previousEarnedMaxKm',
  'overrideMaxKm',
  'overrideExpiresAt',
  // Sprint 9B.23 — the onboarding submission transition.
  //
  // `submit()` has recorded these since Sprint 8, with a comment saying the
  // trail should "say out loud what the transition did NOT do" — but they were
  // never on this list, so the sanitizer dropped all three and the event kept
  // only its policy version. The comment described an intention, not the row.
  //
  // They are exactly the shape this allowlist is for: one enum-valued state
  // and two booleans, no free text, no payload. And they are the facts a
  // reader needs six months later to answer "did handing this application in
  // grant anyone access?" without inferring it from an absence.
  'newState',
  'grantsWorkAccess',
  'grantsVerifiedBadge',
  // Sprint 9B.24 — the state a transition came FROM.
  //
  // `withdraw()` has recorded it since Sprint 8 and it was dropped here, the
  // same way the three above were: without it the row says an application
  // reached DRAFT but not whether it was pulled back from review or from a
  // documents-required state, which is the only part a reader needs.
  'previousState',
]);

export interface AuditInput {
  type: AuditEventType;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repo: AuditEventRepository) {}

  // Security-critical events (LOGIN_FAILED, REFRESH_REPLAY, SESSION_REVOKED)
  // should be awaited inside the same transaction as the triggering action.
  // Success events may be written fire-and-forget — failure still surfaces
  // through the logger so it is never silent.
  async record(input: AuditInput, tx?: PrismaTx): Promise<void> {
    const metadata = sanitizeMetadata(input.metadata ?? {});
    try {
      await this.repo.write(
        {
          userId: input.userId ?? null,
          type: input.type,
          metadata,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          requestId: input.requestId ?? null,
        },
        tx,
      );
    } catch (err) {
      // Audit writes are not best-effort for security-critical flows — the
      // caller should surface errors. We still log here so test/dev environments
      // surface the misuse loudly.
      this.logger.error({
        msg: 'audit.write.failed',
        type: input.type,
        requestId: input.requestId ?? undefined,
        err: (err as Error).message,
      });
      throw err;
    }
  }
}

function sanitizeMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_METADATA_KEYS.has(k)) continue;
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}
