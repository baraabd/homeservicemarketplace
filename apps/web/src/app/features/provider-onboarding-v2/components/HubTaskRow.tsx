import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ProviderOnboardingHubTask } from '@homeservicemarketplace/contracts';

import { isTaskActionable } from '../hub-view-state';
import { statusExplanation, statusLabel, taskCopy, type Lang } from '../copy/onboarding-hub-copy';
import { ProviderStatusBadge, toneForTaskStatus } from '../../provider-ui';

// Sprint 9B.16 — one task row. Restyled onto the provider design system in
// Mode B; the semantics below are unchanged and are the reason this component
// exists at all.
//
// The row has exactly two shapes, and which one it takes is decided by the
// SERVER's status, never by anything the client knows about the form behind
// it:
//
//   AVAILABLE  → a real <button>. Focusable, in the tab order, announced as a
//                button, and it navigates.
//   everything → a plain container. NOT a disabled button: a disabled control
//   else         is still announced as a control, still invites a press, and
//                tells a screen-reader user only that something they cannot
//                identify is unavailable. A row that is not an action should
//                not pretend to be one — it should say what it is waiting for.
//
// That sentence is the reason `statusExplanation` exists. A greyed row with no
// explanation leaves the provider with one move: press it again.
//
// What Mode B changed: the status is now a ProviderStatusBadge, so it carries
// an icon AND a word rather than a grey pill whose colour did the work; and
// the surfaces come from `--pv-*` tokens instead of hard-coded slate.

interface HubTaskRowProps {
  task: ProviderOnboardingHubTask;
  lang: Lang;
  dir: 'ltr' | 'rtl';
  onOpen: (taskId: string) => void;
}

export function HubTaskRow({ task, lang, dir, onOpen }: HubTaskRowProps) {
  const copy = taskCopy(task, lang);
  const actionable = isTaskActionable(task.status);
  const explanation = statusExplanation(task.status, lang);
  const badge = statusLabel(task.status, lang);
  const Chevron = dir === 'rtl' ? ChevronLeft : ChevronRight;

  // Shared inner layout, so the two shapes cannot drift apart visually.
  const body = (
    <>
      <div className="min-w-0 flex-1 text-start">
        {/* break-words, not truncate: a task title is the one string on the
            row the provider must be able to read in full, and Arabic wording
            runs longer than its English counterpart. */}
        <span className="block min-w-0 break-words text-[15px] font-semibold text-pv-text">
          {copy.title}
        </span>
        <p className="mt-0.5 break-words text-[13px] text-pv-muted">{copy.description}</p>
        {explanation ? (
          <p
            className="mt-1.5 break-words text-[13px] text-pv-blocked"
            data-testid={`task-explanation-${task.id}`}
          >
            {explanation}
          </p>
        ) : null}
      </div>

      <span className="flex flex-shrink-0 items-center gap-2">
        <span data-testid={`task-status-${task.id}`}>
          <ProviderStatusBadge tone={toneForTaskStatus(task.status)} label={badge} />
        </span>
        {actionable ? <Chevron size={18} aria-hidden="true" className="text-pv-muted" /> : null}
      </span>
    </>
  );

  const shared = 'w-full flex items-start gap-3 rounded-xl border p-3.5 border-pv-border';

  if (!actionable) {
    return (
      <div
        className={`${shared} bg-pv-surface-sunken`}
        data-testid={`task-row-${task.id}`}
        data-actionable="false"
        data-status={task.status}
        style={{ minHeight: '44px' }}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      data-testid={`task-row-${task.id}`}
      data-actionable="true"
      data-status={task.status}
      // The accessible name is the task title plus its state, so a
      // screen-reader user hears WHICH task without having to explore the row.
      aria-label={`${copy.title} — ${badge}`}
      className={`${shared} bg-pv-surface text-start transition-colors hover:border-pv-accent hover:bg-pv-accent-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent`}
      style={{ minHeight: '44px' }}
    >
      {body}
    </button>
  );
}
