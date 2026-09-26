# S07 — resilient work-area location boundary

Base: `66e336cb4823802aabacc536584972aa43056d23`. Final head and checks live in the PR body. Owned scope: work-area geolocation and shared reverse-geocoder parsing; coordinated with S05, which does not edit this helper. No market/radius eligibility, timezone authority, API/Prisma schema, approved map layout, flags or dependencies changed.

## Repairs

The device-position helper previously handed impossible/non-finite coordinates straight to map rendering and autosave. It now rejects those as unavailable while preserving the existing permission-denied, cancel, timeout and manual-entry paths. No latitude/longitude is invented, clamped or silently saved.

The reverse-geocoder cast arbitrary JSON to an interface and then read body.error/display_name without validating it. JSON null threw instead of returning the promised typed fallback; numeric/object city fields could reach city.trim() in the work-area screen. A shared pure parser now validates record/string shapes, ignores non-string locality components and selects the first nonempty locality. Missing components remain empty, never fabricated from coordinate strings. Network/JSON warnings no longer log raw vendor errors that may contain precise-location request URLs.

## Evidence and preserved behavior

New parser/wrapper and coordinate regressions cover null/array/primitive payloads, malformed address components, city fallback, NaN/infinite/out-of-range positions and valid geographic boundaries. Local pure parser/helper assertions and syntax transpilation were executed; mock-fetch/device unit tests prove boundary behavior only, not a real geocoder or map deployment.

Existing map implementation retains pan, touch/keyboard zoom, draggable/selectable pin, use-map-centre fallback, wheel-zoom disabled to avoid scroll trapping, and persisted server-authoritative coordinates. Existing location tests cover denial, stale requests and saved values. Final-head browser/real-DB/service-area/geo matching and 360/390px Arabic/English/RTL evidence must still be checked. Public map/geocoder uptime, production operator identity/rate policy, privacy disclosure and realistic geo-query plans remain deployment/acceptance work; none is silently certified by these unit tests.

Rollback: revert these isolated helper/parser changes. No persisted representation or migration to undo. No merge or deployment.
