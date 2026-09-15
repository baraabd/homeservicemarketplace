import { lazy, Suspense, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Map, Briefcase, Wallet, User, MessageCircle } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useLocation, useMatch, useNavigate } from 'react-router';
import type {
  ProviderCapabilitiesResponse,
  ProviderProfileSummary,
} from '@homeservicemarketplace/contracts';

import { useLang, LangToggle } from '../../i18n/LanguageContext';
import { isProviderOnboardingV2Enabled } from '../../../lib/feature-flags';
import { useProviderProfile } from '../../hooks/provider/useProviderProfile';
import { useProviderCapabilities } from '../../hooks/provider/useProviderCapabilities';
import { ProviderAccessUnavailable } from './ProviderAccessUnavailable';
import { useAuthIdentity } from '../../../lib/use-auth-identity';
import { ProviderStatusState } from './ProviderStatusState';
import { ProviderOnboardingWizard } from './onboarding/ProviderOnboardingWizard';
import { ProviderActivationScreen } from '../../features/provider-onboarding-v2/components/ProviderActivationScreen';
import { ProviderStatusCentreScreen } from '../../features/provider-onboarding-v2/components/ProviderStatusCentreScreen';
import {
  ProviderNotificationsBellButton,
  ProviderNotificationsDrawer,
} from './shell/ProviderNotifications';

// The provider workspace shell (Mode B — workspace routing IA).
//
// WHAT CHANGED, AND WHY IT IS THE WHOLE POINT
//
// This file was 3,251 lines: every workspace screen, plus the shell, plus a
// `useState('jobs')` that chose between them. That one line was the most
// consequential defect in the provider experience, because a tab held in
// component state is not addressable:
//
//   - a reload dropped the provider back on Jobs, whatever they were doing;
//   - nothing could be deep-linked — not a bid, not a payout, not a thread;
//   - browser back did not move between tabs, so on a phone it left the app;
//   - support could not send anyone a link to the screen they were describing.
//
// The route table two doors down already says why this is wrong, about
// onboarding: "the task the provider is on has to survive a reload and a login
// round-trip, and tab state in a component survives neither." Onboarding was
// given routes in 9B.16. The workspace never was. It has them now.
//
// The screens moved out to ./screens/* unchanged, and each is now loaded on
// demand: five route chunks (~78 KB) that no longer sit in the entry bundle.
//
// It does NOT move leaflet or recharts, and it was measured rather than
// assumed. Both are pulled into the entry chunk by surfaces outside this file
// — leaflet by `ds/LocationMap` and `wizard/JobWizardModal`, recharts by
// `admin/DashboardOverview` and `ui/chart` — all of which the router imports
// eagerly. Splitting the provider workspace cannot remove a dependency the
// customer and admin surfaces load anyway, so the 1.8 MB entry chunk is
// essentially unchanged by this work. Lazy route components in routes.ts are
// what would actually move it; that is a separate change, and it belongs to
// the whole router rather than to this file.
//
// Workspace admission reads the canonical capability endpoint. A legacy ACTIVE
// profile can still have incomplete onboarding, a suspended standing, or an
// expired work grant. None of those may be converted into access by logging in.
// Backend guards independently enforce the same decisions on every request.

// Route-level code splitting. Jobs pulls leaflet and wallet pulls recharts;
// neither belongs in the chunk a provider downloads to look at their profile.
const LiveJobsScreen = lazy(() =>
  import('./screens/LiveJobsScreen').then((m) => ({ default: m.LiveJobsScreen })),
);
const MyBidsScreen = lazy(() =>
  import('./screens/MyBidsScreen').then((m) => ({ default: m.MyBidsScreen })),
);
const WalletScreen = lazy(() =>
  import('./screens/WalletScreen').then((m) => ({ default: m.WalletScreen })),
);
const ProviderProfileScreen = lazy(() =>
  import('./screens/ProviderProfileScreen').then((m) => ({ default: m.ProviderProfileScreen })),
);
const ProviderChatScreen = lazy(() =>
  import('./screens/ProviderChatScreen').then((m) => ({ default: m.ProviderChatScreen })),
);

/**
 * The workspace destinations, in bar order.
 *
 * `to` rather than `id`: the nav is a set of links now, so the browser owns
 * history, the active state is derived from the URL rather than tracked
 * alongside it, and a middle-click opens a tab like every other link on the
 * web.
 */
export const PROVIDER_NAV = [
  { to: '/provider/jobs', icon: Map, labelEn: 'Live Jobs', labelAr: 'الوظائف' },
  { to: '/provider/bids', icon: Briefcase, labelEn: 'My Bids', labelAr: 'عروضي' },
  { to: '/provider/messages', icon: MessageCircle, labelEn: 'Chat', labelAr: 'الدردشة' },
  { to: '/provider/wallet', icon: Wallet, labelEn: 'Wallet', labelAr: 'المحفظة' },
  { to: '/provider/profile', icon: User, labelEn: 'Profile', labelAr: 'ملفي' },
] as const;

type AllowedCapabilities = ProviderCapabilitiesResponse['allowed'];

/** Route declarations mirror their API controllers' capability requirements. */
function navigationAllowed(to: string, allowed: AllowedCapabilities): boolean {
  if (to === '/provider/profile') return true; // own profile/activation remains reachable
  if (to === '/provider/wallet') return allowed.includes('VIEW_EARNINGS');
  if (to === '/provider/messages') return allowed.includes('MANAGE_BOOKINGS');
  return allowed.includes('VIEW_MARKETPLACE');
}

/**
 * Identity strings for the top bar.
 *
 * Prefer the provider profile when it exists (server-derived displayName and
 * initials, matching the rest of the surface); otherwise fall back to the
 * auth-side identity, so a logged-in customer who has not activated a provider
 * account still sees a real name rather than a placeholder.
 */
function deriveShellIdentity(
  profile: ProviderProfileSummary | null,
  fallback: { displayName: string | null; initials: string | null },
): { displayName: string; initials: string } {
  if (profile) return { displayName: profile.displayName, initials: profile.initials };
  return { displayName: fallback.displayName ?? '', initials: fallback.initials ?? '' };
}

function ShellSpinner({ testId }: { testId: string }) {
  const { lang, dir, darkMode } = useLang();
  const fontFamily = lang === 'ar' ? "'Cairo', 'Inter', sans-serif" : "'Inter', sans-serif";
  return (
    <div
      className={`flex items-center justify-center ${darkMode ? 'dark bg-slate-900' : 'bg-white'}`}
      style={{ minHeight: '100svh', fontFamily, direction: dir }}
      dir={dir}
      data-testid={testId}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</span>
      <div className="w-10 h-10 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
    </div>
  );
}

function ProviderTopBar({
  identity,
  onOpenNotifications,
}: {
  identity: { displayName: string; initials: string };
  onOpenNotifications: () => void;
}) {
  const { lang } = useLang();
  return (
    <div className="flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm z-20">
      {/* Mode B — the bar spans the viewport so its border reads as a real
          edge, while its contents track a measure. Root no longer caps
          provider routes at 430px, so without this the identity block and the
          bell fly to opposite ends of a 1440px display. */}
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-sm">
            <span className="text-white" style={{ fontSize: '12px', fontWeight: 800 }}>
              {identity.initials}
            </span>
          </div>
          <div>
            <p className="text-[11px] text-pv-muted">
              {lang === 'ar' ? 'مرحباً 👋' : 'Welcome back 👋'}
            </p>
            <p
              className="text-slate-900 dark:text-white"
              style={{ fontSize: '14px', fontWeight: 700 }}
            >
              {identity.displayName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LangToggle />
          <ProviderNotificationsBellButton onOpen={onOpenNotifications} />
        </div>
      </div>
    </div>
  );
}

/**
 * The bottom navigation.
 *
 * `NavLink` supplies `isActive` from the URL, so the highlighted destination
 * and the rendered screen cannot disagree — they read the same source. The
 * previous version compared against `activeTab`, a second copy of the same
 * fact.
 */
function ProviderBottomNav({ allowed }: { allowed: AllowedCapabilities }) {
  const { lang } = useLang();
  return (
    <nav
      className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-20"
      aria-label={lang === 'ar' ? 'أقسام مساحة العمل' : 'Workspace sections'}
      data-testid="provider-bottom-nav"
    >
      <div className="mx-auto flex w-full max-w-2xl items-center justify-around px-2 pt-2 pb-3">
        {PROVIDER_NAV.filter(({ to }) => navigationAllowed(to, allowed)).map(
          ({ to, icon: Icon, labelEn, labelAr }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={`provider-nav-${to.split('/').pop()}`}
              className="relative flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl transition-all min-w-[60px]"
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.div
                      layoutId="provider-nav-pill"
                      className="absolute inset-0 bg-blue-50 dark:bg-blue-900/20 rounded-2xl"
                      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                    />
                  )}
                  <Icon
                    size={22}
                    className={`relative z-10 transition-colors ${isActive ? 'text-pv-accent' : 'text-pv-muted'}`}
                  />
                  {/* Sprint 09B.29 — semantic tokens, not literals.
                   *
                   * The inactive label was `#94a3b8` (2.56:1 on the white bar);
                   * at 10px the large-text allowance does not apply, so axe
                   * reported it SERIOUS on every workspace screen.
                   * `--pv-text-muted` is 7.58:1 and `--pv-accent` 5.17:1, and
                   * both already carry dark-theme values. */}
                  <span
                    className={`relative z-10 text-[10px] ${
                      isActive ? 'font-bold text-pv-accent' : 'font-medium text-pv-muted'
                    }`}
                  >
                    {lang === 'ar' ? labelAr : labelEn}
                  </span>
                </>
              )}
            </NavLink>
          ),
        )}
      </div>
    </nav>
  );
}

/** Chrome around every workspace route: top bar, notifications, bottom nav. */
function WorkspaceChrome({
  identity,
  allowed,
  children,
}: {
  identity: { displayName: string; initials: string };
  allowed: AllowedCapabilities;
  children: React.ReactNode;
}) {
  const { lang, dir, darkMode } = useLang();
  const location = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const fontFamily = lang === 'ar' ? "'Cairo', 'Inter', sans-serif" : "'Inter', sans-serif";

  // The map owns its own full-bleed surface, so the bar would only cover it.
  const hideTopBar = location.pathname.startsWith('/provider/jobs');

  return (
    <div
      className={`relative overflow-hidden flex flex-col ${darkMode ? 'dark bg-slate-900' : 'bg-white'}`}
      style={{ height: '100svh', fontFamily, direction: dir }}
      dir={dir}
    >
      {!hideTopBar && (
        <ProviderTopBar
          identity={identity}
          onOpenNotifications={() => setNotificationsOpen(true)}
        />
      )}

      <AnimatePresence>
        {notificationsOpen && (
          <ProviderNotificationsDrawer onClose={() => setNotificationsOpen(false)} />
        )}
      </AnimatePresence>

      <div className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <Suspense fallback={<ShellSpinner testId="provider-route-loading" />}>
              {children}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>

      <ProviderBottomNav allowed={allowed} />
    </div>
  );
}

export function ProviderApp() {
  const isActivationEntry = Boolean(useMatch('/provider/activate'));
  // Activation owns a session transition. Keep its query observers separate:
  // leaving it must create a fresh capability observer, even when this shell
  // previously rendered an allowed workspace before visiting activation.
  return (
    <ProviderAppRoutes
      key={isActivationEntry ? 'activation' : 'workspace'}
      checksWorkspaceAccess={!isActivationEntry}
    />
  );
}

function ProviderAppRoutes({ checksWorkspaceAccess }: { checksWorkspaceAccess: boolean }) {
  const navigate = useNavigate();
  // Activation owns its upgrade + verified session handoff. Querying provider
  // permissions before that handoff would race the still-customer token and
  // unmount the very screen that can recover it. Its destination is guarded.
  const profileQuery = useProviderProfile();
  const capsQuery = useProviderCapabilities(
    checksWorkspaceAccess && Boolean(profileQuery.data?.profile),
  );
  const authIdentity = useAuthIdentity();
  const onboardingV2 = isProviderOnboardingV2Enabled();

  const identity = useMemo(
    () => deriveShellIdentity(profileQuery.data?.profile ?? null, authIdentity),
    [profileQuery.data, authIdentity],
  );

  // Gate on the FIRST resolution only.
  //
  // `isFetched` flips true the first time the query settles — success OR error
  // — and stays true. Both of the more obvious predicates are wrong:
  // `isPending` is also true for an idle query that will never fetch, so the
  // placeholder can hang forever; `isPending && fetchStatus === 'fetching'`
  // LOOPS, because the placeholder replaces the whole subtree, the children's
  // own `useProviderProfile` observers unmount, and the remount refetches.
  //
  // Gating on "have we ever had an answer?" cannot re-open, so a later
  // background refetch never tears down the mounted workspace.
  if (!profileQuery.isFetched) return <ShellSpinner testId="provider-shell-loading" />;

  const profile = profileQuery.data?.profile ?? null;
  // Wait for this entry's server answer even when another screen left an
  // allowed result in cache. Later invalidations do not reopen the spinner,
  // but a denied/error result immediately removes workspace content.
  if (checksWorkspaceAccess && profile && !capsQuery.isFetchedAfterMount) {
    return <ShellSpinner testId="provider-shell-loading" />;
  }
  const profileStatus = profileQuery.error?.response?.status;
  if (
    checksWorkspaceAccess &&
    ((profile && capsQuery.isError) ||
      (profileQuery.isError &&
        (profile !== null || (profileStatus !== 403 && profileStatus !== 404))))
  ) {
    return (
      <ProviderAccessUnavailable
        busy={profileQuery.isFetching || capsQuery.isFetching}
        retry={() => {
          if (profileQuery.isError) void profileQuery.refetch();
          if (profile) void capsQuery.refetch();
        }}
      />
    );
  }

  // A disabled query retains data. A removed/missing profile cannot inherit
  // that earlier profile's work capabilities from the shared cache.
  const allowed =
    checksWorkspaceAccess && profile && capsQuery.isSuccess && capsQuery.isFetchedAfterMount
      ? (capsQuery.data?.allowed ?? [])
      : [];
  const hasMarketplace = allowed.includes('VIEW_MARKETPLACE');
  const mayOnboard = allowed.includes('COMPLETE_ONBOARDING');
  const incomplete = capsQuery.data?.primaryReason === 'ONBOARDING_INCOMPLETE';
  const isActive = profile?.status === 'ACTIVE'; // presentation only
  const home = !profile
    ? '/provider/profile'
    : onboardingV2 && incomplete && mayOnboard
      ? '/provider/onboarding'
      : hasMarketplace
        ? '/provider/jobs'
        : '/provider/status';

  // Guard the chrome too: forbidden destinations must never briefly display
  // workspace navigation while React Router commits their redirect.
  const workspace = (to: string, screen: React.ReactNode) =>
    navigationAllowed(to, allowed) ? (
      <WorkspaceChrome identity={identity} allowed={allowed}>
        {screen}
      </WorkspaceChrome>
    ) : (
      <Navigate to={home} replace />
    );

  return (
    <Routes>
      <Route index element={<Navigate to={home} replace />} />

      {/* Deliberately outside WorkspaceChrome. A provider who cannot take work
          should not be handed a nav bar of screens that will only bounce them
          back here — the status surface is the whole screen, as it was. */}
      {/* Sprint 09B.29 Phase 5A — prototype screens 14 and 17.
          The V2 status centre answers the four ADR-0005 axes separately, and it
          answers them for an ACTIVE provider too: reaching this address after
          approval is the activation HANDOFF, not a wrong turn to be redirected
          away from silently. V1 keeps its single-card surface and its redirect
          untouched, so the flag rolls back cleanly. */}
      <Route
        path="status"
        element={
          !profile || (onboardingV2 && incomplete && mayOnboard) ? (
            <Navigate to={home} replace />
          ) : // Scoped to the two lifecycles the approved screens describe: an
          // application that has been HANDED IN, and one that has been
          // approved. A DRAFT or RETURNED provider still has work in front of
          // them and belongs on their application, not on a status board that
          // would tell them we are reviewing something they have not sent.
          onboardingV2 && (profile.status === 'PENDING_REVIEW' || isActive) ? (
            <ProviderStatusCentreScreen />
          ) : hasMarketplace ? (
            <Navigate to={home} replace />
          ) : (
            <ProviderStatusState
              workAccessDenied={!hasMarketplace}
              status={incomplete && isActive ? 'DRAFT' : (profile?.status ?? 'DRAFT')}
              onContinueOnboarding={
                mayOnboard
                  ? () => navigate(onboardingV2 ? '/provider/onboarding' : '/provider/profile')
                  : undefined
              }
            />
          )
        }
      />

      {/* Sprint 09B.29 — prototype screens 0 and 1.
          Deliberately OUTSIDE WorkspaceChrome: onboarding shows no workspace
          navigation until work access is active, and activation is the first
          screen of onboarding. Flag-gated so V1 is unaffected; a provider who
          already has a profile is sent on, because activation is not a screen
          you can return to. */}
      <Route
        path="activate"
        element={
          !onboardingV2 ? (
            <Navigate to={home} replace />
          ) : (
            <ProviderActivationScreen
              hasProfile={Boolean(profile)}
              alreadyActivatedDestination={home}
            />
          )
        }
      />

      <Route path="jobs" element={workspace('/provider/jobs', <LiveJobsScreen />)} />
      <Route path="bids" element={workspace('/provider/bids', <MyBidsScreen />)} />
      {/* Two paths, one screen. The list and the open thread are the same
          two-pane surface at different widths — on a phone the thread covers
          the list — so splitting them into separate components would duplicate
          it. The param is what the screen reads to decide which is showing. */}
      <Route path="messages" element={workspace('/provider/messages', <ProviderChatScreen />)} />
      <Route
        path="messages/:threadId"
        element={workspace('/provider/messages', <ProviderChatScreen />)}
      />
      <Route path="wallet" element={workspace('/provider/wallet', <WalletScreen />)} />

      {/* Profile is the one workspace route a non-ACTIVE provider may open,
          because for them it is not the profile editor — it is the place the
          application is finished. Which is also why the editor is not what
          renders: it is built for an approved provider adjusting a live
          listing and has no notion of steps, of what is missing, or of
          submitting. With V2 on, the wizard is a route of its own, so this
          redirects rather than mounting a surface the flag turned off. */}
      <Route
        path="profile"
        element={
          !profile && onboardingV2 ? (
            <Navigate to="/provider/activate" replace />
          ) : !profile ? (
            <WorkspaceChrome identity={identity} allowed={allowed}>
              <ProviderProfileScreen />
            </WorkspaceChrome>
          ) : incomplete && mayOnboard ? (
            onboardingV2 ? (
              <Navigate to="/provider/onboarding" replace />
            ) : (
              <ProviderOnboardingWizard />
            )
          ) : hasMarketplace || allowed.includes('VIEW_EARNINGS') ? (
            workspace('/provider/profile', <ProviderProfileScreen />)
          ) : mayOnboard && !onboardingV2 ? (
            <ProviderOnboardingWizard />
          ) : (
            <Navigate to="/provider/status" replace />
          )
        }
      />

      <Route path="*" element={<Navigate to="/provider" replace />} />
    </Routes>
  );
}
