// Provider status vocabulary (Mode B).
//
// docs/provider-experience-v2/UX_UI_DESIGN_SYSTEM.md §7.
//
// ONE mapping from a server-owned status to its presentation, so a task row,
// a badge, a notice and a timeline entry cannot disagree about what "blocked"
// looks like. Screens pass a status; they never pass a colour.
//
// Every tone carries a WORD and an ICON as well as a hue. Colour alone fails
// WCAG 1.4.1 and is unreadable to a colour-blind provider, and this is a
// surface where the difference between "we are reviewing this" and "you must
// do something" decides whether anyone acts.

export type ProviderTone = 'done' | 'todo' | 'blocked' | 'waiting' | 'danger' | 'accent';

/** Tailwind classes per tone. Token-backed — see styles/theme.css `--pv-*`. */
export const TONE_CLASSES: Readonly<
  Record<ProviderTone, { text: string; bg: string; border: string }>
> = Object.freeze({
  done: { text: 'text-pv-done', bg: 'bg-pv-done-bg', border: 'border-pv-done-border' },
  todo: { text: 'text-pv-todo', bg: 'bg-pv-todo-bg', border: 'border-pv-todo-border' },
  blocked: {
    text: 'text-pv-blocked',
    bg: 'bg-pv-blocked-bg',
    border: 'border-pv-blocked-border',
  },
  waiting: {
    text: 'text-pv-waiting',
    bg: 'bg-pv-waiting-bg',
    border: 'border-pv-waiting-border',
  },
  danger: { text: 'text-pv-danger', bg: 'bg-pv-danger-bg', border: 'border-pv-danger-border' },
  accent: { text: 'text-pv-accent', bg: 'bg-pv-accent-subtle', border: 'border-pv-accent' },
});

/**
 * The hub's task statuses, as the server sends them.
 *
 * `AVAILABLE` is deliberately `todo` rather than `accent`: it is the ordinary
 * state of most of the list, and painting every outstanding task in the accent
 * colour leaves nothing for the one action we actually want pressed.
 */
export const TASK_STATUS_TONE: Readonly<Record<string, ProviderTone>> = Object.freeze({
  COMPLETE: 'done',
  AVAILABLE: 'todo',
  BLOCKED: 'blocked',
  WAITING: 'waiting',
});

/**
 * The four axes, kept apart.
 *
 * Collapsing these into one badge is the defect ADR 0005 exists to prevent: a
 * provider can be verified and unable to work, and "approved" answers neither
 * question. `workAccess` is the loudest because it is the only one that
 * answers "can I earn today".
 */
export type ProviderAxis = 'onboarding' | 'standing' | 'verification' | 'workAccess';

export const AXIS_ORDER: readonly ProviderAxis[] = Object.freeze([
  'workAccess',
  'verification',
  'standing',
  'onboarding',
]);

export function toneForTaskStatus(status: string): ProviderTone {
  return TASK_STATUS_TONE[status] ?? 'todo';
}
