# S08 — authoritative working-hours validation

Base: `66e336cb4823802aabacc536584972aa43056d23`. Final head/checks are recorded in the PR. No schema, contract, dependency, flag, shared route, S06 hub or S07 work-area edits.

## Implementation

The existing weekly model supports seven local days, multiple minute intervals, exclusive end 1440, explicit IANA timezone, bounded array length, whole-week replacement and optimistic draft revision checks. Empty days mean closed; an empty week is valid data but incomplete onboarding. Overnight work is represented as two intervals on adjacent days, never as a wrapping interval. These semantics are preserved.

Fixed a proven diagnostic gap: the overlap sweep compared only neighbouring start-sorted intervals. A long interval containing two separated shorter intervals reported only the first later conflict. The week was already rejected, so this was not an authorization or invalid-schedule acceptance bypass. Keeping the farthest-reaching prior interval now reports every offending later row with a real original-index witness. Added symmetric minute bounds so invalid negative ends/oversized starts are classified as bounds errors before ordering.

## Tests and existing evidence

New regression covers nested intervals, original input indices, non-mutation, touching boundaries, midnight splits, malformed minutes and 3000 deterministic generated weeks against an independent quadratic oracle. The pure validator was transpiled and the property checks executed locally; this is not a claim of local Jest, Nest, PostgreSQL or browser execution.

Existing availability-schedule.integration.spec.ts covers real PostgreSQL replace/split/clear, timezone, read-after-write, stale revision and two concurrent writers with one success/one conflict. Existing weekly-schedule and AvailabilityTaskScreen tests cover bulk application/summary behavior; baseline real-persistence evidence includes intervals surviving reload, fresh login and a direct DB read. Final-head CI must rerun these suites; old baseline results alone do not close this PR.

## Remaining closure

The UI mirror and server accept/reject the same valid/invalid interval sets; this change strengthens server diagnostic completeness, not an approved-UX redesign. Full 360px/Arabic/English/RTL save feedback and relogin coverage must be confirmed from final-head artifacts. A claim that every availability operation is production-certified requires those actual runs, not this source audit. No future blackout/booking feature is enabled or promised.

Rollback: revert validator/test changes. Stored schedule representation is unchanged; no data migration or reset. No merge/deployment performed.
