# S06 decision B — V2 remains gated pending deployment proof

Base: `66e336cb4823802aabacc536584972aa43056d23`. No deployment flag is enabled or disabled by this sprint. The runtime key is `VITE_PROVIDER_ONBOARDING_V2`; the optional browser escape hatch is `hsm.ff.providerOnboardingV2`. The default remains OFF when neither is configured. The example web env sets true, but an example is not a hosted deployment.

## Why the current evidence does not justify a default cutover

The real persistence suite explicitly sets the browser override in both its initial browser and fresh-login browser. Its route marker nevertheless declared `build-env:VITE_FF_PROVIDER_ONBOARDING_V2`, a nonexistent runtime key, and claimed no override. The six baseline persisted-value comparisons remain useful, but they cannot prove which deployment default served V2. This sprint preserves that supplied declaration for audit and marks the effective source UNVERIFIED instead of publishing a false assertion.

Runtime routing now shares one immutable flag-resolution record containing enabled/source/key. Diagnostic consumers can inspect the exact same resolution rather than independently re-deriving it. This is not a permission check: all server capability and lifecycle gates remain unchanged.

## Promotion requirements

Before any production default change, the release operator and integration owner must record the exact built web SHA/bundle hash and build flag; run real six-step browser/backend/PostgreSQL persistence on that artifact with the browser override absent before and after fresh login; cover all required fields and failed/stale saves; inspect mobile/RTL/accessibility/visual evidence; verify correction/submission/capability behavior; and rehearse rollback to the prior approved artifact/configuration. S07 owns map and S08 owns hours; S06 must validate those integrated changes, not redesign them independently.

The existing browser-override persistence test is NOT silently converted into deployment-default proof. Removing its overrides, collecting observed browser provenance, extending exhaustive field coverage and enforcing that stronger promotion gate remain open implementation/acceptance work. A green route count or successful unit test alone must not authorize deployment. No hosted build was changed.

Rollback retains the server data model and uses the prior approved web artifact/build flag. Because the browser override still exists for the established QA escape hatch, changing the build flag alone is not a universal kill switch for already-overridden browsers. A forced cutover/rollback policy needs explicit product and integration approval; this sprint does not invent one.
