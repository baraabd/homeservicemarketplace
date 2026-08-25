import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaTx, ProviderType } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AuditService } from '../../iam/audit/audit.service';
import {
  PolicyPayloadError,
  parsePolicyRequirements,
} from '../../provider/verification/policy/policy-payload';
import {
  PolicyLifecycleError,
  assertNoLiveOverlap,
  assertPublishable,
  assertRetirable,
  assertVersionFormat,
  isLiveAt,
  type PolicyScopeRow,
} from '../../provider/verification/policy/policy-lifecycle';
import { VerificationSettingsService } from '../../provider/verification/verification-settings.service';
import { AppError } from '../../../shared/errors/app-error';

// Sprint 9B.2 — publishing and retiring verification policy versions.
//
// docs/adr/0010-policy-versioned-verification.md
//
// This service ORCHESTRATES and owns no rules. What may be published lives in
// policy-payload.ts, when it may be published lives in policy-lifecycle.ts, and
// the document ceiling lives in the platform settings schema. Keeping them out
// of here is what lets the whole rule set be tested without a database — and
// stops a second copy of a rule appearing next to the query that uses it, which
// is the drift ADR 0006 exists to prevent.
//
// Policies are APPEND-ONLY: publish and retire are the only mutations. There is
// deliberately no update path, because editing a version would change what a
// provider was judged against after they were judged.

export interface PublishPolicyInput {
  version: string;
  country: string | null;
  providerType: ProviderType | null;
  categoryId: string | null;
  requirements: unknown;
  /** Defaults to now. May be scheduled forward, never back. */
  publishedAt?: Date;
}

export interface PolicySummary {
  version: string;
  country: string | null;
  providerType: ProviderType | null;
  categoryId: string | null;
  requirements: Prisma.JsonValue;
  publishedAt: string;
  retiredAt: string | null;
  publishedByUserId: string | null;
  isLive: boolean;
}

@Injectable()
export class AdminVerificationPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
    private readonly settings: VerificationSettingsService,
  ) {}

  async publish(adminUserId: string, input: PublishPolicyInput): Promise<PolicySummary> {
    const now = new Date();
    const publishedAt = input.publishedAt ?? now;

    // ── rules, before any write ──────────────────────────────────────────
    try {
      assertVersionFormat(input.version);
      assertPublishable({ publishedAt }, now);
    } catch (err) {
      throw toAppError(err);
    }

    const maxDocuments = await this.settings.policyMaxDocuments();
    let requirements;
    try {
      requirements = parsePolicyRequirements(input.requirements, {
        categoryId: input.categoryId,
        maxDocuments,
      });
    } catch (err) {
      throw toAppError(err);
    }

    const candidate: PolicyScopeRow = {
      version: input.version,
      country: input.country,
      providerType: input.providerType,
      categoryId: input.categoryId,
      publishedAt,
      retiredAt: null,
    };

    // A read-then-write, so it LOSES a race. It is still worth doing: it turns
    // the common mistake into a sentence an admin can act on, while the partial
    // unique index below guarantees the rule under concurrency.
    const existing = await this.prisma.client.verificationRequirementPolicy.findMany({
      select: {
        version: true,
        country: true,
        providerType: true,
        categoryId: true,
        publishedAt: true,
        retiredAt: true,
      },
    });
    try {
      assertNoLiveOverlap(candidate, existing, now);
    } catch (err) {
      throw toAppError(err);
    }

    // ── the write ────────────────────────────────────────────────────────
    return this.tx.run(async (trx: PrismaTx) => {
      let row;
      try {
        row = await trx.verificationRequirementPolicy.create({
          data: {
            version: input.version,
            country: input.country,
            providerType: input.providerType,
            categoryId: input.categoryId,
            requirements: requirements as unknown as Prisma.InputJsonValue,
            publishedAt,
            publishedByUserId: adminUserId,
          },
        });
      } catch (err) {
        throw translateWriteError(err);
      }

      // In the SAME transaction. A publication that commits without its audit
      // row is an unattributable change to what every provider in a country
      // must prove.
      await this.audit.record(
        {
          type: 'VERIFICATION_POLICY_PUBLISHED',
          userId: adminUserId,
          metadata: { policyVersion: input.version },
        },
        trx,
      );

      return toSummary(row, new Date());
    });
  }

  async retire(adminUserId: string, version: string): Promise<PolicySummary> {
    try {
      assertVersionFormat(version);
    } catch (err) {
      throw toAppError(err);
    }

    const found = await this.prisma.client.verificationRequirementPolicy.findUnique({
      where: { version },
    });
    if (!found) {
      throw new AppError('NOT_FOUND', `No verification policy named ${version}.`, 404);
    }

    const now = new Date();
    try {
      assertRetirable(found, now);
    } catch (err) {
      throw toAppError(err);
    }

    return this.tx.run(async (trx: PrismaTx) => {
      // The WHERE clause IS the concurrency guard — this table has no version
      // column, and it does not need one: "still un-retired" is exactly the
      // precondition. Two admins retiring at once means one UPDATE matches
      // zero rows and gets a 409 instead of a silent success.
      const { count } = await trx.verificationRequirementPolicy.updateMany({
        where: { version, retiredAt: null },
        data: { retiredAt: now },
      });

      if (count === 0) {
        throw new AppError(
          'CONFLICT',
          `Policy ${version} was retired by someone else. Reload to see the current state.`,
          409,
        );
      }

      await this.audit.record(
        {
          type: 'VERIFICATION_POLICY_RETIRED',
          userId: adminUserId,
          metadata: { policyVersion: version },
        },
        trx,
      );

      return toSummary({ ...found, retiredAt: now }, now);
    });
  }

  async list(): Promise<{ policies: PolicySummary[] }> {
    const rows = await this.prisma.client.verificationRequirementPolicy.findMany({
      orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }],
    });
    const now = new Date();
    return { policies: rows.map((r) => toSummary(r, now)) };
  }
}

/** Domain errors carry a code the API contract already knows; anything else is
 *  a bug and must not be dressed up as a client error. */
function toAppError(err: unknown): AppError {
  if (err instanceof PolicyPayloadError) {
    return new AppError('VALIDATION_ERROR', err.message, 400, { reason: err.code });
  }
  if (err instanceof PolicyLifecycleError) {
    const status = err.code === 'OVERLAPPING_POLICY' || err.code === 'ALREADY_RETIRED' ? 409 : 400;
    return new AppError(status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', err.message, status, {
      reason: err.code,
    });
  }
  if (err instanceof AppError) return err;
  throw err;
}

/**
 * The partial unique index is the real guarantee, so its violation has to reach
 * the client as the SAME stable error the pre-check produces. A P2002 leaking
 * through would be both unhelpful and a small disclosure of schema shape.
 */
function translateWriteError(err: unknown): AppError {
  const code = (err as { code?: string })?.code;
  if (code === 'P2002') {
    return new AppError(
      'CONFLICT',
      'A live verification policy already covers this country, provider type and category. Retire it before publishing a replacement.',
      409,
      { reason: 'OVERLAPPING_POLICY' },
    );
  }
  if (err instanceof AppError) return err;
  throw err;
}

function toSummary(
  row: {
    version: string;
    country: string | null;
    providerType: ProviderType | null;
    categoryId: string | null;
    requirements: Prisma.JsonValue;
    publishedAt: Date;
    retiredAt: Date | null;
    publishedByUserId: string | null;
  },
  now: Date,
): PolicySummary {
  return {
    version: row.version,
    country: row.country,
    providerType: row.providerType,
    categoryId: row.categoryId,
    requirements: row.requirements,
    publishedAt: row.publishedAt.toISOString(),
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
    publishedByUserId: row.publishedByUserId,
    isLive: isLiveAt(row, now),
  };
}
