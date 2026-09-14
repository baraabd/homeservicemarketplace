import {
  CalendarDays,
  FileCheck,
  Image as ImageIcon,
  MapPin,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ProviderOnboardingHubTask } from '@homeservicemarketplace/contracts';

import { isTaskActionable } from '../hub-view-state';
import { statusExplanation, statusLabel, taskCopy, type Lang } from '../copy/onboarding-hub-copy';
import { ProviderStatusBadge, toneForTaskStatus } from '../../provider-ui';

// Sprint 9B.16 — one task row.
// Sprint 09B.29 Phase 5A — drawn as the approved `.hsm-task`.
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
// WHAT PHASE 5A CHANGED, AND WHAT IT WAS CAREFUL NOT TO
//
// The geometry is the approved one: a `34px 1fr auto` grid at 68px minimum
// height, an icon tile on the leading edge, and a text-only badge. The chevron
// is gone — the approved row does not draw one, and on a row that is sometimes
// not a button it was promising navigation the row could not always perform.
//
// The blocked EXPLANATION is still here and is still rendered, but as
// screen-reader text rather than a third visible line. That keeps the promise
// the original comment made — a row the provider cannot press must say why —
// while matching a design that gives every row the same two lines. Dropping it
// entirely would have been the easy way to match the picture and would have
// restored the dead end it was written to fix.

/**
 * The icon the approved hub gives each task.
 *
 * Keyed on the wire `id`, like the prose, so a task from a newer server is
 * drawn without one rather than with a wrong one.
 */
const TASK_ICONS: Record<string, LucideIcon> = {
  BASICS_IDENTITY: User,
  SERVICES_EXPERIENCE: Wrench,
  WORK_AREA: MapPin,
  WORKING_HOURS: CalendarDays,
  PORTFOLIO: ImageIcon,
  REVIEW_SUBMISSION: FileCheck,
};

interface HubTaskRowProps {
  task: ProviderOnboardingHubTask;
  lang: Lang;
  onOpen: (taskId: string) => void;
  /**
   * What a FINISHED row reports instead of its guidance.
   *
   * Null on the partial hub, and null for any task whose data has not
   * arrived — a half-built summary would be worse than the sentence it
   * replaces. See hub-task-summary.ts.
   */
  summary?: string | null;
}

export function HubTaskRow({ task, lang, onOpen, summary = null }: HubTaskRowProps) {
  const copy = taskCopy(task, lang);
  const actionable = isTaskActionable(task.status);
  const explanation = statusExplanation(task.status, lang);
  const badge = statusLabel(task.status, lang);

  /**
   * The badge tone, as the approved hub paints it.
   *
   * BLOCKED reads `todo` here rather than `blocked`. The approved hub gives
   * every task the provider has not finished the SAME grey "Required" pill: a
   * task that is merely waiting its turn is not a warning, and painting it
   * amber beside a genuine action-required row would spend the alarm colour on
   * the ordinary case. The shared tone map is left alone — the workspace still
   * distinguishes them — and the row is still non-interactive, still announces
   * why through `task-explanation`, and still carries its status in
   * `data-status`.
   */
  const tone = task.status === 'BLOCKED' ? 'todo' : toneForTaskStatus(task.status);
  const Icon = TASK_ICONS[task.id];

  /**
   * The one sentence the row's second line carries.
   *
   * A real `summary` first — the provider's own hours or photo count, which is
   * what the reference draws. Then the status EXPLANATION, for the statuses
   * where the badge cannot speak for itself: this copy maps both `AVAILABLE`
   * and `BLOCKED` to "Required", and the sentence telling them apart used to be
   * `sr-only`, so a sighted provider staring at two "Required" rows was told
   * nothing about which one was theirs to act on. Then the static description.
   */
  const secondLine = summary ?? explanation ?? copy.description;

  const body = (
    <>
      {/* `.hsm-task-icon`: a 34px sunken tile, muted glyph, 10px radius. 16px
          for the same reason every other icon on these screens is — the
          reference's pinned icon build does not carry the requested size onto
          the `<svg>` it substitutes. */}
      <span className="grid h-[34px] w-[34px] place-items-center rounded-pv-control bg-pv-surface-sunken text-pv-muted">
        {/* stroke-width 1.8, not lucide-react's default 2. The reference's
            own icon pass is `createIcons({attrs:{'stroke-width':1.8}})`, and
            at 16px that fifth of a pixel per stroke is visible on every glyph
            on the screen. */}
        {Icon ? <Icon size={16} strokeWidth={1.8} aria-hidden="true" /> : null}
      </span>

      <span className="min-w-0 text-start">
        {/* break-words, not truncate: a task title is the one string on the
            row the provider must be able to read in full, and Arabic wording
            runs longer than its English counterpart. */}
        {/* `.hsm-task strong` is 14px at weight 500, not 600: the approved
            design declares no weight on it, so it takes the wrapper's
            `b,strong,th { font-weight: medium }`. The screens that want bold
            say so explicitly (`.hsm-heading`, `.hsm-badge`, `.hsm-primary`);
            this one deliberately does not. */}
        <span className="block min-w-0 break-words text-pv-body font-medium text-pv-text">
          {copy.title}
        </span>
        {/* `leading-4` — 16px, NOT the 21px base line box.

            The approved row's second line is a `<small>`, and the wrapper it
            sits in gives that element `line-height: calc(font-size-small +
            4px)` = 16px. `.hsm-task small` overrides the SIZE to 11px and
            leaves the line-height alone, so the real line box is 16px.

            It matters twice over: the row's text block is 39px tall rather
            than 44, so `align-items: center` puts it 2.5px lower inside the
            68px row, and the gap between the two lines is 5px tighter. At
            21px every title on the hub sat 3px high and every subtitle 1px
            high — measured against the reference DOM, not guessed. */}
        {/* `font-normal` explicitly, because this row is a `<button>` on an
            open task and a `<div>` on a closed one — and the base layer gives
            `button` a 500 weight that everything inside it inherits. The two
            shapes were rendering the same sentence at two different weights,
            and the open one was heavier than the reference. */}
        {/* The second line, and WHICH sentence belongs on it.

            Reported from manual testing: the hub sat at 4 of 6 with two tasks
            reading "Required", and nothing on screen said why either was
            required or what to do about it. The reason is that this copy maps
            BOTH `AVAILABLE` (your input is needed) and `BLOCKED` (finish an
            earlier task first) to the same word, and the sentence that told
            them apart was rendered `sr-only` — so a sighted provider was told
            nothing at all.

            The explanation now takes this line for the statuses where the badge
            is ambiguous on its own. No line is added: the reference draws one
            second line per row, and for a blocked or waiting task "Finish the
            tasks above first" is strictly more useful than a static description
            of a task they cannot open yet.

            A real `summary` still wins, because that is provider data — their
            actual hours, their photo count — and the reference shows it. The
            `sr-only` copy is gone rather than duplicated: the same sentence
            twice is announced twice. */}
        <span
          className="mt-0.5 block break-words text-pv-caption font-normal leading-4 text-pv-muted"
          // The testid travels with the SENTENCE, not with a fixed element, so
          // the reason lives in exactly one node whether it is the visible line
          // or the announced-only one. Rendering it twice made "find the
          // explanation" ambiguous — which is its own small lesson about
          // duplicating copy for the convenience of a selector.
          data-testid={secondLine === explanation ? `task-explanation-${task.id}` : undefined}
        >
          {secondLine}
        </span>
        {/* Only when the visible line is a SUMMARY does the reason still need a
            home: provider data wins the line, and the reason is announced. */}
        {explanation && secondLine !== explanation ? (
          <span className="sr-only" data-testid={`task-explanation-${task.id}`}>
            {explanation}
          </span>
        ) : null}
      </span>

      <span data-testid={`task-status-${task.id}`} className="flex-shrink-0">
        <ProviderStatusBadge tone={tone} label={badge} shape="pill" />
      </span>
    </>
  );

  const shared =
    'grid w-full min-h-[68px] grid-cols-[34px_1fr_auto] items-center gap-2.5 rounded-pv-row border border-pv-border bg-pv-surface px-3 py-[11px] text-start';

  if (!actionable) {
    return (
      <div
        className={shared}
        data-testid={`task-row-${task.id}`}
        data-actionable="false"
        data-status={task.status}
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
      className={`${shared} transition-colors hover:border-pv-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent`}
    >
      {body}
    </button>
  );
}
