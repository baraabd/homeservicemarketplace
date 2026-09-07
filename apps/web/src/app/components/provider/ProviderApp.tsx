import { lazy, Suspense, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Map, Briefcase, Wallet, User, MessageCircle } from 'lucide-react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import type { ProviderProfileSummary } from '@homeservicemarketplace/contracts';

import { useLang, LangToggle } from '../../i18n/LanguageContext';
import { isProviderOnboardingV2Enabled } from '../../../lib/feature-flags';
import { useProviderProfile } from '../../hooks/provider/useProviderProfile';
import { useAuthIdentity } from '../../../lib/use-auth-identity';
import { ProviderStatusState } from './ProviderStatusState';
import { ProviderOnboardingWizard } from './onboarding/ProviderOnboardingWizard';
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
// WHAT DELIBERATELY DID NOT CHANGE
//
// Every gating rule below is carried over verbatim, because it is a
// server-mirroring rule and not a layout decision. The statuses that may enter
// onboarding still mirror COMPLETE_ONBOARDING (docs/adr/0005); marketplace
// screens still never mount for a non-ACTIVE provider; the first-resolution
// gate still cannot re-open. Routing changed where a provider can BE. It
// changed nothing about what they are allowed to DO — that stays with the
// server, which answers 403 regardless of what this file renders.

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

/** The statuses that may reach onboarding — a mirror of the server's
 *  COMPLETE_ONBOARDING capability (docs/adr/0005), not a second opinion.
 *  DRAFT and REJECTED are still drafting; PENDING_REVIEW may keep editing
 *  while queued; SUSPENDED may not. */
function canEnterOnboarding(profile: ProviderProfileSummary | null): boolean {
  return (
    profile !== null &&
    (profile.status === 'DRAFT' ||
      profile.status === 'PENDING_REVIEW' ||
      profile.status === 'REJECTED')
  );
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
            <p className="text-slate-400" style={{ fontSize: '11px' }}>
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
function ProviderBottomNav() {
  const { lang } = useLang();
  return (
    <nav
      className="flex-shrink-0 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-20"
      aria-label={lang === 'ar' ? 'أقسام مساحة العمل' : 'Workspace sections'}
      data-testid="provider-bottom-nav"
    >
      <div className="mx-auto flex w-full max-w-2xl items-center justify-around px-2 pt-2 pb-3">
        {PROVIDER_NAV.map(({ to, icon: Icon, labelEn, labelAr }) => (
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
                  className={`relative z-10 transition-colors ${isActive ? 'text-blue-600' : 'text-slate-400'}`}
                />
                <span
                  className="relative z-10"
                  style={{
                    fontSize: '10px',
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#2563eb' : '#94a3b8',
                  }}
                >
                  {lang === 'ar' ? labelAr : labelEn}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** Chrome around every workspace route: top bar, notifications, bottom nav. */
function WorkspaceChrome({
  identity,
  children,
}: {
  identity: { displayName: string; initials: string };
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

      <ProviderBottomNav />
    </div>
  );
}

export function ProviderApp() {
  const navigate = useNavigate();
  const profileQuery = useProviderProfile();
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
  const isActive = profile?.status === 'ACTIVE';
  const mayOnboard = canEnterOnboarding(profile);

  // NO PROFILE ROW is not a status, and must not be treated as one.
  //
  // A user with the provider role but no profile has not applied yet: the
  // right screen is the Activate one on the profile route, not a status
  // surface reporting a status they do not have. The old gate expressed this
  // as `profile && profile.status !== 'ACTIVE'` — the `profile &&` was doing
  // real work, and dropping it sent every not-yet-provider to a DRAFT status
  // page they had never earned.
  const home = isActive ? '/provider/jobs' : profile ? '/provider/status' : '/provider/profile';

  // Resolving the profile BEFORE deciding what to mount is what stops a DRAFT
  // or SUSPENDED provider seeing the marketplace map flash up — every call it
  // fired during that moment came back 403.
  //
  // As a redirect rather than a pinned tab, this is the same rule with an
  // address: the provider can now be linked to their own status, and the back
  // button behaves.
  const guardMarketplace = (screen: React.ReactNode) =>
    isActive ? screen : <Navigate to={home} replace />;

  return (
    <Routes>
      <Route index element={<Navigate to={home} replace />} />

      {/* Deliberately outside WorkspaceChrome. A provider who cannot take work
          should not be handed a nav bar of screens that will only bounce them
          back here — the status surface is the whole screen, as it was. */}
      <Route
        path="status"
        element={
          isActive || !profile ? (
            <Navigate to={home} replace />
          ) : (
            <ProviderStatusState
              status={profile?.status ?? 'DRAFT'}
              onContinueOnboarding={
                mayOnboard
                  ? () => navigate(onboardingV2 ? '/provider/onboarding' : '/provider/profile')
                  : undefined
              }
            />
          )
        }
      />

      <Route
        path="jobs"
        element={
          <WorkspaceChrome identity={identity}>
            {guardMarketplace(<LiveJobsScreen />)}
          </WorkspaceChrome>
        }
      />
      <Route
        path="bids"
        element={
          <WorkspaceChrome identity={identity}>
            {guardMarketplace(<MyBidsScreen />)}
          </WorkspaceChrome>
        }
      />
      {/* Two paths, one screen. The list and the open thread are the same
          two-pane surface at different widths — on a phone the thread covers
          the list — so splitting them into separate components would duplicate
          it. The param is what the screen reads to decide which is showing. */}
      <Route
        path="messages"
        element={
          <WorkspaceChrome identity={identity}>
            {guardMarketplace(<ProviderChatScreen />)}
          </WorkspaceChrome>
        }
      />
      <Route
        path="messages/:threadId"
        element={
          <WorkspaceChrome identity={identity}>
            {guardMarketplace(<ProviderChatScreen />)}
          </WorkspaceChrome>
        }
      />
      <Route
        path="wallet"
        element={
          <WorkspaceChrome identity={identity}>
            {guardMarketplace(<WalletScreen />)}
          </WorkspaceChrome>
        }
      />

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
          <WorkspaceChrome identity={identity}>
            {/* No profile yet: this screen owns the Activate call that creates
                one. Mounting the marketplace here instead would fire calls
                that all 403 and paint a broken marketplace over what is
                really an unfinished signup. */}
            {isActive || !profile ? (
              <ProviderProfileScreen />
            ) : mayOnboard ? (
              onboardingV2 ? (
                <Navigate to="/provider/onboarding" replace />
              ) : (
                <ProviderOnboardingWizard />
              )
            ) : (
              <Navigate to="/provider/status" replace />
            )}
          </WorkspaceChrome>
        }
      />

      <Route path="*" element={<Navigate to="/provider" replace />} />
    </Routes>
  );
}
