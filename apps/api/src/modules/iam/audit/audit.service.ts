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
