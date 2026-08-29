// Sprint 9B.25 — the autosave status type, and how two of them combine.
//
// docs/sprint-09b25/HARDENING.md
//
// Pure, and in its own module rather than beside the component that renders
// it: a .tsx file exporting both a component and a helper breaks fast refresh,
// and this half needs no React to be tested.

/** The shape `useOnboardingStepAutosave` publishes. Declared here rather than
 *  imported from the hook so the renderer has no dependency on it. */
export type AutosaveStatusKind =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'offline' }
  | { kind: 'conflict'; serverVersion: number }
  | { kind: 'error'; message: string; retry: () => void };

/**
 * One status line for a screen with TWO autosaves.
 *
 * Precedence is deliberate: a conflict outranks an error outranks offline
 * outranks saving. The provider needs the most consequential fact, and "Saved"
 * appearing while the other step is mid-conflict would be a lie by omission —
 * the false-saved-state this sprint exists to remove.
 *
 * Lifted out of BasicsTaskScreen, which had the only copy. ServicesTaskScreen
 * is the other two-autosave screen and had no status at all, which is exactly
 * what one private helper in one screen produces.
 */
export function mergeAutosaveStatus(
  a: AutosaveStatusKind,
  b: AutosaveStatusKind,
): AutosaveStatusKind {
  const rank = (x: AutosaveStatusKind) =>
    x.kind === 'conflict'
      ? 4
      : x.kind === 'error'
        ? 3
        : x.kind === 'offline'
          ? 2
          : x.kind === 'saving'
            ? 1
            : 0;
  return rank(a) >= rank(b) ? a : b;
}
