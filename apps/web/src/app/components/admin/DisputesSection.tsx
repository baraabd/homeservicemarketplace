import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Clock, FileText, MessageSquare, X } from 'lucide-react';
import type {
  DisputeEvent,
  DisputePriorityValue,
  DisputeStatusValue,
  DisputeSummary,
  ResolveDisputeRequest,
  UpdateDisputeRequest,
} from '@homeservicemarketplace/contracts';

import {
  useAdminDisputeDetail,
  useAdminDisputes,
  useResolveAdminDispute,
  useUpdateAdminDispute,
} from '../../hooks/admin/useAdminDisputes';

// ─── Disputes section (Sprint 6.3 refined) ────────────────────────
//
// Real, API-driven admin disputes surface. Replaces the prior
// hardcoded `DISPUTES` mock list. Layout:
//
//   • Status filter chips (OPEN / IN_REVIEW / RESOLVED_REFUND /
//     RESOLVED_PARTIAL / RESOLVED_DENIED / CANCELLED + ALL)
//   • Priority filter chips (URGENT / HIGH / MEDIUM / LOW + ALL)
//   • Cursor-paginated table
//   • Detail drawer:
//       - identity (booking / opener / status / priority badges)
//       - description editor (PATCH save)
//       - status / priority editor (PATCH save)
//       - event timeline (recentEvents from /detail)
//       - resolve form (status + resolution → POST /resolve)

const STATUS_VALUES: DisputeStatusValue[] = [
  'OPEN',
  'IN_REVIEW',
  'RESOLVED_REFUND',
  'RESOLVED_PARTIAL',
  'RESOLVED_DENIED',
  'CANCELLED',
];
const PRIORITY_VALUES: DisputePriorityValue[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

const RESOLVE_STATUSES = ['RESOLVED_REFUND', 'RESOLVED_PARTIAL', 'RESOLVED_DENIED'] as const;

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    case 'IN_REVIEW':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'RESOLVED_REFUND':
    case 'RESOLVED_PARTIAL':
    case 'RESOLVED_DENIED':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
    case 'CANCELLED':
      return 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

function priorityBadgeClass(priority: string): string {
  switch (priority) {
    case 'URGENT':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
    case 'HIGH':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'MEDIUM':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'LOW':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export function DisputeSection({ lang }: { lang: string }) {
  const isAr = lang === 'ar';
  const [statusFilter, setStatusFilter] = useState<DisputeStatusValue | undefined>(undefined);
  const [priorityFilter, setPriorityFilter] = useState<DisputePriorityValue | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useAdminDisputes({
    status: statusFilter,
    priority: priorityFilter,
    limit: 50,
  });
  const items: DisputeSummary[] = listQuery.data?.items ?? [];

  const L = {
    title: isAr ? 'مركز النزاعات' : 'Dispute Center',
    statusFilter: isAr ? 'الحالة' : 'Status',
    priorityFilter: isAr ? 'الأولوية' : 'Priority',
    all: isAr ? 'الكل' : 'All',
    booking: isAr ? 'الحجز' : 'Booking',
    opener: isAr ? 'المُفتِح' : 'Opener',
    statusCol: isAr ? 'الحالة' : 'Status',
    priorityCol: isAr ? 'الأولوية' : 'Priority',
    openedCol: isAr ? 'فُتح في' : 'Opened',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    failed: isAr ? 'تعذّر تحميل النزاعات.' : 'Could not load disputes.',
    empty: isAr ? 'لا توجد نزاعات مطابقة.' : 'No disputes match the current filter.',
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <h2
          className="text-slate-900 dark:text-white"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          {L.title}
        </h2>
        <div className="flex flex-col gap-2 items-end">
          <FilterChips
            label={L.statusFilter}
            allLabel={L.all}
            values={STATUS_VALUES}
            selected={statusFilter}
            onSelect={(v) => setStatusFilter(v)}
            badgeClass={statusBadgeClass}
          />
          <FilterChips
            label={L.priorityFilter}
            allLabel={L.all}
            values={PRIORITY_VALUES}
            selected={priorityFilter}
            onSelect={(v) => setPriorityFilter(v)}
            badgeClass={priorityBadgeClass}
          />
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
        {listQuery.isPending ? (
          <p
            className="py-12 text-center text-slate-400"
            role="status"
            style={{ fontSize: '13px' }}
          >
            {L.loading}
          </p>
        ) : listQuery.isError ? (
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
                {[L.booking, L.opener, L.statusCol, L.priorityCol, L.openedCol].map((h) => (
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
              {items.map((d) => (
                <tr
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className="border-b border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <p
                      className="text-slate-900 dark:text-white"
                      style={{ fontSize: '13px', fontWeight: 600 }}
                    >
                      {d.bookingId}
                    </p>
                    <p className="text-slate-400" style={{ fontSize: '11px' }}>
                      {d.reason}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-500" style={{ fontSize: '12px' }}>
                    {d.openedById}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full ${statusBadgeClass(d.status)}`}
                      style={{ fontSize: '10px', fontWeight: 700 }}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full ${priorityBadgeClass(d.priority)}`}
                      style={{ fontSize: '10px', fontWeight: 700 }}
                    >
                      {d.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500" style={{ fontSize: '12px' }}>
                    {new Date(d.createdAt).toLocaleDateString(isAr ? 'ar' : 'en')}
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
        <DisputeDetailDrawer
          disputeId={selectedId}
          onClose={() => setSelectedId(null)}
          lang={lang}
        />
      ) : null}
    </div>
  );
}

function FilterChips<V extends string>({
  label,
  allLabel,
  values,
  selected,
  onSelect,
  badgeClass,
}: {
  label: string;
  allLabel: string;
  values: V[];
  selected: V | undefined;
  onSelect: (v: V | undefined) => void;
  badgeClass: (v: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center" role="tablist" aria-label={label}>
      <span className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
        {label}:
      </span>
      <button
        type="button"
        role="tab"
        aria-selected={selected === undefined}
        onClick={() => onSelect(undefined)}
        className={`px-2.5 py-1 rounded-full transition-colors ${
          selected === undefined
            ? 'bg-blue-600 text-white'
            : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
        }`}
        style={{ fontSize: '11px', fontWeight: 700 }}
      >
        {allLabel}
      </button>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={selected === v}
          onClick={() => onSelect(v)}
          className={`px-2.5 py-1 rounded-full transition-colors ${
            selected === v ? badgeClass(v) : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
          }`}
          style={{ fontSize: '11px', fontWeight: 700 }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function DisputeDetailDrawer({
  disputeId,
  onClose,
  lang,
}: {
  disputeId: string;
  onClose: () => void;
  lang: string;
}) {
  const isAr = lang === 'ar';
  const detailQuery = useAdminDisputeDetail(disputeId);
  const update = useUpdateAdminDispute();
  const resolve = useResolveAdminDispute();
  const dispute = detailQuery.data;

  const [statusDraft, setStatusDraft] = useState<DisputeStatusValue | ''>('');
  const [priorityDraft, setPriorityDraft] = useState<DisputePriorityValue | ''>('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [resolveStatus, setResolveStatus] =
    useState<(typeof RESOLVE_STATUSES)[number]>('RESOLVED_REFUND');
  const [resolveText, setResolveText] = useState('');

  // Re-hydrate the drafts from the latest fetch. The drawer is a
  // controlled view — stale local state would otherwise persist across
  // re-opens.
  useEffect(() => {
    setStatusDraft(dispute?.status ?? '');
    setPriorityDraft(dispute?.priority ?? '');
    setDescriptionDraft(dispute?.description ?? '');
  }, [dispute?.status, dispute?.priority, dispute?.description]);

  const isTerminal = dispute
    ? dispute.status === 'RESOLVED_REFUND' ||
      dispute.status === 'RESOLVED_PARTIAL' ||
      dispute.status === 'RESOLVED_DENIED' ||
      dispute.status === 'CANCELLED'
    : false;

  const L = {
    title: isAr ? 'تفاصيل النزاع' : 'Dispute detail',
    close: isAr ? 'إغلاق' : 'Close',
    statusLabel: isAr ? 'الحالة' : 'Status',
    priorityLabel: isAr ? 'الأولوية' : 'Priority',
    descriptionLabel: isAr ? 'الوصف' : 'Description',
    descriptionPlaceholder: isAr ? 'وصف داخلي…' : 'Internal description…',
    save: isAr ? 'حفظ التغييرات' : 'Save changes',
    saving: isAr ? 'جارٍ الحفظ…' : 'Saving…',
    saved: isAr ? 'تم الحفظ' : 'Saved',
    timeline: isAr ? 'سجل الأحداث' : 'Event timeline',
    timelineEmpty: isAr ? 'لا توجد أحداث.' : 'No events.',
    resolveTitle: isAr ? 'تسوية النزاع' : 'Resolve dispute',
    resolveLabel: isAr ? 'النص' : 'Resolution',
    resolvePlaceholder: isAr ? 'كيف تم حلها…' : 'How was it resolved…',
    resolveAction: isAr ? 'تسوية' : 'Resolve',
    resolveTerminal: isAr
      ? 'النزاع في حالة نهائية ولا يمكن تعديله.'
      : 'Dispute is in a terminal state and cannot be edited.',
    loading: isAr ? 'جارٍ التحميل…' : 'Loading…',
    error: isAr ? 'تعذّر تحميل التفاصيل.' : 'Could not load details.',
    saveFailed: isAr ? 'فشل الحفظ.' : 'Save failed.',
  };

  const onSave = () => {
    if (!dispute) return;
    const body: UpdateDisputeRequest = {};
    if (statusDraft && statusDraft !== dispute.status) {
      body.status = statusDraft as DisputeStatusValue;
    }
    if (priorityDraft && priorityDraft !== dispute.priority) {
      body.priority = priorityDraft as DisputePriorityValue;
    }
    if (descriptionDraft !== (dispute.description ?? '')) {
      body.description = descriptionDraft;
    }
    if (Object.keys(body).length === 0) return;
    update.mutate({ disputeId: dispute.id, body });
  };

  const onResolve = () => {
    if (!dispute) return;
    if (!resolveText.trim()) return;
    const body: ResolveDisputeRequest = { status: resolveStatus, resolution: resolveText.trim() };
    resolve.mutate({ disputeId: dispute.id, body });
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
            {L.title}
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
        ) : detailQuery.isError || !dispute ? (
          <p className="text-rose-600" role="status" style={{ fontSize: '13px' }}>
            {L.error}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p
                className="text-slate-900 dark:text-white"
                style={{ fontSize: '15px', fontWeight: 700 }}
              >
                #{dispute.id}
              </p>
              <p className="text-slate-500" style={{ fontSize: '13px' }}>
                {dispute.reason}
              </p>
              <div className="flex gap-2 mt-2">
                <span
                  className={`px-2 py-1 rounded-full ${statusBadgeClass(dispute.status)}`}
                  style={{ fontSize: '10px', fontWeight: 700 }}
                >
                  {dispute.status}
                </span>
                <span
                  className={`px-2 py-1 rounded-full ${priorityBadgeClass(dispute.priority)}`}
                  style={{ fontSize: '10px', fontWeight: 700 }}
                >
                  {dispute.priority}
                </span>
              </div>
            </div>

            {isTerminal ? (
              <p
                className="text-amber-700 dark:text-amber-400 px-3 py-2 rounded-2xl bg-amber-50 dark:bg-amber-900/30"
                role="status"
                style={{ fontSize: '12px' }}
              >
                {L.resolveTerminal}
              </p>
            ) : (
              <>
                <FieldEditors
                  statusDraft={statusDraft}
                  setStatusDraft={setStatusDraft}
                  priorityDraft={priorityDraft}
                  setPriorityDraft={setPriorityDraft}
                  descriptionDraft={descriptionDraft}
                  setDescriptionDraft={setDescriptionDraft}
                  labels={L}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={update.isPending}
                    className="px-3 py-1.5 rounded-2xl bg-blue-600 text-white disabled:opacity-50"
                    style={{ fontSize: '12px', fontWeight: 700 }}
                  >
                    {update.isPending ? L.saving : L.save}
                  </button>
                  {update.isSuccess ? (
                    <span className="text-green-600" role="status" style={{ fontSize: '11px' }}>
                      ✓ {L.saved}
                    </span>
                  ) : null}
                  {update.isError ? (
                    <span className="text-rose-600" role="status" style={{ fontSize: '11px' }}>
                      {L.saveFailed}
                    </span>
                  ) : null}
                </div>
              </>
            )}

            <Timeline events={dispute.recentEvents ?? []} labels={L} />

            {!isTerminal ? (
              <ResolveBlock
                resolveStatus={resolveStatus}
                setResolveStatus={setResolveStatus}
                resolveText={resolveText}
                setResolveText={setResolveText}
                onResolve={onResolve}
                isPending={resolve.isPending}
                isError={resolve.isError}
                labels={L}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function FieldEditors({
  statusDraft,
  setStatusDraft,
  priorityDraft,
  setPriorityDraft,
  descriptionDraft,
  setDescriptionDraft,
  labels,
}: {
  statusDraft: DisputeStatusValue | '';
  setStatusDraft: (s: DisputeStatusValue | '') => void;
  priorityDraft: DisputePriorityValue | '';
  setPriorityDraft: (p: DisputePriorityValue | '') => void;
  descriptionDraft: string;
  setDescriptionDraft: (s: string) => void;
  labels: {
    statusLabel: string;
    priorityLabel: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
  };
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="dispute-edit-status"
            className="text-slate-500"
            style={{ fontSize: '11px', fontWeight: 700 }}
          >
            {labels.statusLabel}
          </label>
          <select
            id="dispute-edit-status"
            value={statusDraft}
            onChange={(e) => setStatusDraft(e.target.value as DisputeStatusValue)}
            className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            style={{ fontSize: '12px' }}
          >
            <option value="OPEN">OPEN</option>
            <option value="IN_REVIEW">IN_REVIEW</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="dispute-edit-priority"
            className="text-slate-500"
            style={{ fontSize: '11px', fontWeight: 700 }}
          >
            {labels.priorityLabel}
          </label>
          <select
            id="dispute-edit-priority"
            value={priorityDraft}
            onChange={(e) => setPriorityDraft(e.target.value as DisputePriorityValue)}
            className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            style={{ fontSize: '12px' }}
          >
            {PRIORITY_VALUES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
          {labels.descriptionLabel}
        </span>
        <textarea
          value={descriptionDraft}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          placeholder={labels.descriptionPlaceholder}
          rows={3}
          maxLength={4000}
          className="w-full px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-y"
          style={{ fontSize: '13px' }}
        />
      </label>
    </div>
  );
}

function Timeline({
  events,
  labels,
}: {
  events: DisputeEvent[];
  labels: { timeline: string; timelineEmpty: string };
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
        {labels.timeline}
      </p>
      {events.length === 0 ? (
        <p className="text-slate-400" role="status" style={{ fontSize: '12px' }}>
          {labels.timelineEmpty}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {events.map((evt) => (
            <li
              key={evt.id}
              className="flex items-start gap-2 px-3 py-2 rounded-2xl bg-slate-50 dark:bg-slate-700/40"
            >
              {evt.type === 'OPENED' ? (
                <AlertTriangle size={14} className="text-rose-600 flex-shrink-0 mt-0.5" />
              ) : evt.type === 'RESOLVED' ? (
                <FileText size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
              ) : evt.type === 'COMMENTED' ? (
                <MessageSquare size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />
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
                {evt.message ? (
                  <p
                    className="mt-0.5 text-slate-500 dark:text-slate-300"
                    style={{ fontSize: '11px' }}
                  >
                    {evt.message}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResolveBlock({
  resolveStatus,
  setResolveStatus,
  resolveText,
  setResolveText,
  onResolve,
  isPending,
  isError,
  labels,
}: {
  resolveStatus: (typeof RESOLVE_STATUSES)[number];
  setResolveStatus: (s: (typeof RESOLVE_STATUSES)[number]) => void;
  resolveText: string;
  setResolveText: (s: string) => void;
  onResolve: () => void;
  isPending: boolean;
  isError: boolean;
  labels: {
    resolveTitle: string;
    resolveLabel: string;
    resolvePlaceholder: string;
    resolveAction: string;
    saveFailed: string;
    saving: string;
  };
}) {
  return (
    <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-slate-100 dark:border-slate-700">
      <p className="text-slate-500" style={{ fontSize: '11px', fontWeight: 700 }}>
        {labels.resolveTitle}
      </p>
      <select
        value={resolveStatus}
        onChange={(e) => setResolveStatus(e.target.value as (typeof RESOLVE_STATUSES)[number])}
        className="px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
        style={{ fontSize: '12px' }}
      >
        {RESOLVE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <textarea
        value={resolveText}
        onChange={(e) => setResolveText(e.target.value)}
        placeholder={labels.resolvePlaceholder}
        rows={3}
        maxLength={2048}
        className="w-full px-3 py-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 resize-y"
        style={{ fontSize: '13px' }}
        aria-label={labels.resolveLabel}
      />
      <button
        type="button"
        onClick={onResolve}
        disabled={isPending || !resolveText.trim()}
        className="w-fit px-3 py-1.5 rounded-2xl bg-green-600 text-white disabled:opacity-50"
        style={{ fontSize: '12px', fontWeight: 700 }}
      >
        {isPending ? labels.saving : labels.resolveAction}
      </button>
      {isError ? (
        <span className="text-rose-600" role="status" style={{ fontSize: '11px' }}>
          {labels.saveFailed}
        </span>
      ) : null}
    </div>
  );
}
