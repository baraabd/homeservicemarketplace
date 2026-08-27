import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaTx, VerificationCaseState } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import { AuditService } from '../../../iam/audit/audit.service';
import { AppError } from '../../../../shared/errors/app-error';
import {
  RequirementResolutionError,
  resolveRequirements,
  type CandidatePolicy,
} from '../policy/requirement-resolver';
import { ACTIVE_CASE_STATES, decideCaseCreation, type ExistingCase } from './case-creation-policy';

// Sprint 9B.2 — the provider asks to start verification.
//
// docs/adr/0010 · docs/adr/0013
//
// Orchestration only. WHICH case a request refers to is decided by
// case-creation-policy.ts; WHAT must be proven is resolved by
// requirement-resolver.ts. Both are pure and tested without a database, so the
// rules cannot drift into the query layer.
//
// Every method takes a USER id and derives the provider profile itself. A
// method that accepted a providerProfileId from the caller would be an IDOR by
// construction, so the signature is the defence.

export interface CreateCaseInput {
  /** Client-supplied replay key. Optional; scoped per provider. */
  idempotencyKey?: string | null;
}

export interface ProviderCaseView {
  id: string;
  state: VerificationCaseState;
  policyVersion: string;
  createdAt: string;
  submittedAt: string | null;
  /** What the provider still has to produce, from the case's own snapshot. */
  requirements: unknown;
  /** Sprint 9B.11 — what has been supplied, and each file's scan verdict. */
  documents: Array<{
    id: string;
    kind: string;
    serviceCategoryId: string | null;
    scanState: string;
    uploadedAt: string;
    superseded: boolean;
  }>;
  /** Sprint 9B.11 — the latest reviewer decision as a CODE. Never the notes. */
  latestDecision: { outcome: string; reasonCode: string; decidedAt: string } | null;
}

export interface CreateCaseResult {
  case: ProviderCaseView;
  /** False when an existing case was resumed — the ordinary retry outcome. */
  created: boolean;
}

@Injectable()
export class ProviderVerificationCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
  ) {}

  async createOrResume(userId: string, input: CreateCaseInput): Promise<CreateCaseResult> {
    const profile = await this.ownProfile(userId);
    const now = new Date();

    const cases = await this.casesFor(profile.id);
    const decision = decideCaseCreation({
      cases,
      idempotencyKey: input.idempotencyKey ?? null,
      now,
    });

    if (decision.action === 'REFUSE') {
      throw refusal(decision.code);
    }

    if (decision.action === 'RESUME') {
      const resumed = await this.loadCase(profile.id, decision.caseId);
      // A resume is a RETRY, and it is recorded as one. Six CREATED rows for a
      // single case would misrepresent a flaky connection as six attempts to
      // be verified.
      await this.audit.record({
        type: 'VERIFICATION_CASE_RESUMED',
        userId,
        metadata: {
          providerProfileId: profile.id,
          caseId: resumed.id,
          caseState: resumed.state,
        },
      });
      return { case: resumed, created: false };
    }

    // ── resolve what this provider must prove ────────────────────────────
    const resolved = await this.resolveFor(profile, now);

    return this.tx.run(async (trx: PrismaTx) => {
      let row;
      try {
        row = await trx.verificationCase.create({
          data: {
            providerProfileId: profile.id,
            state: 'DRAFT',
            policyVersion: resolved.policyVersion,
            // The case must stand alone: a reviewer checklist and any later
            // replay must not depend on the policy row still existing, or
            // still saying what it said today.
            requirementsSnapshot: resolved as unknown as Prisma.InputJsonValue,
            // The case's own column is `country`; the value comes from the
            // provider's operating area.
            country: profile.serviceAreaCountry ?? null,
            providerType: profile.providerType ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
          },
        });
      } catch (err) {
        throw translateWriteError(err);
      }

      await this.audit.record(
        {
          type: 'VERIFICATION_CASE_CREATED',
          userId,
          metadata: {
            providerProfileId: profile.id,
            caseId: row.id,
            policyVersion: resolved.policyVersion,
          },
        },
        trx,
      );

      return { case: toView(row), created: true };
    });
  }

  /** The case a provider is currently looking at: the open one, or the most
   *  recent closed one so a rejection stays visible and appealable. */
  async current(userId: string): Promise<{ case: ProviderCaseView | null }> {
    const profile = await this.ownProfile(userId);
    const rows = await this.prisma.client.verificationCase.findMany({
      where: { providerProfileId: profile.id },
      select: PROVIDER_CASE_SELECT,
      orderBy: [{ createdAt: 'desc' }],
    });
    if (rows.length === 0) return { case: null };

    const open = rows.find((r) => ACTIVE_CASE_STATES.includes(r.state));
    return { case: toView(open ?? rows[0]) };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async ownProfile(userId: string) {
    const profile = await this.prisma.client.providerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        // The provider's OPERATING country — where they will do the work — is
        // what decides whose rules apply. There is no separate "country" on
        // ProviderProfile; serviceAreaCountry is the field, and using it keeps
        // the requirement set tied to where the work happens rather than to
        // where the account was created.
        serviceAreaCountry: true,
        providerType: true,
        serviceCategories: { select: { serviceCategoryId: true } },
      },
    });
    if (!profile) {
      throw new AppError('NOT_FOUND', 'No provider profile for this account.', 404);
    }
    return profile;
  }

  private async casesFor(providerProfileId: string): Promise<ExistingCase[]> {
    const rows = await this.prisma.client.verificationCase.findMany({
      where: { providerProfileId },
      select: { id: true, state: true, createdAt: true, idempotencyKey: true },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows;
  }

  private async loadCase(providerProfileId: string, caseId: string): Promise<ProviderCaseView> {
    const row = await this.prisma.client.verificationCase.findFirst({
      // Scoped to the profile, not just the id: a case id is not a capability.
      where: { id: caseId, providerProfileId },
    });
    if (!row) throw new AppError('NOT_FOUND', 'Verification case not found.', 404);
    return toView(row);
  }

  private async resolveFor(
    profile: {
      serviceAreaCountry: string | null;
      providerType: 'INDIVIDUAL' | 'BUSINESS' | null;
      serviceCategories: Array<{ serviceCategoryId: string }>;
    },
    at: Date,
  ) {
    const policies = (await this.prisma.client.verificationRequirementPolicy.findMany({
      select: {
        version: true,
        country: true,
        providerType: true,
        categoryId: true,
        requirements: true,
        publishedAt: true,
        retiredAt: true,
      },
    })) as unknown as CandidatePolicy[];

    try {
      return resolveRequirements({
        country: profile.serviceAreaCountry ?? null,
        providerType: profile.providerType ?? null,
        categoryIds: profile.serviceCategories.map((c) => c.serviceCategoryId),
        policies,
        at,
      });
    } catch (err) {
      if (err instanceof RequirementResolutionError) {
        // Deliberately NOT a 400. The provider did nothing wrong: nobody has
        // published a policy that applies to them, or two contradict. Resolving
        // to an empty requirement set instead would verify them with no
        // evidence, which is the one silent success this whole design exists
        // to prevent.
        throw new AppError(
          'DEPENDENCY_UNAVAILABLE',
          'Verification is not available for your account yet. Support has been notified.',
          503,
          { reason: err.code },
        );
      }
      throw err;
    }
  }
}

function refusal(code: 'ALREADY_VERIFIED' | 'MULTIPLE_ACTIVE_CASES'): AppError {
  if (code === 'ALREADY_VERIFIED') {
    return new AppError(
      'CONFLICT',
      'This account is already verified. Ask support if you need to re-verify.',
      409,
      { reason: code },
    );
  }
  return new AppError(
    'CONFLICT',
    'Your verification is in an inconsistent state. Support has been notified.',
    409,
    { reason: code },
  );
}

/**
 * A P2002 from either partial index has to reach the client as the same stable
 * error a sequential duplicate produces. Leaking the Prisma code would be
 * unhelpful and would disclose index names.
 */
function translateWriteError(err: unknown): AppError {
  const code = (err as { code?: string })?.code;
  if (code === 'P2002') {
    const target = String((err as { meta?: { target?: unknown } })?.meta?.target ?? '');
    if (target.includes('idempotencyKey')) {
      return new AppError(
        'CONFLICT',
        'This request was already processed. Fetch your current verification case.',
        409,
        { reason: 'DUPLICATE_IDEMPOTENCY_KEY' },
      );
    }
    return new AppError('CONFLICT', 'A verification case is already open for this account.', 409, {
      reason: 'CASE_ALREADY_OPEN',
    });
  }
  if (err instanceof AppError) return err;
  throw err;
}

/** The columns a provider may see about their own case.
 *
 *  NAMED, not spread. `reviewerNotes` sits on the same row and must never
 *  reach this surface: it is a reviewer's internal prose about a person, and
 *  Sprint 9B.5 already keeps it off the notification for the same reason. A
 *  `select` that named the row wholesale would leak it the first time someone
 *  added a field. */
export const PROVIDER_CASE_SELECT = {
  id: true,
  state: true,
  policyVersion: true,
  createdAt: true,
  submittedAt: true,
  requirementsSnapshot: true,
  documents: {
    select: {
      id: true,
      kind: true,
      serviceCategoryId: true,
      uploadedAt: true,
      supersededAt: true,
      mediaAsset: { select: { scanState: true } },
    },
    orderBy: [{ uploadedAt: 'asc' }],
  },
  decisions: {
    select: { outcome: true, reasonCode: true, decidedAt: true },
    orderBy: [{ decidedAt: 'desc' }],
    take: 1,
  },
  // `satisfies` rather than an annotation or `as const`: it CHECKS the shape
  // against Prisma's select type while leaving the literals narrow enough for
  // Prisma to infer the row type. An annotation widens the result to the whole
  // model; `as const` makes the orderBy arrays readonly, which Prisma rejects.
} satisfies Prisma.VerificationCaseSelect;

interface CaseRowForView {
  id: string;
  state: VerificationCaseState;
  policyVersion: string;
  createdAt: Date;
  submittedAt: Date | null;
  requirementsSnapshot?: Prisma.JsonValue | null;
  documents?: Array<{
    id: string;
    kind: string;
    serviceCategoryId: string | null;
    uploadedAt: Date;
    supersededAt: Date | null;
    mediaAsset: { scanState: string };
  }>;
  decisions?: Array<{ outcome: string; reasonCode: string; decidedAt: Date }>;
}

function toView(row: CaseRowForView): ProviderCaseView {
  const decision = row.decisions?.[0];
  return {
    id: row.id,
    state: row.state,
    policyVersion: row.policyVersion,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    requirements: row.requirementsSnapshot ?? null,
    documents: (row.documents ?? []).map((d) => ({
      id: d.id,
      kind: d.kind,
      serviceCategoryId: d.serviceCategoryId,
      // The media pipeline's verdict, surfaced verbatim so the client can tell
      // "still scanning" from "quarantined" from "refused before scanning" —
      // three different things to say to the person waiting.
      scanState: d.mediaAsset.scanState,
      uploadedAt: d.uploadedAt.toISOString(),
      superseded: d.supersededAt !== null,
    })),
    latestDecision: decision
      ? {
          outcome: decision.outcome,
          reasonCode: decision.reasonCode,
          decidedAt: decision.decidedAt.toISOString(),
        }
      : null,
  };
}
