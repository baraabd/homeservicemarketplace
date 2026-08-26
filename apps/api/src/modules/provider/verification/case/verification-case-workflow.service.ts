import { Injectable, Logger } from '@nestjs/common';
import type {
  PrismaTx,
  VerificationCaseState,
  VerificationReasonCode,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import { OutboxRepository } from '../../../../infrastructure/outbox/outbox.repository';
import { OutboxEventType } from '../../../../infrastructure/outbox/outbox.tokens';
import { AuditService } from '../../../iam/audit/audit.service';
import { AppError } from '../../../../shared/errors/app-error';
import { VerificationSettingsService } from '../verification-settings.service';
import {
  TERMINAL_CASE_STATES,
  VERIFICATION_CASE_TRANSITIONS,
  offerableCaseActions,
  type VerificationCaseAction,
} from '../policy/case-transitions';
import { assessSubmissionReadiness } from './submission-readiness';
import type { ResolvedRequirements } from '../policy/requirement-resolver';

// Sprint 9B.5 — the three commands that move a verification case.
//
// docs/adr/0013-evidence-to-work-access-capability-transition.md §1
//
// The transition table is the authority. This class is the only thing allowed
// to act on it, and everything it does around the transition is there because
// of a specific way this goes wrong:
//
//   ownership          a provider acts on their OWN case, and a case they do
//                      not own is answered exactly as one that does not exist
//   self-review        a reviewer never reviews themselves, refused here as
//                      well as hidden in the read model
//   idempotence        every command replays safely; a second click reports the
//                      truth rather than a second write or an error
//   staleness          a caller acting on an old view is refused, not allowed
//                      to overwrite what happened since
//   atomicity          the state change, the decision row, the audit entry, the
//                      outbox event and the notification are one transaction
//
// Nothing here decides an OUTCOME. approve/reject/expire/revoke are absent on
// purpose (see IMPLEMENTED_CASE_ACTIONS): granting work access is atomic across
// the case, the grant and the provider's status, and Sprint 9B.7 owns it.

export interface CaseCommandResult {
  caseId: string;
  state: VerificationCaseState;
  /** False when this call was a replay and changed nothing. */
  changed: boolean;
  /** Server-computed, and only ever actions that have a command behind them. */
  availableActions: VerificationCaseAction[];
}

interface LoadedCase {
  id: string;
  state: VerificationCaseState;
  providerProfileId: string;
  policyVersion: string;
  requirementsSnapshot: unknown;
  assignedToUserId: string | null;
  providerProfile: {
    id: string;
    userId: string | null;
    displayName: string | null;
    headline: string | null;
    bio: string | null;
    phoneNumber: string | null;
    serviceAreaCity: string | null;
    serviceAreaCountry: string | null;
    serviceAreaRadiusKm: number | null;
    acceptedConsentVersion: string | null;
    user?: { emailVerifiedAt?: Date | null } | null;
    _count?: { serviceCategories?: number } | null;
  };
  documents: Array<{
    kind: string;
    serviceCategoryId: string | null;
    mediaAsset: { scanState: string } | null;
  }>;
}

@Injectable()
export class VerificationCaseWorkflowService {
  private readonly log = new Logger(VerificationCaseWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
    private readonly outbox: OutboxRepository,
    private readonly settings: VerificationSettingsService,
  ) {}

  // ── submit ──────────────────────────────────────────────────────────────

  /**
   * Provider sends evidence for review. Also the RESUBMISSION path — the
   * transition table makes it the same edge, so a returned applicant does not
   * travel a second code path.
   */
  async submit(
    userId: string,
    input: { caseId: string; expectedState?: VerificationCaseState },
  ): Promise<CaseCommandResult> {
    const kase = await this.load(input.caseId);

    // Ownership before anything else, and the refusal is indistinguishable
    // from "no such case": a distinct error here turns the endpoint into a
    // case-id oracle.
    if (!kase || kase.providerProfile.userId !== userId) throw notFound();

    if (kase.state === 'SUBMITTED') return this.replay(kase, 'provider');
    this.assertFresh(kase, input.expectedState);

    const readiness = assessSubmissionReadiness({
      state: kase.state,
      requirements: this.requirementsOf(kase),
      documents: kase.documents.map((d) => ({
        kind: d.kind as never,
        serviceCategoryId: d.serviceCategoryId,
        // No asset means the document row outlived its evidence. Treated as
        // not-clean rather than absent, which is the truthful answer.
        scanState: d.mediaAsset?.scanState ?? 'MISSING',
      })),
      onboarding: this.onboardingCandidateOf(kase),
      terms: {
        requiredVersion: await this.settings.requiredConsentVersion(),
        acceptedVersion: kase.providerProfile.acceptedConsentVersion,
      },
    });

    if (!readiness.ready) {
      throw new AppError(
        'VALIDATION_ERROR',
        'This verification case is not ready to submit yet.',
        422,
        { blockers: readiness.blockers },
      );
    }

    const now = new Date();
    return this.commit({
      kase,
      action: 'submit',
      actor: 'provider',
      actorUserId: userId,
      data: { state: 'SUBMITTED', submittedAt: now },
      auditType: 'VERIFICATION_CASE_SUBMITTED',
      auditMetadata: { caseId: kase.id, providerProfileId: kase.providerProfileId },
      eventType: OutboxEventType.VERIFICATION_CASE_SUBMITTED,
    });
  }

  /**
   * Submit the caller's OWN active case, without them naming it.
   *
   * A provider has one case in flight, so making them supply its id buys
   * nothing and lets them name somebody else's. The id is resolved from the
   * authenticated user, which removes an entire class of IDOR from the route.
   *
   * "Active" means NOT TERMINAL, not "submittable".
   *
   * The difference matters and cost a test to find. Filtering to the states
   * submission is legal from makes the idempotent replay unreachable: once the
   * case is SUBMITTED there is nothing to find, so a provider double-clicking
   * gets a 404 about a case that plainly exists. Resolving the live case and
   * letting submit() judge it is what lets a replay be recognised as a replay.
   */
  async submitOwnCase(
    userId: string,
    input: { expectedState?: VerificationCaseState } = {},
  ): Promise<CaseCommandResult> {
    const open = await this.prisma.client.verificationCase.findFirst({
      where: {
        providerProfile: { userId },
        state: { notIn: [...TERMINAL_CASE_STATES] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    // Same refusal as a case that does not exist. A provider with nothing to
    // submit and a provider naming a stranger's case get one answer.
    if (!open) throw notFound();

    return this.submit(userId, { caseId: open.id, expectedState: input.expectedState });
  }

  // ── assign ──────────────────────────────────────────────────────────────

  /**
   * A reviewer takes the case.
   *
   * Workflow, not authorization: this stops two reviewers doing the same work.
   * It does not stop a permitted reviewer READING the case, and a second
   * reviewer may take over — somebody has to be able to pick up a case whose
   * reviewer went on holiday. The handover is recorded rather than prevented.
   */
  async assign(
    reviewerUserId: string,
    input: { caseId: string; expectedState?: VerificationCaseState },
  ): Promise<CaseCommandResult> {
    const kase = await this.requireReviewable(input.caseId, reviewerUserId);

    if (kase.state === 'IN_REVIEW' && kase.assignedToUserId === reviewerUserId) {
      return this.replay(kase, 'reviewer');
    }
    this.assertFresh(kase, input.expectedState);
    this.assertLegal('assign', kase.state);

    return this.commit({
      kase,
      action: 'assign',
      actor: 'reviewer',
      actorUserId: reviewerUserId,
      data: { state: 'IN_REVIEW', assignedToUserId: reviewerUserId, assignedAt: new Date() },
      auditType: 'VERIFICATION_CASE_ASSIGNED',
      auditMetadata: {
        caseId: kase.id,
        providerProfileId: kase.providerProfileId,
        previousAssignee: kase.assignedToUserId,
      },
      eventType: null,
    });
  }

  // ── requestAction ───────────────────────────────────────────────────────

  /**
   * The reviewer sends the case back with something specific to fix.
   *
   * Not a closure: the provider can act, and the evidence already supplied is
   * retained rather than discarded. This is the one command here that records a
   * DECISION, because a reviewer looked and judged.
   */
  async requestAction(
    reviewerUserId: string,
    input: {
      caseId: string;
      reasonCode: VerificationReasonCode;
      note?: string | null;
      expectedState?: VerificationCaseState;
    },
  ): Promise<CaseCommandResult> {
    // The table says this action requires a reason; the check reads it from
    // there rather than restating it, so the two cannot disagree.
    if (VERIFICATION_CASE_TRANSITIONS.requestAction.requiresReason && !input.reasonCode) {
      throw new AppError('VALIDATION_ERROR', 'A reason is required to return this case.', 400, {
        reason: 'REASON_REQUIRED',
      });
    }

    const kase = await this.requireReviewable(input.caseId, reviewerUserId);

    if (kase.state === 'ACTION_REQUIRED') return this.replay(kase, 'reviewer');
    this.assertFresh(kase, input.expectedState);
    this.assertLegal('requestAction', kase.state);

    return this.commit({
      kase,
      action: 'requestAction',
      actor: 'reviewer',
      actorUserId: reviewerUserId,
      data: {
        state: 'ACTION_REQUIRED',
        // Reviewer prose lives on the case, which is access-controlled, and is
        // deleted with the evidence. It never reaches the decision row, the
        // audit metadata or the notification.
        reviewerNotes: input.note ?? null,
      },
      auditType: 'VERIFICATION_CASE_ACTION_REQUESTED',
      auditMetadata: {
        caseId: kase.id,
        providerProfileId: kase.providerProfileId,
        reasonCode: input.reasonCode,
      },
      eventType: OutboxEventType.VERIFICATION_CASE_ACTION_REQUIRED,
      decision: { outcome: 'ACTION_REQUIRED', reasonCode: input.reasonCode },
      notifyProvider: 'ACTION_REQUIRED',
    });
  }

  // ── reject ──────────────────────────────────────────────────────────────

  /**
   * The reviewer closes the case against the provider.
   *
   * The half of deciding that needs no grant: rejection withdraws nothing and
   * creates nothing, so it does not carry 9B.7's atomic write across the case,
   * the grant and the provider's status. That is why it ships and approve does
   * not.
   *
   * Reachable from ACTION_REQUIRED as well as the live states — a provider who
   * was asked for something and never came back still has to be closable, or
   * the queue fills with cases nobody can finish.
   *
   * NOT a correction tool for a VERIFIED case. Undoing a grant is `revoke`,
   * which is a different edge with a different record, and the transition table
   * refuses this one from VERIFIED.
   */
  async reject(
    reviewerUserId: string,
    input: {
      caseId: string;
      reasonCode: VerificationReasonCode;
      note?: string | null;
      expectedState?: VerificationCaseState;
    },
  ): Promise<CaseCommandResult> {
    if (VERIFICATION_CASE_TRANSITIONS.reject.requiresReason && !input.reasonCode) {
      throw new AppError('VALIDATION_ERROR', 'A reason is required to reject this case.', 400, {
        reason: 'REASON_REQUIRED',
      });
    }

    const kase = await this.requireReviewable(input.caseId, reviewerUserId);

    if (kase.state === 'REJECTED') return this.replay(kase, 'reviewer');
    this.assertFresh(kase, input.expectedState);
    this.assertLegal('reject', kase.state);

    return this.commit({
      kase,
      action: 'reject',
      actor: 'reviewer',
      actorUserId: reviewerUserId,
      data: { state: 'REJECTED', reviewerNotes: input.note ?? null, decidedAt: new Date() },
      auditType: 'VERIFICATION_CASE_REJECTED',
      auditMetadata: {
        caseId: kase.id,
        providerProfileId: kase.providerProfileId,
        reasonCode: input.reasonCode,
      },
      eventType: OutboxEventType.VERIFICATION_CASE_REJECTED,
      decision: { outcome: 'REJECTED', reasonCode: input.reasonCode },
      notifyProvider: 'REJECTED',
    });
  }

  // ── the shared machinery ────────────────────────────────────────────────

  private async commit(input: {
    kase: LoadedCase;
    action: VerificationCaseAction;
    actor: 'provider' | 'reviewer';
    actorUserId: string;
    data: Record<string, unknown>;
    auditType: string;
    auditMetadata: Record<string, unknown>;
    eventType: string | null;
    decision?: { outcome: 'ACTION_REQUIRED' | 'REJECTED'; reasonCode: VerificationReasonCode };
    /** Which notification the provider gets, if any. */
    notifyProvider?: 'ACTION_REQUIRED' | 'REJECTED';
  }): Promise<CaseCommandResult> {
    const { kase } = input;
    const toState = input.data.state as VerificationCaseState;

    const claimed = await this.tx.run(async (trx: PrismaTx) => {
      const client = trx as unknown as typeof this.prisma.client;

      // Conditional on the state we OBSERVED. Two callers cannot both write,
      // and the loser finds out rather than silently overwriting.
      const { count } = await client.verificationCase.updateMany({
        where: { id: kase.id, state: kase.state },
        data: input.data,
      });
      if (count !== 1) return false;

      if (input.decision) {
        await client.verificationDecision.create({
          data: {
            caseId: kase.id,
            outcome: input.decision.outcome,
            reasonCode: input.decision.reasonCode,
            fromState: kase.state,
            toState,
            policyVersion: kase.policyVersion,
            decidedByUserId: input.actorUserId,
          },
        });
      }

      await this.audit.record(
        {
          type: input.auditType as never,
          userId: input.actorUserId,
          metadata: input.auditMetadata,
        },
        trx,
      );

      if (input.eventType) {
        await this.outbox.enqueue(
          {
            aggregateType: 'VerificationCase',
            aggregateId: kase.id,
            eventType: input.eventType,
            payload: {
              caseId: kase.id,
              providerProfileId: kase.providerProfileId,
              fromState: kase.state,
              toState,
            },
            // A replayed command and a genuine second transition to the same
            // state are different events; the state pair distinguishes them.
            dedupeKey: `${input.eventType}:${kase.id}:${kase.state}->${toState}`,
          },
          trx,
        );
      }

      if (input.notifyProvider && kase.providerProfile.userId) {
        const rejected = input.notifyProvider === 'REJECTED';
        await client.notification.create({
          data: {
            userId: kase.providerProfile.userId,
            type: rejected ? 'VERIFICATION_REJECTED' : 'VERIFICATION_ACTION_REQUIRED',
            title: rejected
              ? 'Your verification could not be completed'
              : 'Your verification needs attention',
            // Deliberately generic, and carrying NO reason code. A notification
            // is listed, cached and pushed to a device; a rejection reason is a
            // judgement about a person and belongs behind the access-controlled
            // case, as does the reviewer's prose.
            body: rejected
              ? 'A reviewer has closed your verification. Open your verification page for details.'
              : 'A reviewer has asked for something before your application can continue.',
            resourceType: 'VERIFICATION_CASE',
            resourceId: kase.id,
            deepLink: '/provider/verification',
          },
        });
      }

      return true;
    });

    if (!claimed) return this.afterLostRace(kase, toState, input.actor);

    return {
      caseId: kase.id,
      state: toState,
      changed: true,
      availableActions: offerableCaseActions(toState, input.actor),
    };
  }

  /**
   * Someone else got there first.
   *
   * If they did the SAME thing, this is an idempotent replay and the caller is
   * told the truth. Two tabs, one click each, should not produce an error the
   * provider cannot act on. Anything else is a genuine conflict.
   */
  private async afterLostRace(
    kase: LoadedCase,
    intended: VerificationCaseState,
    actor: 'provider' | 'reviewer',
  ): Promise<CaseCommandResult> {
    const fresh = await this.load(kase.id);
    if (fresh && fresh.state === intended) return this.replay(fresh, actor);

    throw new AppError(
      'CONFLICT',
      'This verification case changed while you were working on it. Reload and try again.',
      409,
      { reason: 'CONCURRENT_UPDATE' },
    );
  }

  private replay(kase: LoadedCase, actor: 'provider' | 'reviewer'): CaseCommandResult {
    return {
      caseId: kase.id,
      state: kase.state,
      changed: false,
      availableActions: offerableCaseActions(kase.state, actor),
    };
  }

  /** A reviewer may act on this case at all. */
  private async requireReviewable(caseId: string, reviewerUserId: string): Promise<LoadedCase> {
    const kase = await this.load(caseId);
    if (!kase) throw notFound();

    // Refused here as well as hidden in the read model. Showing the buttons and
    // then refusing teaches people to click and hope; refusing without hiding
    // leaves the buttons there.
    if (kase.providerProfile.userId && kase.providerProfile.userId === reviewerUserId) {
      throw new AppError('FORBIDDEN', 'You cannot review your own verification case.', 403, {
        reason: 'SELF_REVIEW',
      });
    }
    return kase;
  }

  private assertFresh(kase: LoadedCase, expected?: VerificationCaseState): void {
    if (expected && expected !== kase.state) {
      throw new AppError(
        'CONFLICT',
        'This verification case has moved on since you loaded it. Reload and try again.',
        409,
        { reason: 'STALE_STATE', currentState: kase.state },
      );
    }
  }

  private assertLegal(action: VerificationCaseAction, from: VerificationCaseState): void {
    if (!VERIFICATION_CASE_TRANSITIONS[action].from.includes(from)) {
      throw new AppError('CONFLICT', 'That action is not available on this case.', 409, {
        reason: 'ILLEGAL_TRANSITION',
        currentState: from,
      });
    }
  }

  private async load(caseId: string): Promise<LoadedCase | null> {
    return (await this.prisma.client.verificationCase.findUnique({
      where: { id: caseId },
      include: {
        providerProfile: {
          include: {
            // emailVerifiedAt, not a boolean: the column records WHEN, and a
            // derived boolean is what the onboarding policy wants.
            user: { select: { emailVerifiedAt: true } },
            _count: { select: { serviceCategories: true } },
          },
        },
        documents: { include: { mediaAsset: { select: { scanState: true } } } },
      },
    })) as LoadedCase | null;
  }

  /** The snapshot taken when the case was created — never the live policy. */
  private requirementsOf(kase: LoadedCase): ResolvedRequirements {
    const snapshot = kase.requirementsSnapshot as ResolvedRequirements | null;
    if (snapshot && Array.isArray(snapshot.requirements)) return snapshot;
    // A case with no snapshot cannot be judged against anything. Failing closed
    // with an empty set would submit it with no evidence at all.
    throw new AppError(
      'CONFLICT',
      'This verification case is missing its requirement snapshot. Support has been notified.',
      409,
      { reason: 'NO_REQUIREMENTS_SNAPSHOT' },
    );
  }

  private onboardingCandidateOf(kase: LoadedCase) {
    const p = kase.providerProfile;
    return {
      displayName: p.displayName,
      headline: p.headline,
      bio: p.bio,
      phoneNumber: p.phoneNumber,
      serviceAreaCity: p.serviceAreaCity,
      serviceAreaCountry: p.serviceAreaCountry,
      serviceAreaRadiusKm: p.serviceAreaRadiusKm,
      serviceCategoryCount: p._count?.serviceCategories ?? 0,
      emailVerified: p.user?.emailVerifiedAt != null,
    };
  }
}

/** One refusal for "no such case" AND "not yours". */
function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Verification case not found.', 404, {
    reason: 'CASE_NOT_FOUND',
  });
}
