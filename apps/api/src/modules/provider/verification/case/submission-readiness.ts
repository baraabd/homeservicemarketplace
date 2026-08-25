import type {
  VerificationCaseState,
  VerificationDocumentKind,
} from '@homeservicemarketplace/database';

import {
  evaluateOnboarding,
  type OnboardingCandidate,
} from '../../onboarding/provider-onboarding.policy';
import { isLegalCaseTransition } from '../policy/case-transitions';
import type { ResolvedRequirements } from '../policy/requirement-resolver';

// Sprint 9B.5 — may this case be submitted, and if not, WHY?
//
// docs/adr/0010-policy-versioned-verification.md §5
//
// Recomputed on the server at submission time. A client that posts "I have
// satisfied everything" is ignored, because the client cannot see scan states
// and has no reason to be trusted about its own completeness.
//
// The interesting output is not the boolean. It is the blocker list, because
// that list is shown to a provider who has to act on it, and "something is
// wrong" is not an instruction. Two distinctions carry most of that value:
//
//   MISSING_EVIDENCE vs EVIDENCE_NOT_CLEAN
//     "upload a licence" and "the licence you uploaded has not cleared
//     scanning" are different problems with different fixes. Collapsing them
//     sends people to re-upload files that were fine, and hides the case where
//     the right response is simply to wait.
//
//   ALL blockers, not the first
//     A provider told about one missing document at a time submits four times
//     and is refused four times.
//
// Pure. No database, no clock, no I/O.

export type SubmissionBlockerCode =
  /** The case is not in a state submission is legal from. */
  | 'WRONG_STATE'
  /** A required document has not been supplied at all. */
  | 'MISSING_EVIDENCE'
  /** A required document exists but its evidence is not CLEAN. */
  | 'EVIDENCE_NOT_CLEAN'
  /** The provider profile itself is not finished. */
  | 'ONBOARDING_INCOMPLETE'
  /** The current terms version has not been accepted. */
  | 'TERMS_NOT_ACCEPTED';

export interface SubmissionBlocker {
  code: SubmissionBlockerCode;
  /** Which requirement, for the evidence blockers. */
  kind?: VerificationDocumentKind;
  serviceCategoryId?: string | null;
  /** What the scan state actually is, so the UI can say "still scanning"
   *  rather than "rejected". Never a filename, key or hash. */
  scanState?: string;
  /** Which profile field, for ONBOARDING_INCOMPLETE. */
  field?: string;
  /** Which terms version is required, for TERMS_NOT_ACCEPTED. */
  requiredVersion?: string;
}

export interface SubmissionReadiness {
  ready: boolean;
  blockers: SubmissionBlocker[];
}

interface HeldDocument {
  kind: VerificationDocumentKind;
  serviceCategoryId: string | null;
  /** The scan state of the evidence behind it. */
  scanState: string;
}

export function assessSubmissionReadiness(input: {
  state: VerificationCaseState;
  requirements: ResolvedRequirements;
  documents: ReadonlyArray<HeldDocument>;
  onboarding: OnboardingCandidate;
  terms: { requiredVersion: string | null; acceptedVersion: string | null };
}): SubmissionReadiness {
  const { state, requirements, documents, onboarding, terms } = input;

  // The state question is answered by the canonical transition table, not by a
  // second list of states kept in step by hand. `submit` is legal from DRAFT
  // and ACTION_REQUIRED — resubmission is the same edge.
  if (!isLegalCaseTransition('submit', state)) {
    // Returned ALONE and early. Telling someone their documents are incomplete
    // on a case a reviewer is already holding is noise: the fix is to wait, not
    // to upload. Listing the other blockers would invite them to act on a case
    // they must not touch.
    return { ready: false, blockers: [{ code: 'WRONG_STATE' }] };
  }

  const blockers: SubmissionBlocker[] = [];

  for (const req of requirements.requirements) {
    const matching = documents.filter(
      (doc) => doc.kind === req.kind && (doc.serviceCategoryId ?? null) === req.serviceCategoryId,
    );

    if (matching.length === 0) {
      blockers.push({
        code: 'MISSING_EVIDENCE',
        kind: req.kind,
        serviceCategoryId: req.serviceCategoryId,
      });
      continue;
    }

    // ANY clean copy satisfies. A provider whose first upload was corrupt and
    // who successfully re-sent it is satisfied by the good one rather than
    // blocked by the corpse of the first attempt.
    if (matching.some((doc) => doc.scanState === 'CLEAN')) continue;

    // Report the most advanced attempt, so "still scanning" wins over an
    // earlier rejection the provider has already replaced.
    const best = matching.find((d) => d.scanState === 'PENDING') ?? matching[0];
    blockers.push({
      code: 'EVIDENCE_NOT_CLEAN',
      kind: req.kind,
      serviceCategoryId: req.serviceCategoryId,
      scanState: best.scanState,
    });
  }

  // Delegated, not re-decided. Two definitions of "complete profile" is how a
  // provider passes one screen and is refused by the next.
  for (const issue of evaluateOnboarding(onboarding)) {
    blockers.push({ code: 'ONBOARDING_INCOMPLETE', field: issue.field });
  }

  // Pinned to a VERSION, because "they agreed" stops being true the moment the
  // terms change. No configured version means nothing to accept — this module
  // does not invent a requirement nobody stated.
  if (terms.requiredVersion !== null && terms.acceptedVersion !== terms.requiredVersion) {
    blockers.push({ code: 'TERMS_NOT_ACCEPTED', requiredVersion: terms.requiredVersion });
  }

  return { ready: blockers.length === 0, blockers };
}
