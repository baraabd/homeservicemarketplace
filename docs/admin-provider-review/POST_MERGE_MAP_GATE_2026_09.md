# Post-merge map gate — isolated test-observation correction

During the requested verification after #88/#89, develop CI run `35434163048`
(at `7390cfd89b4dadc4d9c648e071fc27710031770e`) finished with 14 successful jobs,
one failed Provider real-route job and its failed aggregate gate. The real Admin
review job succeeded. In the failing Provider job, the first 26 real-API and
persistence tests passed; the repairs group had seven passes and one failure.

The failure was `toBeGreaterThan(beforePinch)` with expected `> NaN` and actual
`16`. The downloaded artifact `10581422657` was verified against its upload digest:
`a5c77e4245e8aefb55abc5bce7d3a1ccde36350cdbd3f48400089c2fd03ea584`.
The failure PNG was visually inspected. The trace records the baseline read
`call@90` returning NaN, zoom-14 tile nodes around that read, and real zoom-16 tile
requests/nodes following the gesture. This is evidence of an invalid test baseline,
not evidence that the gesture failed. It does not certify all map behavior.

The test took a new unguarded baseline read after an earlier readiness poll. Its
`Math.max` over every image URL could be poisoned by one nonnumeric/retired source.
Leaflet 1.9.4 TileLayer replaces retired sources with `Util.emptyImageUrl` before
removing them; the exact transient source was not retained in the failed trace.

The isolated test-only repair reads actual HTTP(S) z/x/y PNG tile sources, ignores
non-tile/retired sources, and returns NaN (never zero) when no valid sample exists.
The baseline is the exact sample that passed the zoom-14 readiness assertion,
not another read afterwards. The original real multi-touch gesture and strict
post-gesture increase assertion remain. A before/after observation is attached.
Nine helper regressions cover valid/overlapping levels, data-image retirement,
malformed/empty observations and unchanged versus genuinely increased zoom.

No application map code, external tile requests, real API endpoints, expected
pinch result, timeout, retry budget, workflow, dependency or skip is changed.
A single retry of the original failed develop jobs was requested after diagnosis
to distinguish the intermittent observation failure from a merge regression.
Any retry success is reported as such; it does not put this durable repair on
develop. The correction remains separately reviewable in the new draft PR.

Local evidence: the helper was transpiled with available TypeScript 5.8.3 and
passed 11 standalone Node assertions. This is not a local Vitest/browser pass.
Required remote final-SHA evidence is recorded in the PR verification comment.
