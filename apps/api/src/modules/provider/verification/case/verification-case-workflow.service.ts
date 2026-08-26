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
import { GRANT_SOURCE_FOR_APPROVAL, grantClosureFor } from '../grant/work-access-grant.policy';
import { computeGrantWindow, type GrantWindow } from '../grant/grant-validity';
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

  // ── approve: the transaction this whole area exists for ─────────────────

  /**
   * Turn checked evidence into work access.
   *
   * docs/adr/0013. EIGHT things happen and they happen TOGETHER: the case
   * moves, the decision is recorded, the provider evidence axis updates, the
   * grant opens, and the audit row, the notification and the outbox event are
   * written — all inside one transaction, under a claim conditional on the
   * state we observed.
   *
   * A partial success is the worst outcome available. A case that says
   * VERIFIED with no grant behind it lies about what the provider may do, and
   * a grant with no decision behind it is access nobody authorised. There is
   * no ordering of these writes that makes a partial success acceptable, which
   * is why they share a transaction rather than a retry queue.
   */
  async approve(
    reviewerUserId: string,
    input: {
      caseId: string;
      reasonCode: VerificationReasonCode;
      note?: string | null;
      expectedState?: VerificationCaseState;
    },
  ): Promise<CaseCommandResult> {
    // Approval carries a reason like every other judgement: "why did we trust
    // this?" is exactly what the permanent record has to answer years later.
    if (VERIFICATION_CASE_TRANSITIONS.approve.requiresReason && !input.reasonCode) {
      throw new AppError('VALIDATION_ERROR', 'A reason is required to approve this case.', 400, {
        reason: 'REASON_REQUIRED',
      });
    }

    const kase = await this.requireReviewable(input.caseId, reviewerUserId);
    if (kase.state === 'VERIFIED') return this.replay(kase, 'reviewer');
    this.assertFresh(kase, input.expectedState);
    this.assertLegal('approve', kase.state);

    // ONE clock read for the whole approval. The decision row, the grant start
    // and the grant expiry are all measured from this single instant, so they
    // cannot disagree about when the approval happened — see grant-validity.ts
    // on why a second `new Date()` here is a real failure and not pedantry.
    const decidedAt = new Date();

    // Resolved BEFORE the transaction opens. A settings read is a round trip to
    // a table nothing else in this transaction touches, and holding a write
    // transaction open across it lengthens the window in which two concurrent
    // approvals can contend for the grant index, for no benefit.
    //
    // It throws on a misconfigured validity, which fails the approval outright
    // rather than issuing a grant of some unintended length.
    const window = computeGrantWindow({
      decidedAt,
      validityDays: await this.settings.workGrantValidityDays(),
    });

    return this.commit({
      kase,
      action: 'approve',
      actor: 'reviewer',
      actorUserId: reviewerUserId,
      data: { state: 'VERIFIED', reviewerNotes: input.note ?? null, decidedAt },
      auditType: 'VERIFICATION_CASE_APPROVED',
      auditMetadata: {
        caseId: kase.id,
        providerProfileId: kase.providerProfileId,
        reasonCode: input.reasonCode,
      },
      eventType: OutboxEventType.VERIFICATION_CASE_APPROVED,
      decision: { outcome: 'APPROVED', reasonCode: input.reasonCode },
      profileUpdate: { verificationState: 'VERIFIED', verified: true },
      grant: { open: window },
      notifyProvider: 'APPROVED',
    });
  }

  // ── closing access ──────────────────────────────────────────────────────

  /** Withdraw access early. The verified history stands (ADR 0013 §6). */
  async revoke(
    reviewerUserId: string,
    input: {
      caseId: string;
      reasonCode: VerificationReasonCode;
      note?: string | null;
      expectedState?: VerificationCaseState;
    },
  ): Promise<CaseCommandResult> {
    return this.closeAccess('revoke', reviewerUserId, input);
  }

  /** Ask a verified provider for fresh evidence. NOT a sanction: the grant
   *  closes as EXPIRED, and a new case carries the re-check. */
  async reverify(
    reviewerUserId: string,
    input: {
      caseId: string;
      reasonCode: VerificationReasonCode;
      note?: string | null;
      expectedState?: VerificationCaseState;
    },
  ): Promise<CaseCommandResult> {
    return this.closeAccess('reverify', reviewerUserId, input);
  }

  private async closeAccess(
    action: 'revoke' | 'reverify',
    reviewerUserId: string,
    input: {
      caseId: string;
      reasonCode: VerificationReasonCode;
      note?: string | null;
      expectedState?: VerificationCaseState;
    },
  ): Promise<CaseCommandResult> {
    const rule = VERIFICATION_CASE_TRANSITIONS[action];
    if (rule.requiresReason && !input.reasonCode) {
      throw new AppError('VALIDATION_ERROR', 'A reason is required for this action.', 400, {
        reason: 'REASON_REQUIRED',
      });
    }

    const kase = await this.requireReviewable(input.caseId, reviewerUserId);
    if (kase.state === 'EXPIRED') return this.replay(kase, 'reviewer');
    this.assertFresh(kase, input.expectedState);
    this.assertLegal(action, kase.state);

    const closure = grantClosureFor(action);

    return this.commit({
      kase,
      action,
      actor: 'reviewer',
      actorUserId: reviewerUserId,
      data: { state: rule.to, reviewerNotes: input.note ?? null, decidedAt: new Date() },
      auditType:
        action === 'revoke' ? 'VERIFICATION_CASE_REVOKED' : 'VERIFICATION_CASE_REVERIFY_REQUIRED',
      auditMetadata: {
        caseId: kase.id,
        providerProfileId: kase.providerProfileId,
        reasonCode: input.reasonCode,
      },
      eventType: OutboxEventType.VERIFICATION_CASE_ACCESS_CLOSED,
      decision: {
        outcome: rule.outcome as 'REVOKED' | 'REVERIFY_REQUIRED',
        reasonCode: input.reasonCode,
      },
      // The evidence axis records that verification lapsed. standingState is
      // untouched: losing a grant is not a disciplinary state.
      profileUpdate: { verificationState: 'EXPIRED', verified: false },
      ...(closure ? { grant: { close: closure } } : {}),
    });
  }
  // ── expiry: the SYSTEM actor's edge ─────────────────────────────────────

  /**
   * Close a VERIFIED case whose grant window has elapsed.
   *
   * INTERNAL BY CONSTRUCTION. `VERIFICATION_CASE_TRANSITIONS.expire` names the
   * actor as `system`, and there is deliberately no controller route for it:
   * an HTTP endpoint that expires a case would be a human performing a
   * machine's act, recorded against their name, and reachable by anyone who
   * could reach the route. The only caller is VerificationExpiryService, driven
   * by the scheduled job.
   *
   * Everything else is identical to a revocation — the same single transaction,
   * the same conditional claim — with two deliberate differences:
   *
   *   the decision outcome is EXPIRED, not REVOKED, because nobody judged the
   *   provider badly and the permanent record must not imply that they did;
   *
   *   `decidedByUserId` is null, because no human decided. Attributing it to
   *   the reviewer who once approved the case, or to a service account
   *   masquerading as a person, would put a name against an act they did not
   *   perform.
   *
   * Idempotent: a case already EXPIRED replays instead of writing again, so a
   * second worker that selected the same row before the first committed does
   * nothing.
   */
  async expireCase(caseId: string, now: Date): Promise<CaseCommandResult> {
    const kase = await this.load(caseId);
    if (!kase) throw notFound();

    if (kase.state === 'EXPIRED') return this.replay(kase, 'system');
    this.assertLegal('expire', kase.state);

    return this.commit({
      kase,
      action: 'expire',
      actor: 'system',
      actorUserId: null,
      data: { state: 'EXPIRED', decidedAt: now },
      auditType: 'VERIFICATION_CASE_EXPIRED',
      auditMetadata: {
        caseId: kase.id,
        providerProfileId: kase.providerProfileId,
        reasonCode: 'POLICY_PERIOD_ELAPSED',
        // Names the machine, so an operator reading the trail is not left
        // wondering which admin did this at 03:00.
        actor: 'SYSTEM',
      },
      eventType: OutboxEventType.VERIFICATION_CASE_ACCESS_CLOSED,
      decision: { outcome: 'EXPIRED', reasonCode: 'POLICY_PERIOD_ELAPSED' },
      // The EVIDENCE axis only. An expiry says nothing about standing, and a
      // provider whose documents aged out has done nothing wrong.
      profileUpdate: { verificationState: 'EXPIRED', verified: false },
      grant: { close: 'EXPIRED' },
      notifyProvider: 'EXPIRED',
    });
  }

  // ── the shared machinery ────────────────────────────────────────────────

  private async commit(input: {
    kase: LoadedCase;
    action: VerificationCaseAction;
    actor: 'provider' | 'reviewer' | 'system';
    /** Null for the SYSTEM actor: no human decided, and inventing a user id
     *  to satisfy a column would put a person's name on a machine's act. */
    actorUserId: string | null;
    data: Record<string, unknown>;
    auditType: string;
    auditMetadata: Record<string, unknown>;
    eventType: string | null;
    decision?: {
      outcome:
        | 'ACTION_REQUIRED'
        | 'REJECTED'
        | 'APPROVED'
        | 'REVERIFY_REQUIRED'
        | 'REVOKED'
        | 'EXPIRED';
      reasonCode: VerificationReasonCode;
    };
    /** Fields to write on the provider profile, in the SAME transaction. */
    profileUpdate?: Record<string, unknown>;
    /** Open a work-access grant, or close the one that is open. */
    grant?: { open: GrantWindow } | { close: 'REVOKED' | 'EXPIRED' };
    /** Which notification the provider gets, if any. */
    notifyProvider?: 'ACTION_REQUIRED' | 'REJECTED' | 'APPROVED' | 'EXPIRED';
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

      // The provider's EVIDENCE axis. Never standingState and never status:
      // approving documents says nothing about whether the account is in good
      // standing, and a suspended provider whose documents check out is still
      // suspended. Conflating the two axes is how a suspension gets lifted by
      // an unrelated document review.
      if (input.profileUpdate) {
        await client.providerProfile.update({
          where: { id: kase.providerProfileId },
          data: input.profileUpdate,
        });
      }

      if (input.grant) {
        if ('open' in input.grant) {
          // One row per approval, carrying the case it came from and the
          // source that says it was EARNED rather than handed out.
          //
          // The concurrency guarantee comes from the PRE-EXISTING index
          // `provider_work_access_grant_one_live_per_reason`: approval always
          // writes the same reason, so a second concurrent approval collides
          // on it and fails rather than double-granting. (An earlier draft of
          // this sprint added a "one ACTIVE grant per provider" index for the
          // same job; it was dropped because it would also have collapsed a
          // MANUAL_OVERRIDE and a documents grant into one slot, erasing a
          // distinction ADR 0013 requires to survive forever.)
          await client.providerWorkAccessGrant.create({
            data: {
              providerProfileId: kase.providerProfileId,
              caseId: kase.id,
              status: 'ACTIVE',
              source: GRANT_SOURCE_FOR_APPROVAL,
              reason: input.auditType,
              grantedByUserId: input.actorUserId,
              // Frozen at issue and never recalculated. Lowering the setting
              // tomorrow shortens future approvals and re-dates nobody's
              // existing access, so "how long was this provider authorised
              // for?" stays answerable from the row itself, forever.
              grantedAt: input.grant.open.grantedAt,
              expiresAt: input.grant.open.expiresAt,
            },
          });
        } else {
          // Scoped THREE ways, and the caseId is the one that matters.
          //
          // A verification decision is a judgement about the evidence in THIS
          // case, so it may only close what THIS case issued. Closing every
          // ACTIVE grant the provider holds — which is what this did before —
          // would let a documents revocation silently destroy a MANUAL_OVERRIDE
          // somebody granted deliberately for an unrelated reason, with no
          // decision, no audit trail naming it, and no way to tell afterwards
          // that it had ever existed. ADR 0013 requires those sources to stay
          // distinguishable forever; erasing one as a side effect is the same
          // harm as merging them.
          //
          // Revocation therefore does NOT guarantee the provider stops working:
          // if they hold a separate live override, they keep working on it, and
          // that is correct. The instrument that overrides EVERY source is
          // account suspension (capability rank 3), which outranks rank 7
          // regardless of how many grants exist.
          //
          // Scoped to ACTIVE as well: re-closing an already-closed grant would
          // move its timestamp forward and rewrite when access actually ended.
          await client.providerWorkAccessGrant.updateMany({
            where: {
              providerProfileId: kase.providerProfileId,
              caseId: kase.id,
              status: 'ACTIVE',
            },
            data: {
              status: input.grant.close,
              ...(input.grant.close === 'REVOKED'
                ? { revokedAt: new Date(), revokedByUserId: input.actorUserId ?? null }
                : {}),
            },
          });
        }
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
        const kind = input.notifyProvider;
        await client.notification.create({
          data: {
            userId: kase.providerProfile.userId,
            type:
              kind === 'APPROVED'
                ? 'VERIFICATION_APPROVED'
                : kind === 'REJECTED'
                  ? 'VERIFICATION_REJECTED'
                  : kind === 'EXPIRED'
                    ? 'VERIFICATION_EXPIRED'
                    : 'VERIFICATION_ACTION_REQUIRED',
            title:
              kind === 'APPROVED'
                ? 'Your verification is complete'
                : kind === 'REJECTED'
                  ? 'Your verification could not be completed'
                  : kind === 'EXPIRED'
                    ? 'Your verification needs renewing'
                    : 'Your verification needs attention',
            // Deliberately generic, and carrying NO reason code. A notification
            // is listed, cached and pushed to a device; a rejection reason is a
            // judgement about a person and belongs behind the access-controlled
            // case, as does the reviewer's prose.
            body:
              kind === 'APPROVED'
                ? 'Your documents have been checked and you can now take work.'
                : kind === 'REJECTED'
                  ? 'A reviewer has closed your verification. Open your verification page for details.'
                  : kind === 'EXPIRED'
                    ? // Worded as a renewal, not a sanction. Nobody judged them
                      // badly; the window they were given simply ran out, and a
                      // provider told otherwise will read a punishment into it.
                      'Your verification has reached the end of its validity. Submit fresh documents to keep taking work.'
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
    actor: 'provider' | 'reviewer' | 'system',
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

  private replay(kase: LoadedCase, actor: 'provider' | 'reviewer' | 'system'): CaseCommandResult {
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
