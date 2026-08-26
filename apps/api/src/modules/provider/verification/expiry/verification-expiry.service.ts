import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { VerificationCaseWorkflowService } from '../case/verification-case-workflow.service';

// Sprint 9B.7 — the SYSTEM actor that closes verifications whose time ran out.
//
// docs/adr/0013-evidence-to-work-access-capability-transition.md
//
// WHY THIS EXISTS AT ALL, GIVEN EXPIRY IS COMPUTED AT READ TIME
//
// ADR 0013 is explicit that ACCESS is a time predicate evaluated by the
// database — `revokedAt IS NULL AND now() BETWEEN grantedAt AND
// COALESCE(expiresAt,'infinity')` — precisely so a failed cron can never leave
// access granted that nobody authorised. That property is preserved here and
// this sweep is NOT load-bearing for authorization: a provider whose window
// lapsed is denied on their next request whether or not this job ever runs.
//
// What genuinely needs a writer is everything the predicate cannot express:
//
//   the CASE is still VERIFIED, so the review queue, the provider's own page
//   and every report still describe a verification that has in fact lapsed;
//
//   `providerProfile.verificationState` is still VERIFIED, and nothing
//   recomputes it per request;
//
//   no decision, audit row, notification or event exists, so the provider is
//   never told, and the history has a gap exactly where the interesting event
//   was.
//
// So the sweep is a lifecycle-and-truthfulness job, not an access control. If
// it stops, access stays correct and the record goes stale — which is the right
// way round for a background job to fail.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// Lapsed grants with no VERIFIED case behind them — MANUAL_OVERRIDE and
// LEGACY_BACKFILL rows — are left alone. They are already denied at read time,
// and there is no case to transition and no decision to record; writing one
// would mean inventing a judgement nobody made.

/** Cases per pass. Bounded so a backlog is drained over several runs instead of
 *  holding a connection for minutes on first boot after a long outage. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export interface ExpirySweepResult {
  /** Due cases this pass looked at. */
  scanned: number;
  /** Cases this worker actually transitioned. */
  expired: number;
  /** Due cases another worker had already taken. Not an error. */
  alreadyDone: number;
  /** Cases that threw. The sweep continues; the next pass retries them. */
  failed: number;
}

@Injectable()
export class VerificationExpiryService {
  private readonly log = new Logger(VerificationExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: VerificationCaseWorkflowService,
  ) {}

  /**
   * Expire every verification whose grant window has closed.
   *
   * `now` is injected rather than read here, so a test can place the clock
   * exactly on, before and after a boundary without sleeping or mocking Date
   * globally — the same shape `EvidenceCleanupService.sweepExpiredPreparations`
   * already uses in this codebase.
   *
   * Safe to run concurrently. Selection is not a claim: two workers may pick the
   * same case, and the conditional update inside `expireCase` lets exactly one
   * of them write. The loser sees the case already EXPIRED and reports it as
   * `alreadyDone` rather than failing — a race that both workers survive.
   */
  async runOnce(options: { now?: Date; limit?: number } = {}): Promise<ExpirySweepResult> {
    const now = options.now ?? new Date();
    const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    // Driven from the GRANT, because the grant carries the window. Ordered
    // oldest-expiry-first so a backlog drains in the order it accumulated and
    // the provider who has been wrongly shown as verified longest is corrected
    // first.
    const due = await this.prisma.client.providerWorkAccessGrant.findMany({
      where: {
        status: 'ACTIVE',
        revokedAt: null,
        expiresAt: { not: null, lte: now },
        // Only a live verification has a lifecycle left to close. A grant whose
        // case is already REJECTED or EXPIRED needs nothing from this sweep.
        case: { is: { state: 'VERIFIED' } },
      },
      select: { caseId: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    const caseIds = [
      ...new Set(due.map((g) => g.caseId).filter((id): id is string => id !== null)),
    ];

    const result: ExpirySweepResult = {
      scanned: caseIds.length,
      expired: 0,
      alreadyDone: 0,
      failed: 0,
    };

    for (const caseId of caseIds) {
      try {
        const out = await this.workflow.expireCase(caseId, now);
        if (out.changed) result.expired += 1;
        else result.alreadyDone += 1;
      } catch (err) {
        // One bad case must not strand the rest of the batch. It is logged and
        // left due, so the next pass retries it — as opposed to a sweep that
        // aborts and never reaches the cases behind it.
        result.failed += 1;
        this.log.warn({
          msg: 'verification.expiry.case.failed',
          caseId,
          err: (err as Error).message,
        });
      }
    }

    if (result.expired > 0 || result.failed > 0) {
      this.log.log({ msg: 'verification.expiry.swept', ...result });
    }
    return result;
  }
}
