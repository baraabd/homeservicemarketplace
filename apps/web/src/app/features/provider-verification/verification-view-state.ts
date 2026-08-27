import type {
  ProviderCapabilitiesResponse,
  ProviderVerificationCase,
  ProviderVerificationDocument,
  ProviderVerificationRequirement,
} from '@homeservicemarketplace/contracts';

// Sprint 9B.11 — which screen the provider sees, decided once, in one place.
//
// docs/sprint-09b11/PROVIDER_VERIFICATION_EXPERIENCE.md
//
// Pure, so every state can be asserted without React, a network or a browser.
// The component below it renders; it decides nothing.
//
// WHY A DERIVATION AND NOT A CHAIN OF TERNARIES IN THE COMPONENT
//
// There are twelve states and they are NOT mutually exclusive in the raw data:
// a suspended provider can also have a case in review and a quarantined file.
// Rendering from the raw fields means every branch re-decides precedence, and
// two branches eventually disagree — which is how a suspended provider gets
// shown an upload button. The order below IS the policy, written once.
//
// It deliberately mirrors the SERVER's precedence (ADR 0006 ranks): account
// first, then standing, then onboarding, then evidence, then work access. A UI
// that ordered these differently from the capability service would show
// someone a screen the API will refuse.

/** The five axes the UI must keep visibly separate (ADR 0005). Conflating any
 *  two of these is the confusion this whole surface exists to remove. */
export interface VerificationAxes {
  /** Did they finish the onboarding form? */
  onboardingComplete: boolean;
  /** Did a reviewer accept their identity documents? */
  identityVerified: boolean;
  /** Do they hold a live work-access grant right now? */
  workAccessActive: boolean;
  /** Paid tier. NEVER grants anything (ADR 0005 axis 5). */
  vip: boolean;
  /** Editorial recognition. NEVER grants anything. */
  featured: boolean;
}

export type VerificationViewState =
  | 'ACCOUNT_LOCKED'
  | 'SUSPENDED'
  | 'ONBOARDING_INCOMPLETE'
  | 'NOT_REQUIRED'
  | 'NOT_STARTED'
  | 'EVIDENCE_REQUIRED'
  | 'SCANNING'
  | 'EVIDENCE_UNUSABLE'
  | 'READY_TO_SUBMIT'
  | 'PENDING_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'VERIFIED_ACTIVE'
  | 'VERIFIED_NO_ACCESS';

export interface VerificationView {
  state: VerificationViewState;
  axes: VerificationAxes;
  /** Requirements with no usable document yet. */
  outstanding: ProviderVerificationRequirement[];
  /** Documents whose scan verdict blocks them, with the verdict kept so the
   *  UI can say WHICH problem rather than "something went wrong". */
  unusable: ProviderVerificationDocument[];
  /** Documents still being scanned. */
  scanning: ProviderVerificationDocument[];
  /** The reviewer's reason code, when there is one to act on. */
  reasonCode: string | null;
}

export interface VerificationInput {
  capabilities: ProviderCapabilitiesResponse | null;
  verificationCase: ProviderVerificationCase | null;
  profile: { verified: boolean; topPro: boolean } | null;
  /** No server source exists for a paid tier on this surface — see the doc.
   *  Threaded as an input so the badge is real the day one does. */
  vip?: boolean;
}

/** A document that is finished and usable. */
function isUsable(d: ProviderVerificationDocument): boolean {
  return d.scanState === 'CLEAN' && !d.superseded;
}

/** A document the provider must replace: the scanner found malware, could not
 *  reach a verdict, or the file was refused before scanning. All three mean
 *  "act", as opposed to PENDING which means "wait". */
function isUnusable(d: ProviderVerificationDocument): boolean {
  return (
    !d.superseded &&
    (d.scanState === 'QUARANTINED' || d.scanState === 'SCAN_FAILED' || d.scanState === 'REJECTED')
  );
}

function satisfies(
  requirement: ProviderVerificationRequirement,
  documents: ProviderVerificationDocument[],
): boolean {
  return documents.some(
    (d) =>
      isUsable(d) &&
      d.kind === requirement.kind &&
      // A trade licence is per-category: one licence does not satisfy another
      // category's requirement, and treating them as interchangeable would let
      // a plumber's licence stand in for an electrician's.
      d.serviceCategoryId === requirement.serviceCategoryId,
  );
}

export function deriveVerificationView(input: VerificationInput): VerificationView {
  const { capabilities, verificationCase: kase, profile } = input;
  const allowed = new Set(capabilities?.allowed ?? []);
  const reason = capabilities?.primaryReason ?? null;

  // Both guards are `Array.isArray`, not `?? []`.
  //
  // Sprint 9B.13: the API published `requirements` as an ARRAY and sent a
  // nested snapshot OBJECT for three sprints. An object is truthy, so `?? []`
  // let it straight through and `.filter` threw — the provider verification
  // screen crashed for every provider who had a case, while every test here
  // passed against contract-shaped fixtures.
  //
  // The API is fixed and the compiler now guards it (ProviderCaseView is an
  // alias of the contract). This stays because a client cannot verify what a
  // server sent it: a stale deployment, a proxy, or a rolled-back API can all
  // still put the wrong shape on the wire, and a provider looking at a blank
  // checklist is recoverable where a white screen is not.
  const documents = Array.isArray(kase?.documents) ? kase.documents : [];
  const requirements = Array.isArray(kase?.requirements) ? kase.requirements : [];
  const outstanding = requirements.filter((r) => !satisfies(r, documents));
  const unusable = documents.filter(isUnusable);
  const scanning = documents.filter((d) => !d.superseded && d.scanState === 'PENDING');

  const axes: VerificationAxes = {
    onboardingComplete: reason !== 'ONBOARDING_INCOMPLETE',
    identityVerified: profile?.verified ?? false,
    // The GRANT, read from the capability the grant gates. Not from
    // `verified`: a provider can be verified with no live grant, which is
    // exactly the revoked/expired state this surface has to be able to show.
    workAccessActive: allowed.has('SUBMIT_BID'),
    vip: input.vip ?? false,
    featured: profile?.topPro ?? false,
  };

  const reasonCode = kase?.latestDecision?.reasonCode ?? null;
  const base = { axes, outstanding, unusable, scanning, reasonCode };

  // ── the precedence, mirroring the server's ranks ────────────────────────

  // Rank 0/2 — the account itself. Nothing below matters.
  if (reason === 'ACCOUNT_INELIGIBLE' || reason === 'PROVIDER_TERMINATED') {
    return { ...base, state: 'ACCOUNT_LOCKED' };
  }
  // Rank 3 — suspended. Showing an upload button here would invite work that
  // will be refused, and the honest message is about the suspension.
  if (reason === 'PROVIDER_SUSPENDED') {
    return { ...base, state: 'SUSPENDED' };
  }
  // Rank 5 — still filling in the form. Verification is a later problem, and
  // putting it in front of them now competes with the task they are on.
  if (reason === 'ONBOARDING_INCOMPLETE') {
    return { ...base, state: 'ONBOARDING_INCOMPLETE' };
  }

  if (!kase) {
    // A policy that requires nothing is not a pending task. Telling a provider
    // to "start verification" that does not apply to them is a dead end with
    // no exit.
    return { ...base, state: 'NOT_STARTED' };
  }
  if (!kase.verificationRequired) {
    return { ...base, state: 'NOT_REQUIRED' };
  }

  switch (kase.state) {
    case 'VERIFIED':
      // The distinction the whole sprint turns on: verified is about the
      // DOCUMENTS, work access is about the GRANT, and a provider whose grant
      // lapsed is not un-verified — they are verified and cannot work.
      return {
        ...base,
        state: axes.workAccessActive ? 'VERIFIED_ACTIVE' : 'VERIFIED_NO_ACCESS',
      };
    case 'REJECTED':
      return { ...base, state: 'REJECTED' };
    case 'SUBMITTED':
    case 'IN_REVIEW':
      return { ...base, state: 'PENDING_REVIEW' };
    case 'EXPIRED':
      return { ...base, state: 'VERIFIED_NO_ACCESS' };
    default:
      break;
  }

  // DRAFT or ACTION_REQUIRED — the provider is the one who has to move.
  //
  // Unusable files come FIRST: a quarantined document is the one thing they
  // must replace, and burying it under "3 documents required" hides the only
  // actionable fact on the screen.
  if (unusable.length > 0) return { ...base, state: 'EVIDENCE_UNUSABLE' };
  if (kase.state === 'ACTION_REQUIRED') return { ...base, state: 'CHANGES_REQUESTED' };
  if (outstanding.length > 0) return { ...base, state: 'EVIDENCE_REQUIRED' };
  // Everything supplied, but something is still being checked. "Wait" is a
  // different instruction from "act", and the difference matters to someone
  // refreshing the page.
  if (scanning.length > 0) return { ...base, state: 'SCANNING' };
  return { ...base, state: 'READY_TO_SUBMIT' };
}
