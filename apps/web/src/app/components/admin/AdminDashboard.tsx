import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  DollarSign,
  AlertTriangle,
  Bell,
  X,
  Search,
  Zap,
  LogOut,
  Menu,
  Settings,
} from 'lucide-react';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
import { useEcosystem } from '../../context/EcosystemContext';
import { useAuthIdentity } from '../../../lib/use-auth-identity';
import { useAuth } from '../../../lib/auth-provider';
import {
  useAdminRoles,
  useAdminUserDetail,
  useAdminUsers,
  useUpdateAdminUserStatus,
} from '../../hooks/admin/useAdminUsers';
import { VerificationSection } from './VerificationSection';
import { DisputeSection } from './DisputesSection';
import { DashboardOverview } from './DashboardOverview';
import { FinancialsSection } from './FinancialsSection';
import { SettingsSection } from './SettingsSection';
import type {
  AdminUserStatus,
  AdminUserSummary,
  UpdateUserStatusRequest,
} from '@homeservicemarketplace/contracts';

// ─── Types ─────────────────────────────────────────────────────────────────────
type Section = 'dashboard' | 'users' | 'verification' | 'financials' | 'disputes' | 'settings';

// ─── User Control (Sprint 6.1) ────────────────────────────────────────────────
//
// Replaces the prior "Coming Soon" placeholder with a real, API-driven
// admin user table: search by query, filter by role + status, open the
// detail drawer, flip the user's status. All mutations are audited
// server-side; the hook tree invalidates the admin/users root on every
// successful PATCH so the table reconciles without a manual refetch.
const STATUS_OPTIONS: ReadonlyArray<AdminUserStatus | 'ALL'> = [
  'ALL',
  'ACTIVE',
  'SUSPENDED',
  'LOCKED',
  'PENDING_VERIFICATION',
];

function statusBadgeClass(status: AdminUserStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'SUSPENDED':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    case 'LOCKED':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'PENDING_VERIFICATION':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'DELETED':
      return 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

function UsersSection({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const [searchInput, setSearchInput] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<AdminUserStatus | undefined>(undefined);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const usersQuery = useAdminUsers({
    query: committedQuery || undefined,
    role: roleFilter,
    status: statusFilter,
    limit: 50,
  });
  const rolesQuery = useAdminRoles();

  const items: AdminUserSummary[] = usersQuery.data?.items ?? [];

  const L = {
    title: isAr ? 'إدارة المستخدمين' : 'User Control',
    searchPlaceholder: isAr ? 'ابحث بالبريد أو الاسم' : 'Search by email or name',
    searchAction: isAr ? 'بحث' : 'Search',
    role: isAr ? 'الدور' : 'Role',
    status: isAr ? 'الحالة' : 'Status',
    allRoles: isAr ? 'كل الأدوار' : 'All roles',
    allStatuses: isAr ? 'كل الحالات' : 'All statuses',
    columns: {
      name: isAr ? 'المستخدم' : 'User',
      roles: isAr ? 'الأدوار' : 'Roles',
      status: isAr ? 'الحالة' : 'Status',
      created: isAr ? 'منذ' : 'Created',
    },
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    failed: isAr
      ? 'تعذّر تحميل المستخدمين. حاول مرة أخرى.'
      : 'Could not load users. Please try again.',
    empty: isAr ? 'لا يوجد مستخدمون مطابقون.' : 'No users match the current filters.',
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header + filter bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <div className="flex flex-wrap gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCommittedQuery(searchInput.trim());
            }}
            className="flex gap-2"
          >
            <div className="relative">
              <Search
                size={14}
                className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400"
              />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={L.searchPlaceholder}
                className="ps-9 pe-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                style={{ fontSize: '13px', minWidth: '240px' }}
                aria-label={L.searchPlaceholder}
              />
            </div>
            <button
              type="submit"
              className="px-3 py-2 rounded-2xl bg-blue-600 text-white"
              style={{ fontSize: '13px', fontWeight: 700 }}
            >
              {L.searchAction}
            </button>
          </form>
          <select
            value={roleFilter ?? ''}
            onChange={(e) => setRoleFilter(e.target.value || undefined)}
            className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            style={{ fontSize: '13px' }}
            aria-label={L.role}
          >
            <option value="">{L.allRoles}</option>
            {(rolesQuery.data?.items ?? []).map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter ?? 'ALL'}
            onChange={(e) =>
              setStatusFilter(
                e.target.value === 'ALL' ? undefined : (e.target.value as AdminUserStatus),
              )
            }
            className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            style={{ fontSize: '13px' }}
            aria-label={L.status}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'ALL' ? L.allStatuses : s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {usersQuery.isPending ? (
          <p
            className="py-12 text-center text-slate-400"
            role="status"
            style={{ fontSize: '13px' }}
          >
            {L.loading}
          </p>
        ) : usersQuery.isError ? (
          <p className="py-12 text-center text-rose-600" role="status" style={{ fontSize: '13px' }}>
            {L.failed}
          </p>
        ) : items.length === 0 ? (
          <p
            className="py-12 text-center text-slate-400"
            role="status"
            style={{ fontSize: '13px' }}
          >
            {L.empty}
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700 text-start">
                <th
                  className="px-4 py-3 text-slate-500 text-start"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {L.columns.name}
                </th>
                <th
                  className="px-4 py-3 text-slate-500 text-start"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {L.columns.roles}
                </th>
                <th
                  className="px-4 py-3 text-slate-500 text-start"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {L.columns.status}
                </th>
                <th
                  className="px-4 py-3 text-slate-500 text-start"
                  style={{ fontSize: '11px', fontWeight: 700 }}
                >
                  {L.columns.created}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  className="border-b border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '13px', fontWeight: 600 }}
                    >
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="text-slate-400" style={{ fontSize: '11px' }}>
                      {u.email}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span
                          key={r}
                          className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                          style={{ fontSize: '10px', fontWeight: 600 }}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full ${statusBadgeClass(u.status)}`}
                      style={{ fontSize: '10px', fontWeight: 700 }}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500" style={{ fontSize: '11px' }}>
                    {new Date(u.createdAt).toLocaleDateString(isAr ? 'ar' : 'en')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedUserId ? (
        <UserDetailDrawer
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
          lang={lang}
        />
      ) : null}
    </div>
  );
}

function UserDetailDrawer({
  userId,
  onClose,
  lang,
}: {
  userId: string;
  onClose: () => void;
  lang: string;
}) {
  const isAr = lang === 'ar';
  const detailQuery = useAdminUserDetail(userId);
  const setStatus = useUpdateAdminUserStatus();
  const { user: meUser } = useAuth();
  const isSelf = meUser?.id === userId;
  const user = detailQuery.data;

  const L = {
    detail: isAr ? 'تفاصيل المستخدم' : 'User detail',
    close: isAr ? 'إغلاق' : 'Close',
    suspend: isAr ? 'تعليق' : 'Suspend',
    activate: isAr ? 'تفعيل' : 'Activate',
    selfWarning: isAr ? 'لا يمكنك تعطيل حسابك الخاص.' : 'You cannot disable your own account.',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    error: isAr ? 'تعذّر تحميل التفاصيل.' : 'Could not load user details.',
    saving: isAr ? 'جارٍ الحفظ…' : 'Saving…',
    saveFailed: isAr ? 'فشل التحديث.' : 'Update failed.',
  };

  const onFlip = async (next: 'ACTIVE' | 'SUSPENDED') => {
    if (!user) return;
    const body: UpdateUserStatusRequest = { status: next };
    await setStatus.mutateAsync({ userId: user.id, body });
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-label={L.close} />
      <div className="relative ms-auto w-full max-w-md bg-white dark:bg-slate-800 h-full overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3
            className="text-slate-900 dark:text-white"
            style={{ fontSize: '18px', fontWeight: 800 }}
          >
            {L.detail}
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
            aria-label={L.close}
          >
            <X size={18} />
          </button>
        </div>

        {detailQuery.isPending ? (
          <p className="text-slate-400" role="status" style={{ fontSize: '13px' }}>
            {L.loading}
          </p>
        ) : detailQuery.isError || !user ? (
          <p className="text-rose-600" role="status" style={{ fontSize: '13px' }}>
            {L.error}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '16px', fontWeight: 700 }}
              >
                {user.firstName} {user.lastName}
              </p>
              <p className="text-slate-500" style={{ fontSize: '13px' }}>
                {user.email}
              </p>
              <span
                className={`mt-1 inline-block w-fit px-2 py-1 rounded-full ${statusBadgeClass(user.status)}`}
                style={{ fontSize: '10px', fontWeight: 700 }}
              >
                {user.status}
              </span>
            </div>

            <div>
              <p className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
                {isAr ? 'الأدوار' : 'Roles'}
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {user.roles.map((r) => (
                  <span
                    key={r}
                    className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                    style={{ fontSize: '11px', fontWeight: 600 }}
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-slate-500" style={{ fontSize: '11px' }}>
              <div>
                <p style={{ fontWeight: 700 }}>{isAr ? 'تم التحقق' : 'Email verified'}</p>
                <p>
                  {user.emailVerifiedAt ? new Date(user.emailVerifiedAt).toLocaleString() : '—'}
                </p>
              </div>
              <div>
                <p style={{ fontWeight: 700 }}>MFA</p>
                <p>{user.mfaEnabled ? '✓' : '—'}</p>
              </div>
              <div>
                <p style={{ fontWeight: 700 }}>{isAr ? 'تاريخ الإنشاء' : 'Created'}</p>
                <p>{new Date(user.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p style={{ fontWeight: 700 }}>{isAr ? 'آخر تحديث' : 'Updated'}</p>
                <p>{new Date(user.updatedAt).toLocaleString()}</p>
              </div>
            </div>

            <div className="mt-2 flex flex-col gap-2">
              {isSelf ? (
                <p className="text-amber-600" style={{ fontSize: '12px' }} role="status">
                  {L.selfWarning}
                </p>
              ) : null}
              {user.status === 'ACTIVE' ? (
                <button
                  type="button"
                  disabled={isSelf || setStatus.isPending}
                  onClick={() => onFlip('SUSPENDED')}
                  className="w-full py-2 rounded-2xl bg-rose-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontSize: '14px', fontWeight: 700 }}
                >
                  {setStatus.isPending ? L.saving : L.suspend}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={setStatus.isPending}
                  onClick={() => onFlip('ACTIVE')}
                  className="w-full py-2 rounded-2xl bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ fontSize: '14px', fontWeight: 700 }}
                >
                  {setStatus.isPending ? L.saving : L.activate}
                </button>
              )}
              {setStatus.isError ? (
                <p className="text-rose-600" style={{ fontSize: '12px' }} role="status">
                  {L.saveFailed}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────
const SIDEBAR_ITEMS: { id: Section; icon: React.ReactNode; en: string; ar: string }[] = [
  { id: 'dashboard', icon: <LayoutDashboard size={18} />, en: 'Dashboard', ar: 'لوحة التحكم' },
  { id: 'users', icon: <Users size={18} />, en: 'User Control', ar: 'إدارة المستخدمين' },
  {
    id: 'verification',
    icon: <ShieldCheck size={18} />,
    en: 'Pro Verification',
    ar: 'توثيق المحترفين',
  },
  { id: 'financials', icon: <DollarSign size={18} />, en: 'Financials', ar: 'الماليات' },
  { id: 'disputes', icon: <AlertTriangle size={18} />, en: 'Dispute Center', ar: 'مركز النزاعات' },
  { id: 'settings', icon: <Settings size={18} />, en: 'Settings', ar: 'الإعدادات' },
];

// ─── Admin Dashboard shell ────────────────────────────────────────────────────
export function AdminDashboard() {
  const { lang, dir, darkMode, toggleDarkMode } = useLang();
  const { adminNotifs } = useEcosystem();
  const [activeSection, setActiveSection] = useState<Section>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const unread = adminNotifs.filter((n) => !n.read).length;

  // Identity binding (Sprint admin-identity patch). `useAuthIdentity`
  // returns null fields while /auth/me is loading or absent — we render
  // those as empty so the existing visual containers stay in place
  // without flashing fake "AD" / "admin@fixnow.app" copy. The "Platform
  // Administrator" string below is a generic role label, not a personal
  // name; it sits next to the user's real identity instead of replacing
  // it. RequireAdmin already gated this route, so reaching this render
  // means a real authenticated admin session exists once /me resolves.
  const identity = useAuthIdentity();
  const displayName = identity.displayName ?? '';
  const initials = identity.initials ?? '';
  const email = identity.email ?? '';
  const roleLabel = lang === 'ar' ? 'مدير المنصة' : 'Platform Administrator';

  const SECTION_TITLES: Record<Section, { en: string; ar: string }> = {
    dashboard: { en: 'Dashboard', ar: 'لوحة التحكم' },
    users: { en: 'User Control', ar: 'إدارة المستخدمين' },
    verification: { en: 'Pro Verification', ar: 'توثيق المحترفين' },
    financials: { en: 'Financials', ar: 'التقارير المالية' },
    disputes: { en: 'Dispute Center', ar: 'مركز النزاعات' },
    settings: { en: 'Settings', ar: 'الإعدادات' },
  };

  const fontFamily = lang === 'ar' ? "'Cairo','Inter',sans-serif" : "'Inter',sans-serif";

  return (
    <div
      className={`flex ${darkMode ? 'dark' : ''} min-h-screen`}
      style={{ fontFamily, direction: dir, background: '#f8fafc' }}
      dir={dir}
    >
      {/* ── Sidebar ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: dir === 'rtl' ? '100%' : '-100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir === 'rtl' ? '100%' : '-100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-64 flex-shrink-0 bg-slate-900 dark:bg-slate-950 flex flex-col min-h-screen z-20"
          >
            {/* Logo */}
            <div className="flex items-center gap-3 px-5 py-6 border-b border-white/10">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                <Zap size={18} className="text-white" />
              </div>
              <div>
                <p className="text-white" style={{ fontSize: '16px', fontWeight: 800 }}>
                  FixNow
                </p>
                <p className="text-white/40" style={{ fontSize: '10px' }}>
                  {lang === 'ar' ? 'لوحة الإدارة' : 'Admin Panel'}
                </p>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
              {SIDEBAR_ITEMS.map(({ id, icon, en, ar }) => {
                const active = activeSection === id;
                return (
                  <motion.button
                    key={id}
                    onClick={() => setActiveSection(id)}
                    whileTap={{ scale: 0.97 }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-start transition-all ${
                      active
                        ? 'bg-amber-500 text-white shadow-lg shadow-amber-900/40'
                        : 'text-white/60 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className={active ? 'text-white' : 'text-white/40'}>{icon}</span>
                    <span style={{ fontSize: '14px', fontWeight: active ? 700 : 400 }}>
                      {lang === 'ar' ? ar : en}
                    </span>
                    {id === 'verification' && (
                      <span
                        className="ms-auto w-5 h-5 rounded-full bg-amber-400/20 text-amber-300 flex items-center justify-center"
                        style={{ fontSize: '10px', fontWeight: 800 }}
                      >
                        7
                      </span>
                    )}
                    {id === 'disputes' && (
                      <span
                        className="ms-auto w-5 h-5 rounded-full bg-red-400/20 text-red-400 flex items-center justify-center"
                        style={{ fontSize: '10px', fontWeight: 800 }}
                      >
                        3
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </nav>

            {/* Sidebar footer */}
            <div className="px-3 py-4 border-t border-white/10">
              <div className="flex items-center gap-3 px-4 py-3">
                <div
                  data-testid="admin-sidebar-avatar"
                  className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0"
                >
                  <span className="text-white" style={{ fontSize: '12px', fontWeight: 800 }}>
                    {initials}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    data-testid="admin-sidebar-name"
                    className="text-white truncate"
                    style={{ fontSize: '13px', fontWeight: 600 }}
                  >
                    {displayName}
                  </p>
                  <p
                    data-testid="admin-sidebar-email"
                    className="text-white/40 truncate"
                    style={{ fontSize: '10px' }}
                  >
                    {email || roleLabel}
                  </p>
                </div>
                <button
                  aria-label={lang === 'ar' ? 'تسجيل الخروج' : 'Sign out'}
                  className="text-white/40 hover:text-white/70 transition-colors"
                >
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Top bar */}
        <header className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 shadow-sm flex items-center justify-between px-6 py-4 z-10 sticky top-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition-all"
            >
              <Menu size={18} className="text-slate-600 dark:text-slate-300" />
            </button>
            <div>
              <h1
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '18px', fontWeight: 800 }}
              >
                {lang === 'ar'
                  ? SECTION_TITLES[activeSection].ar
                  : SECTION_TITLES[activeSection].en}
              </h1>
              <p className="text-slate-400" style={{ fontSize: '12px' }}>
                {new Date().toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="hidden md:flex items-center gap-2 bg-slate-100 dark:bg-slate-700 rounded-xl px-4 py-2.5 w-64">
              <Search size={14} className="text-slate-400" />
              <input
                placeholder={lang === 'ar' ? 'بحث…' : 'Search…'}
                className="flex-1 bg-transparent text-slate-600 dark:text-slate-300 placeholder-slate-400 outline-none"
                style={{ fontSize: '13px' }}
              />
            </div>

            {/* Dark mode */}
            <button
              onClick={toggleDarkMode}
              className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition-all"
            >
              <span style={{ fontSize: '14px' }}>{darkMode ? '☀️' : '🌙'}</span>
            </button>

            {/* Lang toggle */}
            <LangToggle />

            {/* Notifications */}
            <button className="relative w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center active:scale-90 transition-all">
              <Bell size={17} className="text-slate-600 dark:text-slate-300" />
              {unread > 0 && (
                <span
                  className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center border-2 border-white dark:border-slate-800"
                  style={{ fontSize: '8px', fontWeight: 800 }}
                >
                  {unread}
                </span>
              )}
            </button>

            {/* Admin avatar */}
            <div
              data-testid="admin-topbar-avatar"
              title={displayName || roleLabel}
              className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center"
            >
              <span className="text-white" style={{ fontSize: '11px', fontWeight: 800 }}>
                {initials}
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6 overflow-auto dark:bg-slate-900">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {activeSection === 'dashboard' && <DashboardOverview lang={lang} />}
              {activeSection === 'verification' && <VerificationSection />}
              {activeSection === 'financials' && <FinancialsSection lang={lang} />}
              {activeSection === 'disputes' && <DisputeSection lang={lang} />}
              {activeSection === 'settings' && <SettingsSection lang={lang} />}
              {activeSection === 'users' && <UsersSection lang={lang} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
