// Sprint 9B.25 — the autosave status type, and how two of them combine.
// Sprint 9B.28 — `dirty` added, and the precedence rewritten around it.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// Pure, and in its own module rather than beside the component that renders
// it: a .tsx file exporting both a component and a helper breaks fast refresh,
// and this half needs no React to be tested.

/** The shape the coordinator publishes. Declared here rather than imported
 *  from the provider so the renderer has no dependency on it. */
export type AutosaveStatusKind =
  | { kind: 'idle' }
  /** Changed locally and NOT yet written. Set on the first keystroke, before
   *  anything is sent.
   *
   *  Sprint 9B.28 — the state the machine did not have. `save()` used to set a
   *  private `isDirty` boolean and leave `status` alone, so a `saved` chip from
   *  the previous write stayed on screen over an edit that had not been sent.
   *  A provider who typed and left read "Saved" about a value the server had
   *  never seen. */
  | { kind: 'dirty' }
  | { kind: 'saving' }
  /** Acknowledged by the server for the LATEST logical revision of this step.
   *
   *  `projectionStale` means the write landed but the hub/review refresh that
   *  follows it did not. The write is safe and the chip says so — "Saved —
   *  refreshing status" — because reporting a failure here would be untrue. */
  | { kind: 'saved'; at: number; projectionStale?: boolean }
  /** The browser reports no connection. Distinct from `error`: nothing is
   *  wrong with the data and retrying now would fail for a reason the provider
   *  can see out the window. The pending edit is held, not discarded. */
  | { kind: 'offline' }
  /** Another tab (or another device) advanced the draft. The local edit is
   *  behind, and overwriting would silently discard their work. */
  | { kind: 'conflict'; serverVersion: number }
  /** A save failed for a reason retrying might fix. */
  | { kind: 'error'; message: string; retry: () => void };

/**
 * One status line for a screen with more than one autosaved step.
 *
 * Precedence is the policy, and Sprint 9B.28 changed it: `dirty` now outranks
 * `saved`. Two steps share one line on the Basics and Services screens, and
 * the old ranking scored both `dirty` and `saved` at zero — so a screen with
 * one step written and the other still unsent showed "Saved". That is the
 * false-saved-state in its most direct form.
 *
 * Reading downward: a conflict outranks an error outranks offline outranks
 * saving outranks dirty outranks saved. The provider needs the most
 * consequential fact, and "Saved" is only ever the most consequential fact
 * when there is genuinely nothing outstanding anywhere on the screen.
 */
export function mergeAutosaveStatus(
  a: AutosaveStatusKind,
  b: AutosaveStatusKind,
): AutosaveStatusKind {
  return rankOf(a) >= rankOf(b) ? a : b;
}

function rankOf(x: AutosaveStatusKind): number {
  switch (x.kind) {
    case 'conflict':
      return 6;
    case 'error':
      return 5;
    case 'offline':
      return 4;
    case 'saving':
      return 3;
    case 'dirty':
      return 2;
    case 'saved':
      return 1;
    default:
      return 0;
  }
}

/** Merge any number of steps' statuses. The two-step screens use the pair
 *  form; a screen that grows a third step must not grow a nested call. */
export function mergeAllAutosaveStatuses(
  statuses: readonly AutosaveStatusKind[],
): AutosaveStatusKind {
  return statuses.reduce<AutosaveStatusKind>((acc, next) => mergeAutosaveStatus(acc, next), {
    kind: 'idle',
  });
}
