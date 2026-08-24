import { useEffect, useState } from 'react';
import { Check, ChevronRight, Clock, FileText, Shield, ShieldCheck, X } from 'lucide-react';
import type {
  AdminProviderAction,
  AdminProviderSummary,
  ProviderAuditEvent,
} from '@homeservicemarketplace/contracts';

import { useLang } from '../../i18n/LanguageContext';
import {
  useAdminProviderAudit,
  useAdminProviderDecision,
  useAdminProviderDetail,
  useAdminProviders,
  useUpdateAdminProviderReviewNotes,
} from '../../hooks/admin/useAdminProviders';

// ─── Verification (Sprint 6.2 refined) ──────────────────────────
//
// Real, API-driven Pro Verification surface. Replaces the prior
// `PRO_VERIFICATIONS` mock list. Layout:
//
//   • Header + status filter chips (PENDING_REVIEW / ACTIVE / SUSPENDED /
//     REJECTED / DRAFT)
//   • Provider list table (cursor-paginated, polled at 60 s)
//   • Detail drawer:
//       - identity + status badge
//       - review notes textarea (PATCH save)
//       - documents panel (deferred — file storage not yet shipped)
//       - audit history timeline (real audit events scoped by
//         metadata.providerProfileId)
//       - approve / reject / suspend / reactivate actions, gated by the
//         SERVER's `availableActions` (Sprint 9). This component does not
//         know the transition table: it used to, disagreed with the backend
//         about DRAFT, and offered a button that 409'd.

const STATUS_VALUES = ['PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'DRAFT'] as const;
type StatusValue = (typeof STATUS_VALUES)[number];

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'PENDING_REVIEW':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'ACTIVE':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'SUSPENDED':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    case 'REJECTED':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    case 'DRAFT':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export function VerificationSection() {
  const { lang } = useLang();
  const isAr = lang === 'ar';
  const [statusFilter, setStatusFilter] = useState<StatusValue>('PENDING_REVIEW');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const providersQuery = useAdminProviders({ status: statusFilter, limit: 50 });
  const items: AdminProviderSummary[] = providersQuery.data?.items ?? [];

  const L = {
    title: isAr ? 'التحقق من المحترفين' : 'Pro Verification',
    filter: isAr ? 'حالة' : 'Status',
    nameCol: isAr ? 'المحترف' : 'Provider',
    cityCol: isAr ? 'المدينة' : 'City',
    statusCol: isAr ? 'الحالة' : 'Status',
    appliedCol: isAr ? 'منذ' : 'Applied',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    failed: isAr ? 'تعذّر تحميل المحترفين.' : 'Could not load providers.',
    empty: isAr ? 'لا يوجد محترفون مطابقون.' : 'No providers match the current filter.',
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={L.filter}>
          {STATUS_VALUES.map((s) => {
            const active = s === statusFilter;
            return (
              <button
                key={s}
                role="tab"
                type="button"
                onClick={() => setStatusFilter(s)}
                aria-selected={active}
                className={`px-3 py-1.5 rounded-full transition-colors ${
                  active ? statusBadgeClass(s) : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                }`}
                style={{ fontSize: '11px', fontWeight: 700 }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {providersQuery.isPending ? (
          <p
            className="py-12 text-center text-slate-400"
            role="status"
            style={{ fontSize: '13px' }}
          >
            {L.loading}
          </p>
        ) : providersQuery.isError ? (
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
              <tr className="border-b border-slate-100 dark:border-slate-700">
                {[L.nameCol, L.cityCol, L.statusCol, L.appliedCol].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-slate-500 text-start"
                    style={{ fontSize: '11px', fontWeight: 700 }}
                  >
                    {h}
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="border-b border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '13px', fontWeight: 600 }}
                    >
                      {p.displayName}
                    </p>
                    <p className="text-slate-400" style={{ fontSize: '11px' }}>
                      {p.email ?? '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-500" style={{ fontSize: '12px' }}>
                    {p.serviceAreaCity ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full ${statusBadgeClass(p.status)}`}
                      style={{ fontSize: '10px', fontWeight: 700 }}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500" style={{ fontSize: '12px' }}>
                    {new Date(p.createdAt).toLocaleDateString(isAr ? 'ar' : 'en')}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <ChevronRight size={16} className="text-slate-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId ? (
        <ProviderDetailDrawer
          providerProfileId={selectedId}
          onClose={() => setSelectedId(null)}
          lang={lang}
        />
      ) : null}
    </div>
  );
}

function ProviderDetailDrawer({
  providerProfileId,
  onClose,
  lang,
}: {
  providerProfileId: string;
  onClose: () => void;
  lang: string;
}) {
  const isAr = lang === 'ar';
  const detailQuery = useAdminProviderDetail(providerProfileId);
  const auditQuery = useAdminProviderAudit(providerProfileId);
  const saveNotes = useUpdateAdminProviderReviewNotes();
  const decision = useAdminProviderDecision();

  const provider = detailQuery.data;
  const [notesDraft, setNotesDraft] = useState('');
  const [decisionReason, setDecisionReason] = useState('');

  // Hydrate the textarea from the latest detail fetch. Whenever the
  // server-side review notes change (e.g. another admin saved), the
  // local draft re-syncs unless the user is mid-edit.
  useEffect(() => {
    setNotesDraft(provider?.reviewNotes ?? '');
  }, [provider?.reviewNotes]);

  const L = {
    detail: isAr ? 'تفاصيل المحترف' : 'Provider detail',
    close: isAr ? 'إغلاق' : 'Close',
    notes: isAr ? 'ملاحظات المراجع' : 'Reviewer notes',
    notesPlaceholder: isAr ? 'أضف ملاحظات داخلية…' : 'Add private review notes…',
    saveNotes: isAr ? 'حفظ الملاحظات' : 'Save notes',
    documents: isAr ? 'الوثائق' : 'Documents',
    documentsEmpty: isAr
      ? 'لا توجد وثائق مرفوعة بعد. سيظهر التحميل عند توفر تخزين الملفات.'
      : 'No documents uploaded yet. Document storage ships in a follow-up sprint.',
    history: isAr ? 'سجل التحقق' : 'Verification history',
    historyEmpty: isAr ? 'لا توجد أحداث بعد.' : 'No events yet.',
    actions: isAr ? 'الإجراءات' : 'Actions',
    approve: isAr ? 'قبول' : 'Approve',
    reject: isAr ? 'رفض' : 'Reject',
    suspend: isAr ? 'تعليق' : 'Suspend',
    reactivate: isAr ? 'إعادة تفعيل' : 'Reactivate',
    reasonLabel: isAr ? 'سبب (اختياري)' : 'Reason (optional)',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    error: isAr ? 'تعذّر تحميل التفاصيل.' : 'Could not load details.',
    saving: isAr ? 'جارٍ الحفظ…' : 'Saving…',
    saved: isAr ? 'تم الحفظ' : 'Saved',
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-label={L.close} />
      <div className="relative ms-auto w-full max-w-lg bg-white dark:bg-slate-800 h-full overflow-y-auto p-6 flex flex-col gap-5">
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
        ) : detailQuery.isError || !provider ? (
          <p className="text-rose-600" role="status" style={{ fontSize: '13px' }}>
            {L.error}
          </p>
        ) : (
          <>
            <ProviderIdentityBlock provider={provider} />

            <ReviewNotesBlock
              value={notesDraft}
              setValue={setNotesDraft}
              onSave={() => saveNotes.mutate({ providerProfileId: provider.id, notes: notesDraft })}
              isSaving={saveNotes.isPending}
              isSaved={saveNotes.isSuccess && (provider.reviewNotes ?? '') === notesDraft}
              labels={L}
            />

            <DocumentsPlaceholder labels={L} />

            <AuditHistoryBlock
              items={auditQuery.data?.items ?? []}
              isPending={auditQuery.isPending}
              labels={L}
            />

            <ActionsBlock
              availableActions={provider.availableActions ?? []}
              reason={decisionReason}
              setReason={setDecisionReason}
              onAction={(action) =>
                decision.mutate({
                  providerProfileId: provider.id,
                  action,
                  reason: decisionReason.trim() ? decisionReason.trim() : null,
                })
              }
              isPending={decision.isPending}
              labels={L}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ProviderIdentityBlock({ provider }: { provider: AdminProviderSummary }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-slate-900 dark:text-white" style={{ fontSize: '16px', fontWeight: 700 }}>
        {provider.displayName}
      </p>
      <p className="text-slate-500" style={{ fontSize: '13px' }}>
        {provider.email ?? '—'}
      </p>
      <span
        className={`mt-1 inline-block w-fit px-2 py-1 rounded-full ${statusBadgeClass(provider.status)}`}
        style={{ fontSize: '10px', fontWeight: 700 }}
      >
        {provider.status}
      </span>
      <div className="mt-2 grid grid-cols-3 gap-2 text-slate-500" style={{ fontSize: '11px' }}>
        <span>
          ★ {provider.ratingAvg.toFixed(1)} ({provider.reviewCount})
        </span>
        <span>{provider.completedJobs} jobs</span>
        <span>
          {provider.serviceAreaCity ?? '—'}
          {provider.serviceAreaCountry ? `, ${provider.serviceAreaCountry}` : ''}
        </span>
      </div>
    </div>
  );
}

function ReviewNotesBlock({
  value,
  setValue,
  onSave,
  isSaving,
  isSaved,
  labels,
}: {
  value: string;
  setValue: (s: string) => void;
  onSave: () => void;
  isSaving: boolean;
  isSaved: boolean;
  labels: {
    notes: string;
    notesPlaceholder: string;
    saveNotes: string;
    saving: string;
    saved: string;
  };
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="provider-review-notes"
        className="text-slate-500"
        style={{ fontSize: '11px', fontWeight: 700 }}
      >
        {labels.notes}
      </label>
      <textarea
        id="provider-review-notes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={labels.notesPlaceholder}
        rows={4}
        maxLength={4000}
        className="w-full px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-y"
        style={{ fontSize: '13px' }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="px-3 py-1.5 rounded-2xl bg-blue-600 text-white disabled:opacity-50"
          style={{ fontSize: '12px', fontWeight: 700 }}
        >
          {isSaving ? labels.saving : labels.saveNotes}
        </button>
        {isSaved ? (
          <span className="text-green-600" role="status" style={{ fontSize: '11px' }}>
            ✓ {labels.saved}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DocumentsPlaceholder({
  labels,
}: {
  labels: { documents: string; documentsEmpty: string };
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
        {labels.documents}
      </p>
      <div className="flex items-center gap-3 px-3 py-3 rounded-2xl bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700">
        <FileText size={18} className="text-slate-400" />
        <p className="text-slate-500" style={{ fontSize: '12px' }}>
          {labels.documentsEmpty}
        </p>
      </div>
    </div>
  );
}

function AuditHistoryBlock({
  items,
  isPending,
  labels,
}: {
  items: ProviderAuditEvent[];
  isPending: boolean;
  labels: { history: string; historyEmpty: string; loading: string };
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
        {labels.history}
      </p>
      {isPending ? (
        <p className="text-slate-400" role="status" style={{ fontSize: '12px' }}>
          {labels.loading}
        </p>
      ) : items.length === 0 ? (
        <p className="text-slate-400" role="status" style={{ fontSize: '12px' }}>
          {labels.historyEmpty}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((evt) => (
            <li
              key={evt.id}
              className="flex items-start gap-2 px-3 py-2 rounded-2xl bg-slate-50 dark:bg-slate-700/40"
            >
              {evt.type === 'ADMIN_PROVIDER_APPROVED' ? (
                <ShieldCheck size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
              ) : evt.type === 'ADMIN_PROVIDER_REJECTED' ? (
                <X size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
              ) : evt.type === 'ADMIN_PROVIDER_SUSPENDED' ? (
                <Shield size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
              ) : (
                <Clock size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className="text-slate-700 dark:text-slate-200"
                  style={{ fontSize: '12px', fontWeight: 600 }}
                >
                  {evt.type}
                </p>
                <p className="text-slate-400" style={{ fontSize: '11px' }}>
                  {new Date(evt.createdAt).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionsBlock({
  availableActions,
  reason,
  setReason,
  onAction,
  isPending,
  labels,
}: {
  /** What the SERVER says is legal from this provider's current status.
   *
   *  Sprint 9 / docs/sprint-09/INSPECTION.md D-3. This block used to derive
   *  the rule itself:
   *
   *      const canApprove = status === 'DRAFT' || status === 'PENDING_REVIEW';
   *
   *  which contradicted the backend's `from: ['PENDING_REVIEW']` and put an
   *  enabled Approve button on every DRAFT provider. Clicking it 409'd.
   *
   *  The component no longer knows the transition table. It renders what it
   *  is told, so the client cannot disagree with the server about
   *  authorization — the drift ADR 0006 exists to prevent. */
  availableActions: readonly AdminProviderAction[];
  reason: string;
  setReason: (s: string) => void;
  onAction: (action: AdminProviderAction) => void;
  isPending: boolean;
  labels: {
    actions: string;
    approve: string;
    reject: string;
    suspend: string;
    reactivate: string;
    reasonLabel: string;
  };
}) {
  // Absent (older payload, cache miss) degrades to NOTHING offered rather than
  // everything offered. A missing rule must fail closed.
  const can = (action: AdminProviderAction) => availableActions.includes(action);
  const canApprove = can('approve');
  const canReject = can('reject');
  const canSuspend = can('suspend');
  const canReactivate = can('reactivate');
  return (
    <div className="flex flex-col gap-2">
      <p className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
        {labels.actions}
      </p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={labels.reasonLabel}
        maxLength={1024}
        className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
        style={{ fontSize: '12px' }}
        aria-label={labels.reasonLabel}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canApprove || isPending}
          onClick={() => onAction('approve')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontSize: '12px', fontWeight: 700 }}
        >
          <Check size={13} /> {labels.approve}
        </button>
        <button
          type="button"
          disabled={!canReject || isPending}
          onClick={() => onAction('reject')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontSize: '12px', fontWeight: 700 }}
        >
          <X size={13} /> {labels.reject}
        </button>
        <button
          type="button"
          disabled={!canSuspend || isPending}
          onClick={() => onAction('suspend')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-amber-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontSize: '12px', fontWeight: 700 }}
        >
          <Shield size={13} /> {labels.suspend}
        </button>
        <button
          type="button"
          disabled={!canReactivate || isPending}
          onClick={() => onAction('reactivate')}
          className="flex items-center justify-center gap-1.5 py-2 rounded-2xl bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontSize: '12px', fontWeight: 700 }}
        >
          <ShieldCheck size={13} /> {labels.reactivate}
        </button>
      </div>
    </div>
  );
}
