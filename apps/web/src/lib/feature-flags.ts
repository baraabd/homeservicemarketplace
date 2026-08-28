// Sprint 9B.16 — client feature flags.
//
// One flag so far: the V2 provider onboarding surface (full-screen shell +
// hub). It ships DEFAULT OFF, so a deploy that says nothing about it keeps
// serving the Sprint 8 wizard and no provider sees a half-built journey.
//
// Two inputs, in priority order:
//
//   1. `localStorage['hsm.ff.providerOnboardingV2']` — per-browser override.
//   2. `VITE_PROVIDER_ONBOARDING_V2` — the deployment default, baked in at
//      build time.
//
// The override exists because the flag's value is otherwise fixed at BUILD
// time, and both states have to be provable against the one bundle the
// browser suite builds. Playwright seeds it through `addInitScript`, exactly
// as the language preference is already seeded in e2e/fixtures.ts.
//
// It is safe to let a real user set it: the flag chooses which onboarding UI
// renders and nothing else. Every task's readiness comes from the server, and
// every write behind these screens is authorised server-side by the same
// capability rules the wizard is subject to — so a provider who flips this
// sees a different screen, never data or an action they were not already
// entitled to.

const OVERRIDE_KEY = 'hsm.ff.providerOnboardingV2';

/** Truthy spellings accepted from either source. Anything else — including a
 *  missing value, an empty string, and the literal "false" — is OFF. The
 *  default has to be the safe one in every unrecognised case, because an
 *  unrecognised case is exactly when nobody chose. */
function isTruthy(value: string | undefined | null): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

function readOverride(): string | null {
  try {
    return window.localStorage.getItem(OVERRIDE_KEY);
  } catch {
    // localStorage THROWS (not returns null) in Safari private mode and
    // wherever site data is blocked. A flag read must never take down a
    // render — see the same guard in LanguageContext.
    return null;
  }
}

export function isProviderOnboardingV2Enabled(): boolean {
  if (typeof window !== 'undefined') {
    const override = readOverride();
    // An explicit override wins in BOTH directions, so a browser can opt out
    // of a flag that is on for the deployment as well as into one that is off.
    if (override !== null && override.trim() !== '') return isTruthy(override);
  }
  return isTruthy(import.meta.env.VITE_PROVIDER_ONBOARDING_V2 as string | undefined);
}

/** Exported for tests and for a future settings toggle. */
export const PROVIDER_ONBOARDING_V2_OVERRIDE_KEY = OVERRIDE_KEY;
