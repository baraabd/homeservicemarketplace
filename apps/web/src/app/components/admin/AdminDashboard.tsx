import { useEffect, useRef, useState } from 'react';
import { Link, matchPath, useLocation, useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  BriefcaseBusiness,
  ClipboardCheck,
  DollarSign,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
import { useAuthIdentity } from '../../../lib/use-auth-identity';
import { useAuth } from '../../../lib/auth-provider';
import { UsersSection } from '../../features/admin-directory/components/UsersSection';
import { ProviderDirectory } from '../../features/admin-directory/components/ProviderDirectory';
import { AdminProviderReviewWorkspace } from '../../features/admin-provider-review/components/AdminProviderReviewWorkspace';
import { VerificationSection } from './VerificationSection';
import { AdminVerificationCaseWorkspace } from '../../features/admin-verification/components/AdminVerificationCaseWorkspace';
import { VerificationPolicyPanel } from '../../features/admin-verification/components/VerificationPolicyPanel';
import { DisputeSection } from './DisputesSection';
import { DashboardOverview } from './DashboardOverview';
import { FinancialsSection } from './FinancialsSection';
import { SettingsSection } from './SettingsSection';
import { AuditLogsSection } from './AuditLogsSection';
import { AdminNotificationsBell } from './AdminNotificationsBell';

type Section =
  | 'dashboard'
  | 'users'
  | 'providers'
  | 'reviews'
  | 'verification'
  | 'financials'
  | 'disputes'
  | 'settings'
  | 'audit';
const NAV_ITEMS = [
  { id: 'dashboard', icon: LayoutDashboard, en: 'Dashboard', ar: 'لوحة التحكم' },
  { id: 'users', icon: Users, en: 'User Control', ar: 'إدارة المستخدمين' },
  { id: 'providers', icon: BriefcaseBusiness, en: 'Providers', ar: 'المهنيون' },
  { id: 'reviews', icon: ClipboardCheck, en: 'Application review', ar: 'مراجعة الطلبات' },
  { id: 'verification', icon: ShieldCheck, en: 'Pro Verification', ar: 'توثيق المحترفين' },
  { id: 'financials', icon: DollarSign, en: 'Financials', ar: 'الماليات' },
  { id: 'disputes', icon: AlertTriangle, en: 'Dispute Center', ar: 'مركز النزاعات' },
  { id: 'settings', icon: Settings, en: 'Settings', ar: 'الإعدادات' },
  { id: 'audit', icon: FileText, en: 'Audit Logs', ar: 'سجل التدقيق' },
] as const;

function sectionPath(section: Section) {
  return section === 'dashboard' ? '/admin' : `/admin/${section}`;
}

/** A review link may return only to its own directory, never to an arbitrary URL. */
function directoryReturn(search: string) {
  const target = new URLSearchParams(search).get('returnTo');
  return target && /^\/admin\/(providers|reviews)(\?|$)/.test(target) ? target : '/admin/reviews';
}

// Admin is a full-width, role-gated route tree. The URL owns navigation so a
// refresh, login round trip, deep link, and browser Back show the same surface.
export function AdminDashboard() {
  const { lang, dir, darkMode, toggleDarkMode } = useLang();
  const { logout } = useAuth();
  const identity = useAuthIdentity();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusToContent = useRef(false);
  const previousPath = useRef(location.pathname);
  const isAr = lang === 'ar';
  const providerMatch = matchPath('/admin/providers/:providerProfileId', location.pathname);
  const segment = location.pathname.split('/')[2] || 'dashboard';
  const active = NAV_ITEMS.find((item) => item.id === segment);
  const activeSection = active?.id ?? 'dashboard';
  const title = providerMatch
    ? isAr
      ? 'مراجعة ملف المهني'
      : 'Provider review'
    : (active?.[lang] ?? (isAr ? 'لوحة التحكم' : 'Dashboard'));
  const initials = identity.initials ?? '';
  const displayName = identity.displayName ?? '';
  const email = identity.email ?? '';
  const roleLabel = isAr ? 'مدير المنصة' : 'Platform Administrator';

  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      returnFocusToContent.current = true;
      setMobileOpen(false);
      mainRef.current?.focus();
      previousPath.current = location.pathname;
    }
  }, [location.pathname]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      await logout();
      navigate('/login?app=admin', { replace: true });
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

  const navigation = (mobile = false) => (
    <nav
      aria-label={isAr ? 'التنقل في الإدارة' : 'Admin navigation'}
      className="flex flex-1 flex-col gap-1 px-3 py-4"
    >
      {NAV_ITEMS.map(({ id, icon: Icon, en, ar }) => (
        <button
          key={id}
          type="button"
          data-testid={mobile ? `mobile-nav-${id}` : `nav-${id}`}
          aria-current={activeSection === id ? 'page' : undefined}
          onClick={() => {
            navigate(sectionPath(id));
            setMobileOpen(false);
          }}
          className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${activeSection === id ? 'bg-amber-500 font-bold text-slate-950 shadow-lg shadow-amber-950/20' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
        >
          <Icon aria-hidden="true" size={18} className="shrink-0" />
          <span>{isAr ? ar : en}</span>
        </button>
      ))}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-3 border-b border-white/10 px-5 py-6">
      <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
        <Zap size={18} className="text-white" aria-hidden="true" />
      </div>
      <div>
        <p className="font-extrabold text-white">FixNow</p>
        <p className="text-xs text-slate-400">{isAr ? 'لوحة الإدارة' : 'Admin Panel'}</p>
      </div>
    </div>
  );

  return (
    <div
      className={`${darkMode ? 'dark' : ''} min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100`}
      dir={dir}
      lang={lang}
      style={{ fontFamily: isAr ? "'Cairo','Inter',sans-serif" : "'Inter',sans-serif" }}
    >
      <a
        href="#admin-content"
        className="sr-only z-50 rounded-xl bg-amber-500 p-3 text-slate-950 focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        {isAr ? 'انتقل إلى المحتوى' : 'Skip to content'}
      </a>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-slate-900 dark:bg-slate-950 lg:flex">
          {brand}
          {navigation()}
          <div className="border-t border-white/10 px-4 py-4">
            <div className="flex items-center gap-3">
              <div
                data-testid="admin-sidebar-avatar"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-sm font-extrabold text-white"
              >
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  data-testid="admin-sidebar-name"
                  className="truncate text-sm font-semibold text-white"
                >
                  {displayName}
                </p>
                <p data-testid="admin-sidebar-email" className="truncate text-xs text-slate-400">
                  {email || roleLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
                aria-label={isAr ? 'تسجيل الخروج' : 'Sign out'}
                className="flex size-11 items-center justify-center rounded-xl text-slate-300 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                <LogOut size={18} />
              </button>
            </div>
            {signOutError && (
              <p role="alert" className="mt-2 text-sm text-rose-300">
                {isAr ? 'تعذر تسجيل الخروج. حاول مجدداً.' : 'Could not sign out. Please try again.'}
              </p>
            )}
          </div>
        </aside>
        <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 lg:hidden" />
            <Dialog.Content
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                (returnFocusToContent.current ? mainRef.current : menuButtonRef.current)?.focus();
                returnFocusToContent.current = false;
              }}
              dir={dir}
              aria-describedby={undefined}
              className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-full flex-col overflow-y-auto bg-slate-900 shadow-2xl lg:hidden"
            >
              <Dialog.Title className="sr-only">
                {isAr ? 'التنقل في الإدارة' : 'Admin navigation'}
              </Dialog.Title>
              {brand}
              <Dialog.Close
                aria-label={isAr ? 'إغلاق القائمة' : 'Close navigation'}
                className="absolute end-2 top-2 flex size-11 items-center justify-center rounded-xl text-slate-300 focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                <X size={18} />
              </Dialog.Close>
              {navigation(true)}
              <button
                type="button"
                disabled={signingOut}
                onClick={() => void signOut()}
                className="m-4 flex min-h-11 items-center gap-3 rounded-xl px-4 text-white"
              >
                <LogOut size={18} />
                {isAr ? 'تسجيل الخروج' : 'Sign out'}
              </button>
              {signOutError && (
                <p role="alert" className="mx-4 mb-4 text-sm text-rose-300">
                  {isAr
                    ? 'تعذر تسجيل الخروج. حاول مجدداً.'
                    : 'Could not sign out. Please try again.'}
                </p>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                ref={menuButtonRef}
                aria-label={isAr ? 'فتح القائمة' : 'Open navigation'}
                aria-expanded={mobileOpen}
                onClick={() => {
                  returnFocusToContent.current = false;
                  setMobileOpen(true);
                }}
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 focus-visible:ring-2 focus-visible:ring-amber-500 dark:bg-slate-700 lg:hidden"
              >
                <Menu size={20} />
              </button>
              <h1 className="text-lg font-extrabold">{title}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleDarkMode}
                aria-label={
                  isAr
                    ? darkMode
                      ? 'الوضع الفاتح'
                      : 'الوضع الداكن'
                    : darkMode
                      ? 'Light theme'
                      : 'Dark theme'
                }
                className="flex size-11 items-center justify-center rounded-xl bg-slate-100 focus-visible:ring-2 focus-visible:ring-amber-500 dark:bg-slate-700"
              >
                {darkMode ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <LangToggle />
              <AdminNotificationsBell lang={lang} />
              <div
                data-testid="admin-topbar-avatar"
                title={displayName || roleLabel}
                className="hidden size-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-xs font-extrabold text-white sm:flex"
              >
                {initials}
              </div>
            </div>
          </header>
          <main
            id="admin-content"
            ref={mainRef}
            tabIndex={-1}
            className="min-w-0 flex-1 p-4 outline-none lg:p-6"
          >
            {providerMatch ? (
              <AdminProviderReviewWorkspace
                providerProfileId={providerMatch.params.providerProfileId!}
                onBack={() => navigate(directoryReturn(location.search), { state: location.state })}
              />
            ) : (
              <>
                {activeSection === 'dashboard' &&
                  (segment === 'dashboard' ? (
                    <DashboardOverview lang={lang} />
                  ) : (
                    <div className="space-y-3">
                      <p>{isAr ? 'الصفحة غير موجودة.' : 'Page not found.'}</p>
                      <Link to="/admin" className="font-semibold text-amber-700 underline">
                        {isAr ? 'لوحة التحكم' : 'Dashboard'}
                      </Link>
                    </div>
                  ))}
                {activeSection === 'users' && <UsersSection lang={lang} />}
                {activeSection === 'providers' && <ProviderDirectory key="providers" />}
                {activeSection === 'reviews' && <ProviderDirectory key="reviews" reviewQueue />}
                {activeSection === 'verification' && (
                  <div className="space-y-8">
                    <AdminVerificationCaseWorkspace />
                    <VerificationSection />
                    <VerificationPolicyPanel />
                  </div>
                )}
                {activeSection === 'financials' && <FinancialsSection lang={lang} />}
                {activeSection === 'disputes' && <DisputeSection lang={lang} />}
                {activeSection === 'settings' && <SettingsSection lang={lang} />}
                {activeSection === 'audit' && <AuditLogsSection lang={lang} />}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
