// Extracted from ProviderApp.tsx (Mode B, workspace routing IA).
//
// The provider’s own profile, portfolio, verification and availability.
//
// ProviderApp.tsx was 3,251 lines holding every workspace screen plus the
// shell, and the shell chose between them with `useState('jobs')`. That made
// the screens unreachable by URL and unsplittable by the bundler. Each screen
// is now its own module behind its own route; behaviour is unchanged by this
// move.

import { useState } from 'react';
import { useLang } from '../../../i18n/LanguageContext';
import { PortfolioSection } from '../portfolio/PortfolioSection';
import { ProviderVerificationScreen } from '../../../features/provider-verification/components/ProviderVerificationScreen';
import {
  useProviderProfile,
  useUpdateProviderAvailability,
  useUpgradeToProvider,
} from '../../../hooks/provider/useProviderProfile';
import { useNavigate } from 'react-router';
import { useAuth } from '../../../../lib/auth-provider';
import { clearIntendedApp } from '../../../../lib/intended-app';
import { EditProfilePage } from '../../profile/EditProfilePage';
import type { ProviderAvailability } from '@homeservicemarketplace/contracts';
import {
  User,
  ChevronRight,
  Star,
  CheckCircle2,
  Bell,
  WifiOff,
  Award,
  BarChart2,
  Clock,
  LogOut,
} from 'lucide-react';

// ─── Provider Profile ─────────────────────────────────────────────────────────
// Tailwind palette for skill chips. Cycled by index so the chip colours
// stay distinct without the previous hardcoded mapping (which only
// covered the four English skill names that no longer drive the data).
const SKILL_CHIP_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-amber-100 text-amber-700',
  'bg-cyan-100 text-cyan-700',
  'bg-orange-100 text-orange-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
];

// "Member since Jan 2023" formatter. Localised to en-US / ar-SA so the
// month name flips with language. Falls back to an empty string when
// the wire timestamp is somehow missing — the surrounding paragraph
// hides cleanly.
function formatMemberSince(iso: string, lang: 'en' | 'ar'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    month: 'short',
    year: 'numeric',
  });
}

export function ProviderProfileScreen() {
  const { lang } = useLang();
  const navigate = useNavigate();
  const auth = useAuth();
  const profileQuery = useProviderProfile();
  const upgradeMut = useUpgradeToProvider();
  const availabilityMut = useUpdateProviderAvailability();

  // Phase 5 Feature 5 — local view router so the menu can swap to
  // <EditProfilePage> in place (mirrors the seeker ProfileTab pattern
  // at apps/web/src/app/components/profile/ProfileTab.tsx:467). When
  // the user finishes editing they hit Back which sets view=null and
  // returns here.
  const [view, setView] = useState<'editProfile' | null>(null);
  // Phase 5 Bug 4 — debounce double-clicks on Sign Out so the user
  // can't fire two logout requests while the auth-provider is still
  // tearing down the session.
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    // Drop the "/provider" intent BEFORE logout flips auth/me — once
    // auth/me clears, RequireAuth fires its own redirect and this
    // component unmounts; sessionStorage writes from an unmounted
    // closure are racy. The intent is what would otherwise yank the
    // user back into /provider on the next login from /select.
    clearIntendedApp();
    // Navigate FIRST so a stale /provider URL never paints behind the
    // logout call — and so the redirect doesn't depend on
    // setQueryData → useAuth re-render → RequireAuth observation
    // landing in time. We use replace:true so the back button doesn't
    // bounce the user into a half-logged-out provider shell.
    navigate('/login', { replace: true });
    try {
      // useAuth().logout() POSTs /v1/auth/logout (best-effort) and
      // — succeed or fail — sets the cached /auth/me to null and
      // purges every non-auth React Query so no stale Provider data
      // bleeds into the next session.
      await auth.logout();
    } catch {
      // doLogout already swallows API errors; reaching the catch here
      // would be a programming error. Either way the navigate above
      // has already moved the user off the protected shell.
    } finally {
      setSigningOut(false);
    }
  };

  if (view === 'editProfile') {
    return <EditProfilePage onBack={() => setView(null)} appContext="provider" />;
  }

  const profile = profileQuery.data?.profile ?? null;
  // Onboarding: only when the cache has NO profile yet AND the last GET
  // came back 403/404. Once the upgrade mutation seeds the cache, `profile`
  // is non-null and we render the real surface even if React Query is
  // mid-refetch (the prior 403 error is still pinned to the query state
  // until the next fetch resolves).
  const upgradeNeeded = (() => {
    if (profile) return false;
    const status = profileQuery.error?.response?.status;
    return status === 403 || status === 404;
  })();

  const L = {
    title: lang === 'ar' ? 'ملف المحترف' : 'My Profile',
    online: lang === 'ar' ? 'متاح للعمل' : 'Available for work',
    offline: lang === 'ar' ? 'غير متاح' : 'Unavailable',
    paused: lang === 'ar' ? 'متوقف مؤقتاً' : 'Paused',
    skills: lang === 'ar' ? 'مهاراتي' : 'My Skills',
    skillsEmpty: lang === 'ar' ? 'لم تضف مهارات بعد' : 'No skills added yet',
    jobsDone: lang === 'ar' ? 'مهام منجزة' : 'Jobs Done',
    rating: lang === 'ar' ? 'التقييم' : 'Rating',
    reviews: lang === 'ar' ? 'مراجعات' : 'Reviews',
    editProfile: lang === 'ar' ? 'تعديل الملف' : 'Edit Profile',
    settings: lang === 'ar' ? 'الإعدادات' : 'Settings',
    support: lang === 'ar' ? 'الدعم الفني' : 'Support',
    signOut: lang === 'ar' ? 'تسجيل الخروج' : 'Sign Out',
    level: lang === 'ar' ? 'محترف Pro' : 'Pro Professional',
    levelStandard: lang === 'ar' ? 'محترف' : 'Professional',
    memberSince: lang === 'ar' ? 'عضو منذ' : 'Member since',
    receivingRequests: lang === 'ar' ? 'تستقبل الطلبات' : 'Receiving requests',
    hiddenFromMap: lang === 'ar' ? 'مخفي عن الخريطة' : 'Hidden from map',
    onboardingTitle: lang === 'ar' ? 'كن مزوّد خدمة على المنصة' : 'Become a service provider',
    onboardingBody:
      lang === 'ar'
        ? 'فعّل حسابك كمحترف لرؤية الطلبات القريبة وتقديم العروض.'
        : 'Activate your professional account to see nearby requests and submit bids.',
    onboardingCta: lang === 'ar' ? 'تفعيل حساب المحترف' : 'Activate Provider Account',
    onboardingPending: lang === 'ar' ? 'جارٍ التفعيل…' : 'Activating…',
    upgradeError:
      lang === 'ar'
        ? 'تعذر تفعيل الحساب. حاول مرة أخرى.'
        : "We couldn't activate your provider account. Please try again.",
    availabilityError:
      lang === 'ar'
        ? 'تعذر تحديث الحالة. حاول مرة أخرى.'
        : "We couldn't update your availability. Please try again.",
    profileError:
      lang === 'ar'
        ? 'تعذر تحميل ملف المحترف. حاول مرة أخرى.'
        : "We couldn't load your provider profile. Please try again.",
  };

  // ── Onboarding state — same gradient hero, no fake stats ────────────────
  if (upgradeNeeded) {
    return (
      <div
        className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
          <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
          <p className="text-white relative" style={{ fontSize: '20px', fontWeight: 800 }}>
            {L.onboardingTitle}
          </p>
          <p
            className="text-white/70 relative mt-1.5"
            style={{ fontSize: '13px', lineHeight: '1.5' }}
          >
            {L.onboardingBody}
          </p>
        </div>
        <div className="px-4 -mt-3 z-10 relative">
          <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 mb-4 flex flex-col items-stretch">
            <button
              onClick={() => upgradeMut.mutate()}
              disabled={upgradeMut.isPending}
              className="w-full flex items-center justify-center gap-2.5 py-4 bg-blue-600 text-white rounded-2xl shadow-md shadow-blue-200 dark:shadow-none active:scale-95 transition-all disabled:opacity-60"
              style={{ fontSize: '15px', fontWeight: 800 }}
            >
              {upgradeMut.isPending ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  {L.onboardingPending}
                </>
              ) : (
                <>
                  <Award size={18} />
                  {L.onboardingCta}
                </>
              )}
            </button>
            {upgradeMut.isError && (
              <p
                className="mt-3 text-red-600"
                style={{ fontSize: '12px', fontWeight: 600 }}
                role="alert"
              >
                {L.upgradeError}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Loading skeleton — preserve hero shape so the layout doesn't jump ───
  if (!profile) {
    return (
      <div
        className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
          <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
          <div className="flex items-center gap-4 relative">
            <div className="w-20 h-20 rounded-3xl bg-white/20 border-2 border-white/30" />
            <div className="space-y-2">
              <div className="h-5 w-40 rounded bg-white/30" />
              <div className="h-3 w-24 rounded bg-white/20" />
            </div>
          </div>
        </div>
        {profileQuery.isError && !upgradeNeeded && (
          <div className="px-4 mt-4">
            <p
              className="px-4 py-3 rounded-2xl bg-red-50 border border-red-100 text-red-700"
              style={{ fontSize: '13px', fontWeight: 600 }}
              role="alert"
            >
              {L.profileError}
            </p>
          </div>
        )}
      </div>
    );
  }

  const isOnline = profile.availability === 'ONLINE';
  const isPaused = profile.availability === 'PAUSED';
  const availabilityLabel = isOnline ? L.online : isPaused ? L.paused : L.offline;
  const availabilityHint = isOnline ? L.receivingRequests : L.hiddenFromMap;

  const handleAvailabilityToggle = () => {
    if (availabilityMut.isPending) return;
    const next: ProviderAvailability = isOnline ? 'OFFLINE' : 'ONLINE';
    availabilityMut.mutate({ availability: next });
  };

  const memberSince = formatMemberSince(profile.createdAt, lang === 'ar' ? 'ar' : 'en');
  const ratingDisplay = profile.reviewCount > 0 ? `${profile.ratingAvg.toFixed(1)}★` : '—';
  const proLabel = profile.topPro ? L.level : L.levelStandard;

  return (
    <div
      className="absolute inset-0 flex flex-col bg-slate-50 dark:bg-slate-900 overflow-y-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 px-5 pt-6 pb-8 relative overflow-hidden">
        <div className="absolute -top-6 -end-6 w-28 h-28 rounded-full bg-white/10" />
        <div className="flex items-center gap-4 relative">
          <div className="w-20 h-20 rounded-3xl bg-white/20 border-2 border-white/30 flex items-center justify-center">
            <span className="text-white" style={{ fontSize: '24px', fontWeight: 900 }}>
              {profile.initials}
            </span>
          </div>
          <div>
            <p className="text-white" style={{ fontSize: '20px', fontWeight: 800 }}>
              {profile.displayName}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <Award size={12} className="text-amber-300" />
              <span className="text-white/70" style={{ fontSize: '12px' }}>
                {proLabel}
              </span>
            </div>
            {memberSince && (
              <p className="text-white/50 mt-0.5" style={{ fontSize: '11px' }}>
                {L.memberSince} {memberSince}
              </p>
            )}
          </div>
        </div>
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mt-5 relative">
          {[
            { val: String(profile.completedJobs), label: L.jobsDone },
            { val: ratingDisplay, label: L.rating },
            { val: String(profile.reviewCount), label: L.reviews },
          ].map((s) => (
            <div key={s.label} className="bg-white/15 rounded-2xl py-3 flex flex-col items-center">
              <span className="text-white" style={{ fontSize: '15px', fontWeight: 800 }}>
                {s.val}
              </span>
              <span className="text-white/60" style={{ fontSize: '10px' }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 -mt-3 z-10 relative">
        {/* Availability toggle */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${isOnline ? 'bg-green-100' : 'bg-slate-100'}`}
            >
              {isOnline ? (
                <CheckCircle2 size={16} className="text-green-600" />
              ) : (
                <WifiOff size={16} className="text-slate-500" />
              )}
            </div>
            <div>
              <p
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '14px', fontWeight: 700 }}
              >
                {availabilityLabel}
              </p>
              <p className="text-slate-400" style={{ fontSize: '11px' }}>
                {availabilityHint}
              </p>
            </div>
          </div>
          <button
            onClick={handleAvailabilityToggle}
            disabled={availabilityMut.isPending}
            className={`w-12 h-7 rounded-full border-2 transition-all duration-300 flex items-center px-0.5 disabled:opacity-60 ${isOnline ? 'bg-green-500 border-green-500' : 'bg-slate-300 border-slate-300'}`}
            aria-label={availabilityLabel}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${isOnline ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
        {availabilityMut.isError && (
          <p
            className="-mt-3 mb-4 px-4 py-2 rounded-xl bg-red-50 border border-red-100 text-red-700"
            style={{ fontSize: '12px', fontWeight: 600 }}
            role="alert"
          >
            {L.availabilityError}
          </p>
        )}

        {/* Skills */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-4 mb-4">
          <p
            className="text-slate-900 dark:text-white mb-3"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {L.skills}
          </p>
          {(() => {
            const pending = profile.pendingCategories ?? [];
            const approved = profile.serviceCategories;
            if (approved.length === 0 && pending.length === 0) {
              return (
                <p className="text-slate-400" style={{ fontSize: '13px' }}>
                  {L.skillsEmpty}
                </p>
              );
            }
            // Approved + pending render in a single flex row so the chips
            // wrap together at the same `gap-2` rhythm. The dashed-border
            // affordance carries the visual distinction; we deliberately
            // do NOT split them across two rows because that would imply
            // the lists are separately scrollable.
            return (
              <div className="flex flex-wrap gap-2">
                {approved.map((cat, i) => (
                  <span
                    key={cat.id}
                    className={`px-3 py-1.5 rounded-xl ${SKILL_CHIP_COLORS[i % SKILL_CHIP_COLORS.length]} dark:bg-slate-700 dark:text-slate-200`}
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    {lang === 'ar' ? cat.labelAr : cat.labelEn}
                  </span>
                ))}
                {pending.map((cat) => (
                  <span
                    key={cat.id}
                    aria-label={lang === 'ar' ? 'في انتظار موافقة الإدارة' : 'Pending approval'}
                    title={lang === 'ar' ? 'في انتظار موافقة الإدارة' : 'Pending Admin Approval'}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500 border border-dashed border-slate-300 dark:bg-slate-700/40 dark:text-slate-400 dark:border-slate-600 inline-flex items-center gap-1.5 cursor-help"
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    <Clock size={12} aria-hidden="true" />
                    {lang === 'ar' ? cat.labelAr : cat.labelEn}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Menu */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden mb-4">
          {[
            // Phase 5 Feature 5 — Edit Profile is now the only wired
            // menu row. The other rows are placeholders pending future
            // sprints; their non-interactivity is unchanged.
            {
              icon: <User size={16} />,
              label: L.editProfile,
              onClick: () => setView('editProfile'),
              testId: 'provider-menu-edit-profile',
            },
            {
              icon: <BarChart2 size={16} />,
              label: lang === 'ar' ? 'إحصائياتي' : 'My Analytics',
            },
            { icon: <Bell size={16} />, label: lang === 'ar' ? 'الإشعارات' : 'Notifications' },
            { icon: <Star size={16} />, label: lang === 'ar' ? 'تقييماتي' : 'My Reviews' },
          ].map(({ icon, label, onClick, testId }, i) => (
            <button
              key={i}
              type="button"
              onClick={onClick}
              data-testid={testId}
              className={`w-full flex items-center gap-3 px-4 py-3.5 active:bg-slate-50 dark:active:bg-slate-700/50 transition-all text-start ${i > 0 ? 'border-t border-slate-50 dark:border-slate-700' : ''}`}
            >
              <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                {icon}
              </div>
              <span
                className="flex-1 text-slate-700 dark:text-slate-200"
                style={{ fontSize: '14px', fontWeight: 500 }}
              >
                {label}
              </span>
              <ChevronRight
                size={16}
                className="text-slate-300 dark:text-slate-600 rtl:rotate-180"
              />
            </button>
          ))}
        </div>

        {/* Sprint 9B.11 — the verification journey.
            Above the gallery because it is the thing that decides whether the
            provider can work at all; the gallery is what they show once they
            can. Both live on the profile screen because both are facts about
            the provider rather than about a job. */}
        <div className="px-5 pb-2">
          <ProviderVerificationScreen />
        </div>

        {/* Sprint 9B.10 — the provider's public gallery.
            Placed on the profile screen because a portfolio IS profile
            content: it is gated on EDIT_OWN_PROFILE server-side, and it sits
            with the other things a provider edits about themselves rather
            than behind a tab of its own. */}
        <div className="px-5 pb-6">
          <PortfolioSection />
        </div>

        {/* Phase 5 Bug 4 — Sign Out wired to useAuth().logout() (clears
            cookies + auth state + purges protected React Query) followed
            by an explicit navigate('/login') so the user lands on the
            auth screen immediately rather than briefly seeing the
            unauthenticated provider shell. */}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          data-testid="provider-sign-out"
          className="w-full flex items-center justify-center gap-2.5 py-4 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-3xl mb-6 active:bg-red-100 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <LogOut size={18} className="text-red-500" />
          <span
            className="text-red-600 dark:text-red-400"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {L.signOut}
          </span>
        </button>
      </div>
    </div>
  );
}
