import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDashed,
  Clock,
  Lock,
  XCircle,
} from 'lucide-react';

import { TONE_CLASSES, toneForTaskStatus, type ProviderTone } from './status';
import { ProviderButton } from './primitives';

// Provider feedback surfaces (Mode B): status, notices, states, timeline.

const TONE_ICON: Record<ProviderTone, typeof Check> = {
  done: Check,
  todo: CircleDashed,
  blocked: Lock,
  waiting: Clock,
  danger: XCircle,
  accent: ChevronRight,
};

/**
 * A status badge: hue, icon AND word, always all three.
 *
 * The baseline carried status in a small pill whose colour did most of the
 * work. A provider who cannot distinguish the greens from the ambers had to
 * infer their application's state from position in a list.
 */
export function ProviderStatusBadge({
  tone,
  label,
  className = '',
}: {
  tone: ProviderTone;
  label: string;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  const c = TONE_CLASSES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] font-semibold ${c.text} ${c.bg} ${c.border} ${className}`}
    >
      <Icon size={13} aria-hidden="true" className="flex-shrink-0" />
      {label}
    </span>
  );
}

/**
 * A blocker or notice that says the SPECIFIC thing.
 *
 * This component exists because of one line in the baseline: a real consent
 * requirement rendered as "Something here still needs attention", with no
 * indication of what or where. A notice without a `title` that names the
 * problem, and without an action that reaches it, is a dead end — so `title`
 * is required and `action` is strongly encouraged.
 */
export function ProviderNotice({
  tone = 'blocked',
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}: {
  tone?: ProviderTone;
  title: string;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  const c = TONE_CLASSES[tone];
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3.5 ${c.bg} ${c.border} ${className}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <Icon size={18} aria-hidden="true" className={`mt-0.5 flex-shrink-0 ${c.text}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-[14px] font-semibold ${c.text}`}>{title}</p>
        {description ? <p className="mt-1 text-[13px] text-pv-text">{description}</p> : null}
        {actionLabel && onAction ? (
          <ProviderButton
            tone="secondary"
            onClick={onAction}
            className="mt-2.5 !min-h-[40px] px-3.5"
          >
            {actionLabel}
          </ProviderButton>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One task in the hub.
 *
 * A row that leads somewhere is a `button`; a row that does not is a `div`.
 * The baseline rendered completed and locked rows as buttons too, so a
 * keyboard user tabbed onto controls that did nothing when pressed.
 */
export function ProviderTaskRow({
  id,
  title,
  description,
  status,
  statusLabel,
  explanation,
  onOpen,
}: {
  id: string;
  title: string;
  description?: string;
  status: string;
  statusLabel: string;
  /** Why this task cannot be opened — shown only when it cannot. */
  explanation?: string;
  onOpen?: () => void;
}) {
  const tone = toneForTaskStatus(status);
  const actionable = Boolean(onOpen);

  const body = (
    <>
      <div className="min-w-0 flex-1 text-start">
        <p className="text-[15px] font-semibold text-pv-text">{title}</p>
        {description ? <p className="mt-0.5 text-[13px] text-pv-muted">{description}</p> : null}
        {explanation ? <p className="mt-1.5 text-[13px] text-pv-blocked">{explanation}</p> : null}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <ProviderStatusBadge tone={tone} label={statusLabel} />
        {actionable ? (
          <ChevronRight size={18} aria-hidden="true" className="text-pv-muted rtl:rotate-180" />
        ) : null}
      </div>
    </>
  );

  const shared =
    'flex w-full items-start gap-3 rounded-xl border p-3.5 text-start transition-colors';

  if (!actionable) {
    return (
      <div
        data-testid={`task-row-${id}`}
        data-status={status}
        data-actionable="false"
        className={`${shared} border-pv-border bg-pv-surface-sunken`}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`task-row-${id}`}
      data-status={status}
      data-actionable="true"
      onClick={onOpen}
      aria-label={`${title} — ${statusLabel}`}
      className={`${shared} min-h-[44px] border-pv-border bg-pv-surface hover:border-pv-accent hover:bg-pv-accent-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent`}
    >
      {body}
    </button>
  );
}

/**
 * Autosave state, in one vocabulary.
 *
 * The offline copy stays pessimistic on purpose: pending edits live in memory,
 * and telling a provider their work is safe when it is not is a lie they pay
 * for when the tab closes.
 */
export function ProviderAutosaveIndicator({
  state,
  labels,
}: {
  state: 'idle' | 'saving' | 'saved' | 'offline' | 'error';
  labels: Record<'idle' | 'saving' | 'saved' | 'offline' | 'error', string>;
}) {
  const tone: ProviderTone =
    state === 'error'
      ? 'danger'
      : state === 'offline'
        ? 'blocked'
        : state === 'saved'
          ? 'done'
          : 'todo';
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="provider-autosave"
      data-state={state}
      className={`text-[12px] font-medium ${TONE_CLASSES[tone].text}`}
    >
      {labels[state]}
    </p>
  );
}

export function ProviderEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-pv-border px-6 py-12 text-center"
      data-testid="provider-empty"
    >
      <p className="text-[15px] font-semibold text-pv-text">{title}</p>
      {description ? <p className="max-w-sm text-[13px] text-pv-muted">{description}</p> : null}
      {actionLabel && onAction ? (
        <ProviderButton onClick={onAction} className="mt-2">
          {actionLabel}
        </ProviderButton>
      ) : null}
    </div>
  );
}

export function ProviderErrorState({
  title,
  description,
  retryLabel,
  onRetry,
}: {
  title: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="provider-error"
      className="flex flex-col items-start gap-2 rounded-xl border border-pv-danger-border bg-pv-danger-bg p-4"
    >
      <p className="flex items-center gap-2 text-[14px] font-semibold text-pv-danger">
        <AlertTriangle size={16} aria-hidden="true" />
        {title}
      </p>
      {description ? <p className="text-[13px] text-pv-text">{description}</p> : null}
      {retryLabel && onRetry ? (
        <ProviderButton tone="secondary" onClick={onRetry} className="mt-1 !min-h-[40px]">
          {retryLabel}
        </ProviderButton>
      ) : null}
    </div>
  );
}

/**
 * A skeleton that matches the shape of what is coming.
 *
 * A spinner in place of content tells the reader nothing about what will
 * appear; a skeleton the same size stops the layout jumping when it does.
 */
export function ProviderSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" data-testid="provider-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-[72px] animate-pulse rounded-xl bg-pv-surface-sunken motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

export interface TimelineEntry {
  id: string;
  title: string;
  detail?: string;
  at?: string;
  tone: ProviderTone;
  current?: boolean;
}

/** What happened, when, and what is next — as an ordered list, because it is one. */
export function ProviderStatusTimeline({ entries }: { entries: readonly TimelineEntry[] }) {
  return (
    <ol className="flex flex-col gap-0" data-testid="provider-timeline">
      {entries.map((e, i) => {
        const Icon = TONE_ICON[e.tone];
        const c = TONE_CLASSES[e.tone];
        const last = i === entries.length - 1;
        return (
          <li key={e.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border ${c.bg} ${c.border} ${c.text}`}
              >
                <Icon size={14} aria-hidden="true" />
              </span>
              {!last ? <span className="w-px flex-1 bg-pv-border" /> : null}
            </div>
            <div className={`min-w-0 flex-1 ${last ? 'pb-0' : 'pb-5'}`}>
              <p
                className={`text-[14px] ${e.current ? 'font-semibold text-pv-text' : 'font-medium text-pv-text'}`}
              >
                {e.title}
              </p>
              {e.detail ? <p className="mt-0.5 text-[13px] text-pv-muted">{e.detail}</p> : null}
              {e.at ? <p className="mt-0.5 text-[12px] text-pv-muted">{e.at}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
