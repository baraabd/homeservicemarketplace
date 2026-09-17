# Provider journey acceptance repairs — 2026-09-17

Mode A: scoped correctness, accessibility and acceptance-harness repairs.

## Baseline and provenance

This branch starts at `ccc4cd4b892b204f4de2860d274bb4d1d0c4affa`, the head
of draft PR #79. It includes that PR's existing location, hours, readiness
and session repairs; those are inherited work, not new changes in this slice.
The new PR targets `develop` so the existing required CI workflows execute.
Neither PR has been merged or deployed by this work.

Baseline CI: run `34976250000`, job `104407938372`. The original real-route
and persistence suites passed 26 tests. The additional repairs suite passed
4 and failed 4. Its traces and screenshots were inspected, rather than
interpreting a green generic browser job as acceptance of the repaired routes.

## Repairs

### Selected specialties never supplied a primary

The real browser trace showed a successful SPECIALTIES PATCH with a PENDING
painting application, but `primarySpecialtyId`, `suggestedTitle` and `headline`
remained null. V2 sends the selected set and has no separate primary picker;
the existing title default only had a suggestion when a primary already existed.

`seedPrimarySpecialty` selects a missing presentation default from the provider's
own active leaf grants or live pending applications, in stable catalogue order.
Its conditional write rechecks the null primary, membership, pending status,
supersession and category eligibility. A concurrent explicit primary wins.
Existing explicit primaries are not replaced. No category approval, role,
verification decision, work-access grant or rollout flag is changed.

The existing defaults service invokes that helper in the same supplied transaction
and uses the existing shared title formatter. Its returned patch includes the
primary and headline, so the wizard's existing post-write projection sees them.
Existing headline provenance and explicit wording remain authoritative.
The real-API tests additionally assert that the newly selected specialty remains
PENDING and is not present in the approved specialty ID set.

### Dark filled-action contrast

White text on the dark theme's light blue accent measured 2.54:1 in the baseline
axe report. Primary and danger buttons now use the existing dark background token
as their dark-theme foreground; disabled states retain the muted foreground.
Light-theme enabled appearance is unchanged. No reference image or global visual
budget was changed. The added Vitest test pins the classes and token contrast.

### Acceptance harness corrections

The Settings locator matched both a profile-menu entry and a permission notice.
It now selects the icon-bearing menu entry and explicitly requires one match;
it does not pick an arbitrary first element or remove the theme acceptance.

The pinch test previously started a touch gesture as soon as higher-zoom tile
URLs appeared. Leaflet ignores touchstart during a zoom animation. The test now
waits for the actual map-pane animation to finish and measures fresh viewport
coordinates after scrolling. Real multi-touch input, the zoom-increase assertion
and persisted-point assertions remain. This is a harness timing repair requiring
confirmation by the full real-API run, not a claim that every device gesture
has already passed. The capture matrix also includes the previously missing
430px width; the repair suite now requests 52 map/hours captures in total.

## Validation performed before publication

The local execution environment could not resolve GitHub for a clone and did not
contain pnpm, PostgreSQL, Redis or Docker. Source was read through the authorized
GitHub connector; baseline evidence was downloaded from its workflow artifact.
No production data or environment was accessed.

On Node 22.16.0:

- `node --test scripts/testing/provider-journey-isolated.test.cjs`: **10 passed**,
  zero failed or skipped. This executes the real helper with recording database
  doubles; it is not PostgreSQL integration or the project's Jest suite.
- All seven changed TS/TSX files transpiled without syntax errors using the
  available TypeScript compiler. This is **not** a project typecheck.
- The isolated script also passed `node --check`.

Standalone Chromium checks used the actual button class output, the baseline
compiled stylesheet and generated utilities for the added variants. Eight
light/dark, primary/danger, normal/hover foreground-background checks passed.
The dark primary normal state measured approximately **7.02:1**. These are
isolated primitive checks, not rendered onboarding-route acceptance or full
accessibility conformance. The project's real-route axe and screenshot checks
remain required.

The permanent additions include 10 Jest cases for the server helper and 5 Vitest
cases for action classes/contrast. Those suites, the full application typechecks,
builds, browser journeys, actual database persistence, security scans, Docker
and final captured-screen review were **not run locally**. Their current results
belong to the PR's final-SHA checks; never reuse the inherited baseline passes
as passes for this branch. Keep the PR draft until those gates and screenshot
review are complete. No tests were skipped or weakened to obtain a pass.

## Reproduction and remaining acceptance

With repository dependencies installed:

```sh
node --test scripts/testing/provider-journey-isolated.test.cjs
```

For full validation, use the repository's existing CI configuration rather than
substituting this isolated script. In particular, retain
`provider-onboarding-repairs.real-api.spec.ts`, the 26 existing real-route and
persistence cases, the admin review tests, the required browser/visual gates,
CodeQL, security scans, integration, Docker cold build and Compose smoke.
Review the resulting EN/AR light/dark map and weekly-hours screenshots and
negative authorization evidence before considering this work accepted.

## Scope not claimed

No universal zero-defect guarantee, production rollout, live scanner acceptance,
phone verification implementation, runtime upgrade, unrelated redesign or
financial/workspace feature implementation is implied. Existing feature-flag
defaults, domain validation, evidence privacy and server-owned authorization
remain unchanged.
