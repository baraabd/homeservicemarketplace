import { useCallback, useEffect, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Briefcase, RefreshCw, ShieldCheck } from 'lucide-react';

import { ProviderButton, ProviderCard, ProviderNotice } from '../../provider-ui';
import { useLang } from '../../../i18n/LanguageContext';
import { useUpgradeToProvider } from '../../../hooks/provider/useProviderProfile';
import { ACTIVATION_COPY, type Lang } from '../copy/activation-copy';
import { isRetryable } from '../session/stale-role-recovery';
import { OnboardingAlert } from './OnboardingAlert';
import { OnboardingShell } from './OnboardingShell';

/** The id the sticky action points at, so the blocker is announced with it. */
const SYNC_STATUS_ID = 'activation-sync-status';

/**
 * The primary action's geometry, transcribed from the prototype's
 * `.hsm-primary`. Shared by both screens because the prototype draws one
 * button in one sticky bar on each.
 */
const PRIMARY_ACTION_STYLE = {
  minHeight: 48,
  fontSize: 14,
  fontWeight: 700,
  borderRadius: 11,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--pv-accent)',
} as const;

// Sprint 09B.29 — prototype screens 0 and 1, and the visible half of repair A.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
//
// WHY THESE TWO SHIP NOW RATHER THAN IN PHASE 5
//
// The rest of the visual work is Phase 5. These are not decoration: repair A's
// whole point is that a failed session rotation must be VISIBLE and
// recoverable, and until there is a surface to show it on, the failure is
// merely recorded. `useUpgradeToProvider` publishes a `sync` axis; this is what
// reads it.
//
// THE ORDERING RULE THIS COMPONENT ENFORCES
//
// Nothing navigates to a provider route until the authoritative session has
// been verified to carry the provider role. `mutateAsync` resolves only after
// `synchronize()` has run, and the navigation below is gated on
// `sync.state.kind === 'recovered'` — not on the upgrade's own success, which
// is exactly the mistake that produced the 403 loop. A provider profile exists
// the moment the upgrade commits; the SESSION is the thing that lags, and the
// session is what routing must wait for.

interface ProviderActivationScreenProps {
  /** Where to go once the session is genuinely usable. */
  destination?: string;
  /**
   * Whether this account ALREADY has a provider profile.
   *
   * Passed in rather than queried here so the screen does not open a second
   * observer on a query the shell already holds.
   */
  hasProfile?: boolean;
  /** Where a visitor who already activated belongs. */
  alreadyActivatedDestination?: string;
}

export function ProviderActivationScreen({
  destination = '/provider/onboarding',
  hasProfile = false,
  alreadyActivatedDestination = '/provider',
}: ProviderActivationScreenProps) {
  const { lang: rawLang } = useLang();
  const lang = (rawLang === 'ar' ? 'ar' : 'en') as Lang;
  const copy = ACTIVATION_COPY[lang];
  const navigate = useNavigate();

  const upgrade = useUpgradeToProvider();
  const syncState = upgrade.sync.state;

  // Focus target for a failed synchronization. WCAG 2.2 AA: a recovery action
  // the provider cannot find is not a recovery action, and the transition here
  // replaces the whole body of the screen without moving focus on its own.
  const recoveryRef = useRef<HTMLDivElement>(null);

  /**
   * A refusal the server has already considered, as opposed to a transport
   * failure.
   *
   * `exhausted` and `failed/role-missing` are the same fact reached by two
   * routes — the hub's recovery hook reports the first, this mutation reports
   * the second — and they must read identically. Branching on `exhausted`
   * alone (the first draft) mislabelled every role-missing outcome as a failed
   * refresh and offered a retry that could not help.
   */
  const refused =
    syncState.kind === 'exhausted' ||
    (syncState.kind === 'failed' && syncState.reason === 'role-missing');

  const failed = syncState.kind === 'failed' || syncState.kind === 'exhausted' || upgrade.isError;

  /**
   * Whether the synchronization screen is the one to show.
   *
   * NOT `upgrade.isSuccess`. React Query v5 awaits `onSuccess` before the
   * mutation settles, and `onSuccess` is where the rotation happens — so
   * `isSuccess` is still false for the whole time screen 1 needs to be on
   * display, and gating on it left the provider looking at the activation
   * button while their session was being rotated behind it.
   *
   * The sync axis leaves `idle` only from inside that callback, so it is a
   * precise signal that the upgrade committed and the rotation has begun.
   */
  const showSyncScreen = upgrade.isSuccess || syncState.kind !== 'idle';

  useEffect(() => {
    if (failed) recoveryRef.current?.focus();
  }, [failed]);

  // The ONLY navigation out of this screen, and it is gated on the verified
  // session rather than on the upgrade response.
  useEffect(() => {
    if (syncState.kind === 'recovered') navigate(destination, { replace: true });
  }, [destination, navigate, syncState.kind]);

  const onActivate = useCallback(() => {
    // `isPending` guards the duplicate submission; the button is also disabled.
    // Both, because a keyboard repeat can fire faster than a re-render.
    if (upgrade.isPending) return;
    upgrade.mutate();
  }, [upgrade]);

  const backToProfile = () => navigate('/provider');

  /**
   * A visitor who already activated belongs elsewhere — but ONLY if they are
   * not activating right now.
   *
   * The upgrade seeds the profile cache the moment it commits, so a redirect
   * that looked only at `hasProfile` fired mid-flow: it ejected the provider to
   * the status screen between the upgrade and the session rotation, which is
   * precisely the window this screen exists to cover. The browser journey
   * caught it — the page under assertion was the status surface, not the sync
   * one.
   *
   * Gating on an untouched mutation AND an untouched sync axis makes the
   * redirect mean "you arrived here already activated", which is the only case
   * it was ever for.
   */
  if (hasProfile && upgrade.status === 'idle' && syncState.kind === 'idle') {
    return <Navigate to={alreadyActivatedDestination} replace />;
  }

  // ── Screen 1: synchronization, and everything that can go wrong in it ────
  //
  // Reached once the upgrade has succeeded. The upgrade itself is not retried
  // from here: the role is already committed, and re-running it would be a
  // second write for a problem that is not there.
  if (showSyncScreen) {
    return (
      <OnboardingShell
        title={copy.syncTitle}
        subtitle={copy.syncSubtitle}
        progress={5}
        onClose={backToProfile}
        padded={false}
        // The prototype pins a primary action to the bottom of this screen too
        // — `.hsm-sticky` with `Continue after sync`. Omitting it was the
        // single largest block in the screen-1 diff: 17,020 differing pixels in
        // the bottom 79px in English and 17,058 in Arabic, a figure that is the
        // same in both languages because what was missing is chrome, not text.
        //
        // It also moved everything above it. The prototype's bar is
        // `position: absolute`, so `.hsm-center` is the full 696px and clears
        // the bar with a 110px bottom inset — centring its content in the 558px
        // that remain. Here the bar is a flex sibling, so the area is 617px and
        // 31px of bottom padding reproduces the same 558px box. Without the bar
        // the area was 696px, the box became 637px, and the content sat 40px
        // low.
        //
        // WHY IT IS NOT `disabled`. Navigation out of this screen is gated on
        // the VERIFIED session, never on the upgrade — that ordering is the
        // whole of repair A and this button does not get to bypass it. But a
        // `disabled` control is unreachable by keyboard, and this is the only
        // place the reason is explained. So it stays focusable, says it is
        // unavailable through `aria-disabled`, points at the live status for
        // why, and its handler refuses to move until the session is genuinely
        // usable.
        footer={
          failed ? undefined : (
            <ProviderButton
              className="w-full"
              style={PRIMARY_ACTION_STYLE}
              aria-disabled={syncState.kind === 'recovered' ? undefined : true}
              aria-describedby={SYNC_STATUS_ID}
              onClick={() => {
                if (syncState.kind === 'recovered') navigate(destination, { replace: true });
              }}
              data-testid="activation-sync-cta"
            >
              {copy.syncContinueCta}
            </ProviderButton>
          )
        }
      >
        <div
          data-testid="activation-sync-screen"
          className="grid flex-1 text-center"
          // `.hsm-center`, reproduced through a different layout mechanism.
          //
          // 28px top and 31px bottom, not the prototype's 28/110: its sticky
          // bar is absolutely positioned and overlaps this area, ours is a flex
          // sibling and does not. Both arrive at the same 558px centring box —
          // the arithmetic is on the `footer` prop above.
          //
          // `justify-items` is left at `stretch`, as the prototype has it. The
          // children measure the full 348px column, which is what makes the
          // heading and the lead break their lines where the reference does;
          // only the icon centres itself, with its own `margin: auto`.
          style={{ alignContent: 'center', gap: 16, padding: '28px 20px 31px' }}
        >
          {/* `.hsm-center-icon`: 72px, radius 24, on the soft accent with the
              STRONG accent as its foreground (`--hsm-accent-strong`, which is
              `--pv-accent-hover` here — not `--pv-accent`).

              `margin: auto` rather than a `justify-items-center` on the grid:
              the prototype stretches its centre children to the full 348px
              column and centres only this one, and stretching is what makes the
              heading and the alert measure the same width as the reference. */}
          <span
            data-testid="activation-sync-icon"
            className="flex items-center justify-center bg-pv-accent-subtle text-pv-accent-hover"
            style={{ width: '72px', height: '72px', borderRadius: 24, margin: 'auto' }}
            aria-hidden="true"
          >
            <RefreshCw
              size={16}
              className={
                syncState.kind === 'recovering'
                  ? 'animate-spin motion-reduce:animate-none'
                  : undefined
              }
            />
          </span>

          {/* Shown only while things are going normally.
              On failure the alert below carries the title, the body and the
              actions as one block, and repeating them here put the same
              sentence on screen twice — which reads as two separate problems
              and is what the duplicate-text assertion caught. The shell's `h1`
              is unaffected, so no heading level is skipped.

              Weight 500, not bold: `.hsm-center h1` declares no weight, so it
              takes the prototype wrapper's `h1 { font-weight: 500 }`. Measured,
              not assumed — see OnboardingAlert for the same fact and why the
              capture does not neutralise that rule. */}
          {!failed && (
            <>
              <h2
                data-testid="activation-sync-heading"
                className="break-words text-pv-hero text-pv-text"
                style={{ fontWeight: 500, lineHeight: 1.4 }}
              >
                {copy.syncHeading}
              </h2>
              {/* No width cap. The reference paragraph is the full 348px
                  column, and a `max-w-[46ch]` here broke the lines earlier than
                  the reference does. */}
              <p
                data-testid="activation-sync-lead"
                className="break-words text-pv-body text-pv-muted"
                style={{ lineHeight: 1.8 }}
              >
                {copy.syncLead}
              </p>
            </>
          )}

          {/* The live region. Announced politely so a screen-reader user learns
              the rotation is happening without the whole screen being
              re-read. It is also what the sticky action's `aria-describedby`
              points at, so pressing an unavailable Continue explains itself.

              Absolutely positioned by `sr-only`, so it creates no grid row and
              contributes no gap. */}
          <div id={SYNC_STATUS_ID} role="status" aria-live="polite" className="sr-only">
            {syncState.kind === 'recovering' ? copy.syncLiveStatus : ''}
          </div>

          {/* The reassurance the prototype draws, shown while the rotation is
              in flight. This sentence is the reason a provider does not go
              looking for the sign-in button. */}
          {(syncState.kind === 'recovering' || syncState.kind === 'idle') && (
            <div data-testid="activation-sync-notice">
              {/* `OnboardingAlert`, not `ProviderNotice`. The prototype's
                  `.hsm-alert` differs from the workspace notice in six measured
                  ways, all of which showed in the diff; the reasoning and the
                  measurements are recorded on the component. Alignment is
                  inherited from the centred column, so no `text-start` here. */}
              <OnboardingAlert
                tone="waiting"
                icon={ShieldCheck}
                title={copy.syncNoticeTitle}
                body={copy.syncNoticeBody}
              />
            </div>
          )}

          {/* Recovery. `tabIndex={-1}` so the effect above can move focus here
              without putting it in the tab order permanently. */}
          {failed && (
            <div
              ref={recoveryRef}
              tabIndex={-1}
              role="alert"
              className="w-full text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
              data-testid="activation-sync-error"
              data-reason={refused ? 'role-missing' : 'refresh-failed'}
            >
              <ProviderNotice
                tone={refused ? 'danger' : 'blocked'}
                title={refused ? copy.syncRefusedTitle : copy.syncFailedTitle}
                description={refused ? copy.syncRefusedBody : copy.syncFailedBody}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {/* Offered only where a retry can change the answer. A button
                    that re-asks a question the server has already answered is a
                    lie about what is happening. */}
                {isRetryable(syncState) && (
                  <ProviderButton
                    onClick={() => void upgrade.sync.retry()}
                    data-testid="activation-sync-retry"
                  >
                    {copy.syncRetryCta}
                  </ProviderButton>
                )}
                {refused && (
                  <ProviderButton tone="secondary" onClick={backToProfile}>
                    {copy.contactSupportCta}
                  </ProviderButton>
                )}
              </div>
            </div>
          )}
        </div>
      </OnboardingShell>
    );
  }

  // ── Screen 0: activation ─────────────────────────────────────────────────
  return (
    <OnboardingShell
      title={copy.activateTitle}
      progress={0}
      onClose={backToProfile}
      // The primary action belongs in the STICKY bar, not in the content flow.
      //
      // The prototype pins it to the bottom of the surface (`.hsm-sticky`), and
      // rendering it inline instead left it floating directly under the card
      // with empty space beneath — which is what the visual gate reported as the
      // larger of the two differences on screen 0.
      footer={
        <ProviderButton
          className="w-full"
          style={PRIMARY_ACTION_STYLE}
          onClick={onActivate}
          disabled={upgrade.isPending}
          aria-busy={upgrade.isPending || undefined}
          data-testid="activation-cta"
        >
          {upgrade.isPending
            ? copy.activatePending
            : upgrade.isError
              ? copy.upgradeRetryCta
              : copy.activateCta}
        </ProviderButton>
      }
    >
      <div className="flex flex-col gap-5" data-testid="activation-screen">
        {/* The hero. `-mx-4 -mt-4` cancels the shell's own gutter so the
            gradient runs edge to edge exactly as the prototype draws it. */}
        <div
          className="-mx-4 -mt-4 px-5 py-6"
          style={{
            background: 'linear-gradient(135deg, var(--pv-hero-from), var(--pv-hero-to))',
            color: 'var(--pv-hero-fg)',
          }}
          data-testid="activation-hero"
        >
          <span
            className="mb-4 flex items-center justify-center rounded-2xl"
            style={{ width: '52px', height: '52px', background: 'rgb(255 255 255 / 0.16)' }}
            aria-hidden="true"
          >
            {/* 16px for the same reason the shell's close icon is: the
                prototype's icon build does not carry the requested size onto
                the `<svg>` it substitutes, so `hsmIcon('briefcase',26)`
                renders at 16. Measured, not assumed. */}
            <Briefcase size={16} />
          </span>
          <h2 className="break-words text-pv-hero font-bold" style={{ lineHeight: 1.35 }}>
            {copy.activateHeading}
          </h2>
          <p
            className="mt-2 break-words text-pv-body"
            style={{ color: 'var(--pv-hero-fg-muted)', lineHeight: 1.75 }}
          >
            {copy.activateLead}
          </p>
        </div>

        <ProviderCard className="p-4" style={{ borderRadius: 14 }} data-testid="activation-panel">
          <h3
            className="break-words text-pv-input text-pv-text"
            style={{ marginBottom: 5, fontWeight: 500, lineHeight: 1.25 }}
          >
            {copy.needTitle}
          </h3>
          <p className="break-words text-pv-label text-pv-muted" style={{ lineHeight: 1.65 }}>
            {copy.needBody}
          </p>
        </ProviderCard>

        {/* The upgrade request itself failing is a different fact from the
            rotation failing, and gets its own message. Nothing was changed on
            the account, so the only action is to try again. */}
        {upgrade.isError && (
          <div
            ref={recoveryRef}
            tabIndex={-1}
            role="alert"
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
            data-testid="activation-upgrade-error"
          >
            <ProviderNotice
              tone="danger"
              title={copy.upgradeFailedTitle}
              description={copy.upgradeFailedBody}
            />
          </div>
        )}

        {/* Announced while the upgrade request is open, for the same reason the
            sync screen has one. */}
        <div role="status" aria-live="polite" className="sr-only">
          {upgrade.isPending ? copy.activatePending : ''}
        </div>
      </div>
    </OnboardingShell>
  );
}
