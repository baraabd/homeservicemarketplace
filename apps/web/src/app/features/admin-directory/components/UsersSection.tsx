import { statusLabel } from '../../admin-provider-review/copy';
import { useState } from 'react';
import { Link } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type {
  AdminAccessRequestStatus,
  AdminUserStatus,
  AdminUserSummary,
  UpdateUserStatusRequest,
} from '@homeservicemarketplace/contracts';
import { useAuth } from '../../../../lib/auth-provider';
import { useLang } from '../../../i18n/LanguageContext';
import {
  useAdminRoles,
  useAdminUserDetail,
  useAdminUsers,
  useUpdateAdminUserStatus,
} from '../../../hooks/admin/useAdminUsers';
import { useDirectoryLocation } from '../hooks/useDirectoryLocation';
import {
  DirectorySearch,
  DirectoryError,
  DirectoryPagination,
  directoryControl,
  directoryPrimary,
} from './DirectoryPrimitives';

const ROLE_LABELS: Record<string, { en: string; ar: string }> = {
  admin: { en: 'Administrator', ar: 'مسؤول إدارة' },
  provider: { en: 'Provider', ar: 'مهني' },
  customer: { en: 'Customer', ar: 'عميل' },
  seeker: { en: 'Customer', ar: 'عميل' },
};
function roleLabel(value: string, isAr: boolean): string {
  return ROLE_LABELS[value.toLowerCase()]?.[isAr ? 'ar' : 'en'] ?? value;
}

const STATUS_OPTIONS: ReadonlyArray<AdminUserStatus | 'ALL'> = [
  'ALL',
  'ACTIVE',
  'SUSPENDED',
  'LOCKED',
  'PENDING_VERIFICATION',
];

// Phase 4 — the ADMIN-ACCESS-REQUEST axis, rendered as its own badge.
//
// This is deliberately a different colour family from the account-status
// badge: a reader must not be able to mistake "asked for admin access" for
// "the account is active". Null (never asked) renders nothing at all — an
// empty cell is honest, whereas a "NONE" badge invites reading it as a state
// the user is in.
function adminAccessBadgeClass(status: AdminAccessRequestStatus): string {
  // Deliberately a DIFFERENT colour family from statusBadgeClass below.
  //
  // A suspended account and a rejected admin request are different facts about
  // different axes, and they frequently appear in the same row. Painting both
  // rose made the row say "red, red" and told the reader nothing about which
  // axis was in trouble — a real defect the browser tests caught by comparing
  // the two computed backgrounds.
  switch (status) {
    case 'PENDING':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
    case 'REJECTED':
      // Purple, not rose: rose is reserved for the ACCOUNT axis (SUSPENDED).
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
    case 'CANCELLED':
      return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

function adminAccessLabel(status: AdminAccessRequestStatus, isAr: boolean): string {
  switch (status) {
    case 'PENDING':
      return isAr ? 'قيد المراجعة' : 'Pending';
    case 'APPROVED':
      return isAr ? 'مُعتمد' : 'Approved';
    case 'REJECTED':
      return isAr ? 'مرفوض' : 'Rejected';
    case 'CANCELLED':
      return isAr ? 'ملغى' : 'Cancelled';
    default:
      return status;
  }
}

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

export function UsersSection({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const list = useDirectoryLocation();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const roleFilter = list.params.get('role') || undefined;
  const statusFilter = list.params.get('status') as AdminUserStatus | null;
  const usersQuery = useAdminUsers({
    query: list.params.get('query') || undefined,
    role: roleFilter,
    status: statusFilter || undefined,
    cursor: list.cursor,
    limit: 50,
  });
  const rolesQuery = useAdminRoles();

  const items: AdminUserSummary[] = usersQuery.data?.items ?? [];

  const L = {
    title: isAr ? 'إدارة المستخدمين' : 'User directory',
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
      // Phase 4: a THIRD column, because admin standing is a separate axis
      // from the account status next to it.
      adminAccess: isAr ? 'وصول الإدارة' : 'Admin access',
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
        <h2 className="text-slate-900 dark:text-white text-xl font-extrabold">{L.title}</h2>
        <div className="flex w-full min-w-0 flex-wrap gap-2 lg:w-auto">
          <DirectorySearch
            value={list.params.get('query') ?? ''}
            onSearch={(value) => list.filter({ query: value || undefined })}
            isAr={isAr}
          />
          <select
            value={roleFilter ?? ''}
            onChange={(e) => list.filter({ role: e.target.value || undefined })}
            className={directoryControl}
            aria-label={L.role}
          >
            <option value="">{L.allRoles}</option>
            {(rolesQuery.data?.items ?? []).map((r) => (
              <option key={r.id} value={r.name}>
                {roleLabel(r.name, isAr)}
              </option>
            ))}
          </select>
          <select
            value={statusFilter ?? 'ALL'}
            onChange={(e) =>
              list.filter({ status: e.target.value === 'ALL' ? undefined : e.target.value })
            }
            className={directoryControl}
            aria-label={L.status}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'ALL' ? L.allStatuses : statusLabel(s, isAr ? 'ar' : 'en')}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {usersQuery.isPending ? (
          <p className="py-12 text-center text-slate-400" role="status">
            {L.loading}
          </p>
        ) : usersQuery.isError ? (
          <DirectoryError
            error={usersQuery.error}
            onRetry={() => void usersQuery.refetch()}
            isAr={isAr}
          />
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-slate-400" role="status">
            {L.empty}
          </p>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label={L.title} tabIndex={0}>
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700 text-start">
                  <th className="px-4 py-3 text-slate-500 text-start text-xs font-bold">
                    {L.columns.name}
                  </th>
                  <th className="px-4 py-3 text-slate-500 text-start text-xs font-bold">
                    {L.columns.roles}
                  </th>
                  <th className="px-4 py-3 text-slate-500 text-start text-xs font-bold">
                    {L.columns.status}
                  </th>
                  <th
                    className="px-4 py-3 text-slate-500 text-start text-xs font-bold"
                    data-testid="col-admin-access"
                  >
                    {L.columns.adminAccess}
                  </th>
                  <th className="px-4 py-3 text-slate-500 text-start text-xs font-bold">
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
                      <button
                        type="button"
                        onClick={() => setSelectedUserId(u.id)}
                        className="min-h-11 text-start font-semibold text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-white"
                      >
                        {u.firstName} {u.lastName}
                      </button>
                      <p className="text-slate-400 text-xs">{u.email}</p>
                    </td>
                    <td className="px-4 py-3" data-testid="cell-roles">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            data-testid="badge-role"
                            className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold"
                          >
                            {roleLabel(r, isAr)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3" data-testid="cell-account-status">
                      <span
                        data-testid="badge-account-status"
                        className={`px-2 py-1 rounded-full ${statusBadgeClass(u.status)}`}
                      >
                        {statusLabel(u.status, isAr ? 'ar' : 'en')}
                      </span>
                    </td>
                    <td className="px-4 py-3" data-testid="cell-admin-access">
                      {u.adminAccessRequestStatus ? (
                        <span
                          data-testid="badge-admin-access"
                          className={`px-2 py-1 rounded-full ${adminAccessBadgeClass(
                            u.adminAccessRequestStatus,
                          )}`}
                        >
                          {adminAccessLabel(u.adminAccessRequestStatus, isAr)}
                        </span>
                      ) : (
                        // Never asked. An empty cell is honest; a "NONE" badge
                        // would read as a state the user is in.
                        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(u.createdAt).toLocaleDateString(isAr ? 'ar' : 'en')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DirectoryPagination
          nextCursor={usersQuery.isError ? null : usersQuery.data?.nextCursor}
          onNext={list.nextPage}
          onPrevious={list.previousPage}
          hasPrevious={list.hasPrevious}
          previousIsFirst={list.previousIsFirst}
          pending={usersQuery.isFetching}
          count={items.length}
          isAr={isAr}
        />
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
  const { darkMode, dir } = useLang();
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

  const onFlip = (next: 'ACTIVE' | 'SUSPENDED') => {
    if (!user) return;
    const body: UpdateUserStatusRequest = { status: next };
    setStatus.mutate({ userId: user.id, body });
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          dir={dir}
          className={`${darkMode ? 'dark' : ''} fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-6 text-slate-900 shadow-xl dark:bg-slate-800 dark:text-white`}
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-bold text-slate-900 dark:text-white">
              {L.detail}
            </Dialog.Title>
            <button
              onClick={onClose}
              className="flex size-11 items-center justify-center rounded-xl hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-slate-700"
              aria-label={L.close}
            >
              <X size={18} />
            </button>
          </div>

          {detailQuery.isPending ? (
            <p className="text-slate-400" role="status">
              {L.loading}
            </p>
          ) : detailQuery.isError || !user ? (
            <p className="text-rose-600" role="status">
              {L.error}
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <p className="text-slate-900 dark:text-white text-base font-bold">
                  {user.firstName} {user.lastName}
                </p>
                <p className="break-all text-slate-500 text-sm" dir="ltr">
                  {user.email}
                </p>
                <span
                  className={`mt-1 inline-block w-fit px-2 py-1 rounded-full ${statusBadgeClass(user.status)}`}
                >
                  {statusLabel(user.status, isAr ? 'ar' : 'en')}
                </span>
              </div>

              <div>
                <p className="text-slate-500 text-xs font-bold">{isAr ? 'الأدوار' : 'Roles'}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {user.roles.map((r) => (
                    <span
                      key={r}
                      className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold"
                    >
                      {roleLabel(r, isAr)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-slate-500 text-xs">
                <div>
                  <p className="font-bold">{isAr ? 'تم التحقق' : 'Email verified'}</p>
                  <p>
                    {user.emailVerifiedAt
                      ? new Date(user.emailVerifiedAt).toLocaleString(lang)
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="font-bold">MFA</p>
                  <p>{user.mfaEnabled ? '✓' : '—'}</p>
                </div>
                <div>
                  <p className="font-bold">{isAr ? 'تاريخ الإنشاء' : 'Created'}</p>
                  <p>{new Date(user.createdAt).toLocaleString(lang)}</p>
                </div>
                <div>
                  <p className="font-bold">{isAr ? 'آخر تحديث' : 'Updated'}</p>
                  <p>{new Date(user.updatedAt).toLocaleString(lang)}</p>
                </div>
              </div>

              <Link
                className={directoryPrimary}
                to={`/admin/providers?userId=${encodeURIComponent(user.id)}`}
                onClick={onClose}
              >
                {isAr ? 'عرض ملف المهني المرتبط' : 'Find linked provider profile'}
              </Link>
              <div className="mt-2 flex flex-col gap-2">
                {isSelf ? (
                  <p className="text-amber-600 text-sm" role="status">
                    {L.selfWarning}
                  </p>
                ) : null}
                {user.status === 'ACTIVE' ? (
                  <button
                    type="button"
                    disabled={isSelf || setStatus.isPending}
                    onClick={() => onFlip('SUSPENDED')}
                    className="min-h-11 w-full py-2 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 bg-rose-600 text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold"
                  >
                    {setStatus.isPending ? L.saving : L.suspend}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={setStatus.isPending}
                    onClick={() => onFlip('ACTIVE')}
                    className="min-h-11 w-full py-2 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold"
                  >
                    {setStatus.isPending ? L.saving : L.activate}
                  </button>
                )}
                {setStatus.isError ? (
                  <p className="text-rose-600 text-sm" role="status">
                    {L.saveFailed}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
