import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { BadgeCheck, Clock } from 'lucide-react';

import { getVerificationCase } from '../../../../lib/provider/provider-verification-api';
import { useProviderProfile } from '../../../hooks/provider/useProviderProfile';
import { useProviderCapabilities } from '../../../hooks/provider/useProviderCapabilities';
import { useProviderOnboardingHub } from '../../../hooks/provider/useProviderOnboardingHub';
import {
  useOnboardingDraft,
  useWithdrawOnboarding,
} from '../../../hooks/provider/useProviderOnboarding';
import { useOnboardingReview } from '../../../hooks/provider/useProviderOnboardingReview';
import { useLang } from '../../../i18n/LanguageContext';
import { ProviderButton, ProviderSkeleton } from '../../provider-ui';
import type { ProviderTone } from '../../provider-ui/status';
import { STATUS_CENTRE_COPY, type Lang } from '../copy/status-centre-copy';
import { REVIEW_FEEDBACK_COPY } from '../copy/review-feedback-copy';
import { OnboardingAlert } from './OnboardingAlert';
import { OnboardingAxisPanel, type OnboardingAxisRow } from './OnboardingAxisPanel';
import { OnboardingShell } from './OnboardingShell';

// Sprint 09B.29 Phase 5A — approved screens 14 and 17.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
// docs/adr/0005-provider-lifecycle-axes.md
// docs/adr/0006-provider-capability-service.md
//
// WHAT THIS REPLACES, AND WHY THE OLD ONE WAS WRONG
//
// `ProviderStatusState` renders one card per `profile.status`: an icon, a
// heading and a sentence. For PENDING_REVIEW it says "Your provider
// application has been received and is being reviewed", and that single
// sentence is standing in for FOUR independent facts. A provider whose
// specialties are still with a moderator, whose identity documents were never
// requested, and who could not take work even if approved, reads the same words
// as one who is minutes from activation.
//
// ADR 0005 says those axes are independent. The approved design says so on
// screen, in four rows, and that is what this draws.
//
// EVERY ROW IS THE SERVER'S
//
//   completion    the onboarding hub's own counters and status
//   specialty     the profile's pending categories — the moderator's queue
//   standing      the profile status, once there is no application to discuss
//   verification  the verification CASE's own state machine
//   work access   the CAPABILITY service, never `status === 'ACTIVE'`. Deriving
//                 work access from a lifecycle enum is precisely the mistake
//                 ADR 0006 was written to end.
//
// CLOSED IN PHASE 5B (G-11): verification used to be projected from
// `profile.verified` plus whether the application had been handed in. That
// produces a plausible answer and a wrong one — a provider whose documents were
// sent back and a provider whose case was refused both read "In review" — so the
// row now reads `GET /me/provider/verification/case` and renders its state.
//
// CLOSED IN PHASE 5B (G-12): the header's clock formats in the PROVIDER's stored
// zone, from the draft, so this screen and the submission confirmation cannot
// timestamp the same application an hour apart.

/** The two approved screens this surface is, chosen by work access. */
type Screen = 'waiting' | 'active';

const CASE_KEY = ['provider', 'verification', 'case'] as const;

export function ProviderStatusCentreScreen() {
  const { lang: rawLang } = useLang();
  const lang = (rawLang === 'ar' ? 'ar' : 'en') as Lang;
  const copy = STATUS_CENTRE_COPY[lang];
  const navigate = useNavigate();

  const profileQuery = useProviderProfile();
  const hubQuery = useProviderOnboardingHub();
  // The same key the verification screen uses, so the two share one answer
  // rather than asking the capability service the same question twice.
  const capsQuery = useProviderCapabilities();
  // G-11 — the verification axis, READ rather than guessed.
  //
  // It used to be projected from `profile.verified` plus whether the
  // application had been handed in, which produces a plausible answer and a
  // wrong one: a provider whose documents were sent back saw "In review", and a
  // provider whose case was refused saw the same. Both of those are somebody
  // waiting for nothing.
  //
  // Same key the verification screen uses, so the two share one answer.
  const caseQuery = useQuery({ queryKey: CASE_KEY, queryFn: getVerificationCase, retry: 1 });

  // The withdraw command and the server's verdict on whether it would succeed.
  //
  // `canWithdraw` is computed from the SAME states the server scopes the write
  // to, so a control that appears is a control that works. Deciding it here —
  // "the status is PENDING_REVIEW, so surely they can withdraw" — is how a
  // client offers a button the server answers with a 409.
  const review = useOnboardingReview(lang);

  /**
   * G-12 — the zone this screen's clock is in.
   *
   * The header prints "Updated today at 12:43" and used to format it in the
   * READER's zone. The submission confirmation (state 13) formats in the
   * PROVIDER's stored zone, taken from the draft, so the two surfaces
   * disagreed for anyone travelling: the same application, timestamped an hour
   * apart on two screens, with nothing to say which was meant.
   *
   * The draft is where that zone lives, so this screen reads it too. It is
   * deliberately NOT part of the readiness gate below — `isFetched` is true
   * after a failure as well as a success, so a draft that cannot be read costs
   * the reader nothing worse than the zone their own device reports, which is
   * what they used to get every time.
   */
  const draftQuery = useOnboardingDraft();
  const withdraw = useWithdrawOnboarding();

  const profile = profileQuery.data?.profile;
  const hub = hubQuery.data;
  const allowed = capsQuery.isError ? [] : (capsQuery.data?.allowed ?? []);

  // Work access, and nothing else, decides which screen this is. Not
  // `status === 'ACTIVE'`: the whole point of the capability service is that
  // the two can disagree, and when they do the provider must be shown what they
  // can actually DO.
  // The literal, not the contract enum: web cannot import RUNTIME values from
  // `@homeservicemarketplace/contracts` (CJS/Rollup), and this is the spelling
  // `verification-view-state.ts` already uses for the same capability.
  const hasWorkAccess = allowed.includes('SUBMIT_BID');
  const screen: Screen = hasWorkAccess ? 'active' : 'waiting';

  const settled =
    profileQuery.isFetched && hubQuery.isFetched && capsQuery.isFetched && caseQuery.isFetched;

  // ── The axes ──────────────────────────────────────────────────────────────

  const applicationComplete =
    hub !== undefined &&
    ((hub.progress.total > 0 && hub.progress.complete >= hub.progress.total) ||
      hub.status === 'SUBMITTED' ||
      hub.status === 'ACTIVE');

  const specialtiesPending = (profile?.pendingCategories?.length ?? 0) > 0;

  /**
   * The verification axis, from the case's own state machine.
   *
   * `profile.verified` is still consulted, but only as the confirmation that a
   * VERIFIED case really did grant the badge — it is never the source of the
   * word shown, because it cannot distinguish "not started" from "refused".
   */
  const verificationAxis = ((): {
    status: string;
    tone: ProviderTone;
    needsProviderAttention: boolean;
  } => {
    if (caseQuery.isError || !caseQuery.isFetched) {
      return { status: copy.valueUnknown, tone: 'todo', needsProviderAttention: false };
    }

    const state = caseQuery.data?.case?.state ?? null;
    switch (state) {
      case 'VERIFIED':
        return { status: copy.valueVerified, tone: 'done', needsProviderAttention: false };
      case 'SUBMITTED':
      case 'IN_REVIEW':
        return { status: copy.valueInReview, tone: 'waiting', needsProviderAttention: false };
      case 'ACTION_REQUIRED':
        // Blocked, not waiting. The provider has something to do and the row
        // has to say so — this is the case the old inference read as "In
        // review", leaving somebody waiting for a queue they were not in.
        return { status: copy.valueActionRequired, tone: 'blocked', needsProviderAttention: true };
      case 'REJECTED':
        return { status: copy.valueRejected, tone: 'danger', needsProviderAttention: true };
      case 'EXPIRED':
        return { status: copy.valueExpired, tone: 'blocked', needsProviderAttention: true };
      case 'DRAFT':
      case null:
        return { status: copy.valueNotStarted, tone: 'todo', needsProviderAttention: true };
      default:
        // A state this bundle has never heard of. Saying "unavailable" is the
        // honest rendering; picking the nearest known word would be a guess
        // about a decision somebody else made.
        return { status: copy.valueUnknown, tone: 'todo', needsProviderAttention: false };
    }
  })();
  // Standing is only a question once the application is no longer one. A
  // suspended or terminated provider does not reach this screen with work
  // access, so "Good" is the honest answer beside an active account.
  const standingGood = profile?.status === 'ACTIVE';

  const rows: OnboardingAxisRow[] = [
    {
      id: 'completion',
      label: copy.axisCompletion,
      status: applicationComplete ? copy.valueComplete : copy.valueInReview,
      tone: applicationComplete ? 'done' : 'waiting',
    },
    screen === 'active'
      ? {
          id: 'standing',
          label: copy.axisStanding,
          status: standingGood ? copy.valueGood : copy.valueInReview,
          tone: standingGood ? 'done' : 'waiting',
        }
      : {
          id: 'specialty',
          label: copy.axisSpecialty,
          status: specialtiesPending ? copy.valueInReview : copy.valueComplete,
          tone: specialtiesPending ? 'waiting' : 'done',
        },
    {
      id: 'verification',
      label: copy.axisVerification,
      status: verificationAxis.status,
      tone: verificationAxis.tone,
    },
    {
      id: 'work-access',
      label: copy.axisWorkAccess,
      status: hasWorkAccess ? copy.valueActive : copy.valueNotActive,
      tone: hasWorkAccess ? 'done' : 'todo',
    },
  ];

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!settled) {
    return (
      <OnboardingShell title={copy.waitingTitle} onClose={() => navigate('/select')}>
        <div role="status" aria-live="polite" data-testid="provider-status-loading">
          <span className="sr-only">{copy.waitingTitle}</span>
          <ProviderSkeleton rows={4} />
        </div>
      </OnboardingShell>
    );
  }

  // ── Screen 17: the handoff ────────────────────────────────────────────────
  if (screen === 'active') {
    return (
      <OnboardingShell
        title={copy.activeTitle}
        progress={100}
        onClose={() => navigate('/provider/jobs')}
        padded={false}
        footer={
          <ProviderButton
            tone="primary"
            shape="onboarding"
            size="block"
            onClick={() => navigate('/provider/jobs')}
            data-testid="workspace-enter"
          >
            {copy.openWorkspace}
          </ProviderButton>
        }
      >
        {/* `.hsm-center`, with the same 28/20/31 arithmetic as the other centred
            screens: the reference's sticky bar is absolutely positioned and
            overlaps this area, ours is a flex sibling and does not. Both arrive
            at the same centring box. */}
        <div
          className="grid flex-1 text-center"
          style={{ alignContent: 'center', gap: 16, padding: '28px 20px 31px' }}
          data-testid="provider-workspace-unlocked"
          role="status"
          aria-live="polite"
        >
          <span
            className="flex items-center justify-center bg-pv-accent-subtle text-pv-accent-hover"
            style={{ width: '72px', height: '72px', borderRadius: 24, margin: 'auto' }}
            aria-hidden="true"
          >
            <BadgeCheck size={16} strokeWidth={1.8} />
          </span>

          {/* `<h2>`, not the reference's `<h1>`: the shell's header owns the
              page's h1 and skipping a level to match a tag name would break the
              heading order for no visual difference. */}
          <h2
            className="break-words text-pv-hero text-pv-text"
            style={{ fontWeight: 500, lineHeight: 1.4 }}
          >
            {copy.activeHeading}
          </h2>
          <p className="break-words text-pv-body text-pv-muted" style={{ lineHeight: 1.8 }}>
            {copy.activeLead}
          </p>

          {/* Still four rows, all green. The provider has just been told they
              may work; the panel says which four things had to be true, so the
              day one of them stops being true they already know where to look. */}
          <OnboardingAxisPanel rows={rows} data-testid="provider-status-axes" />
        </div>
      </OnboardingShell>
    );
  }

  // ── Screen 14: the status centre ──────────────────────────────────────────
  //
  // `updatedAt` is the server's, formatted here. The reference prints a time in
  // the header, and a client clock would drift from the fact it claims to
  // timestamp.
  // The provider's stored zone, then the one their country resolves to, then
  // nothing — in which case `Intl` uses the reader's own, as before.
  const providerZone =
    draftQuery.data?.data?.timezone ??
    draftQuery.data?.data?.resolvedTimezone?.resolved ??
    undefined;
  const updated = profile?.updatedAt ? formatTime(profile.updatedAt, lang, providerZone) : null;

  return (
    <OnboardingShell
      title={copy.waitingTitle}
      subtitle={updated ? copy.waitingSubtitle(updated) : null}
      progress={100}
      onClose={() => navigate('/select')}
      footer={
        // Secondary, and the reference is right that it is: withdrawing STOPS a
        // review that is already running, and a primary-weight button would
        // invite it. Drawn only when the server says the command would succeed
        // — `canWithdraw` is computed from the same states the write is scoped
        // to, so a control that appears is a control that works.
        // Withdrawing STOPS the review and requires a fresh submission. It
        // does not delete the draft, the uploaded evidence or the review
        // history — which is why the label says "to edit" and why this is a
        // secondary action rather than a destructive one.
        <ProviderButton
          tone="secondary"
          shape="onboarding"
          size="block"
          disabled={review.data?.canWithdraw !== true || withdraw.isPending}
          onClick={() =>
            withdraw.mutate(undefined, {
              // Straight to the application, because editing it is the entire
              // reason for the command. Only on SUCCESS: a failed withdraw that
              // navigated anyway would show a provider an application the
              // server still considers submitted.
              onSuccess: () => navigate('/provider/onboarding'),
            })
          }
          data-testid="status-withdraw"
        >
          {copy.withdraw}
        </ProviderButton>
      }
    >
      <div className="flex flex-col gap-[18px]" data-testid="provider-status-centre">
        <OnboardingAlert
          tone="waiting"
          icon={Clock}
          title={copy.waitingAlertTitle}
          body={copy.waitingAlertBody}
          density="compact"
          data-testid="status-waiting-alert"
        />

        <OnboardingAxisPanel rows={rows} data-testid="provider-status-axes" />

        {/* The pending-review surface stays focused on waiting. A document
            entry is needed when the case asks the provider to act, while the
            dedicated verification route remains reachable in every state.
            The destination's API still owns upload and renewal permissions. */}
        {verificationAxis.needsProviderAttention ? (
          <ProviderButton
            tone="secondary"
            shape="onboarding"
            size="block"
            onClick={() => navigate('/provider/verification')}
            data-testid="status-view-verification"
          >
            {REVIEW_FEEDBACK_COPY[lang].viewVerification}
          </ProviderButton>
        ) : null}

        {/* The reference's second button. In the prototype it jumps to the
            action-required screen; here it does the real equivalent — reopens
            the application the provider handed in, which is the only thing on
            this screen they can actually go and look at. */}
        <ProviderButton
          tone="secondary"
          shape="onboarding"
          size="block"
          onClick={() => navigate('/provider/onboarding')}
          data-testid="status-view-application"
        >
          {copy.viewApplication}
        </ProviderButton>
      </div>
    </OnboardingShell>
  );
}

/**
 * 24-hour, in the reader's locale and the PROVIDER's zone.
 *
 * The header prints a clock time and nothing else, so the format is the one a
 * person checks against their own. The zone is the provider's rather than the
 * device's — G-12 — so this screen and the submission confirmation cannot
 * timestamp the same application an hour apart. An absent zone falls back to
 * the device, which is what every reader got before.
 */
function formatTime(iso: string, lang: Lang, timeZone?: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(at);
  } catch {
    // A zone the platform does not know throws rather than degrading. A wrong
    // hour is worse than the device's, so fall back rather than propagate.
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  }
}
