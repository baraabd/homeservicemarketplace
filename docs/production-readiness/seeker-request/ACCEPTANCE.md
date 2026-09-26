# S05 — request-media transport integrity

Base: `66e336cb4823802aabacc536584972aa43056d23`. Final head and checks are in the PR. Status: PARTIAL IMPLEMENTATION, not request/media production closure. This change owns the actual request wizard's upload helper and its validation/regressions; no restricted-evidence, shared storage adapter, schema, contracts, rollout flags or dependency changes.

## Repaired

The previous uploadAll mapped whatever reservations the API returned. If two files were selected and only one reservation returned, one PUT could succeed and the helper returned a one-URL success, allowing request publication with silently missing media. The helper now validates the entire count, shape, URL schemes, expiry and uniqueness before any PUT. File count/type/size are checked against the existing request contract. It returns file URLs only after every required transfer succeeds, in the original order.

A failed PUT now aborts pending peers; callers can cancel a batch and the signal also reaches presign. Signed PUT explicitly omits cookies, refuses redirects and suppresses referrers. Transport exceptions are replaced by safe diagnostics, not raw signed URLs. These changes do not introduce automatic retries, larger test timeouts or a new browser flag.

## Evidence

Executed locally: global-TypeScript transpilation and eight pure batch-policy cases. Added Vitest orchestration tests for missing reservations/no PUT, credential/redirect behavior, peer cancellation, all-file success, invalid files, pre-cancellation and signed-URL error non-disclosure. Controlled fetch/File fixtures are unit evidence only, not a real image/storage/backend journey. Final-head lint/typecheck/Vitest/build/browser/CI/CodeQL results must come from GitHub Actions.

## Critical scope still NOT implemented

The source audit found that request presign lacks a MediaAsset reservation and RequestsService forwards mediaUrls verbatim. This PR does NOT repair that server authority gap. The backend still needs transaction-bound ownership/claim, stored-byte validation, replay/overwrite policy, abandoned-upload cleanup and a real request-to-matching-Provider storage/browser journey. No cleanup reservation was added alone: doing so while request creation still fails to claim it could delete legitimately attached media as abandoned.

Therefore a successful client test or green CI does not close S05. Existing legacy request URLs/read behavior remains unchanged. No migration is created; any required schema work must coordinate with S10. A batch abort cannot remove an object already accepted by storage; cleanup is explicitly a server responsibility, not claimed by this helper.

Rollback: revert the upload helper/policy/tests. No data migration, runtime setting or deployment rollback. No merge/deployment performed.
