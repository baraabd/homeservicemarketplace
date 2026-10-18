# PR 179 / 180 repair checkpoint — 2026-10-18

This is source/provenance and integration evidence, not G2 acceptance, a merge or a deployment. The owner's PR-repair authorization covers this identical checkpoint in both branches. No application, workflow, threshold or gate record changes accompany it.

## Exact published source verified

| PR | Published implementation head | Recomputed source tree | Verified tracked blobs | Governance artifact |
| --- | --- | --- | --- | --- |
| 179 | f66fbe4a089dc2cc7f33333c0f8da60d7accdfac | 7bdee64c7eaf49470d3feb5d31380bbcf931afd7 | 2599 | 12142488023 |
| 180 | 71036c39d8ca02b064450dc293dabd0bbe452171 | 1217ce8900aebd21759fe57f03c4d56b0730c2f7 | 2622 | 12142053881 |

Both artifacts were downloaded from successful exact-head Production governance runs (39143681904 and 39143389481). Their ZIP SHA256 values are respectively `1c7e60a5d2d64a16970918394d497ec2c65d480e0560f7212bfbe0349ef333de` and `6f714704c032d2c2b0937ce9143de20805db58a9c9552e44595176da3a620614`. Inner source archive digests, every tracked Git blob, and both complete tree IDs were independently recomputed. No credential or environment file was copied.

On those exact sources, local Node22.16.0 built-in regressions passed: PR180 governance339/339; PR179 governance218/218; PR179 platform and staging439/439. All had zero failed/skipped/cancelled/todo tests. The current G2 consistency CLI passes and its R32 readiness CLI still exits1. Full application tests require the pinned GitHub runners; local logic tests are not a substitute.

Official GitHub Advanced Security CodeQL checks117723571350 (PR179) and117722653816 (PR180) succeeded with zero new-alert annotations on the implementation heads. This does not assert no historical branch alerts or waive other release gates.

## Local three-way merge rehearsal

Using common base6e13120f140e973e793e9e1a7e76170dcb1850a0 and verified source trees, a local-only `git merge-tree --write-tree` rehearsal produced zero conflicts and tree415b8a305c682514dc3ddeb30cbfd16b22533e82. The only file beyond PR180's tree is PR179's repair note. Synthetic local commit objects were used solely to supply that common ancestor; no remote PR was merged. Functional overlap is byte-identical. Recheck after any future source/base changes.

## Immutable metadata-event boundary

Publishing a commit before updating its PR body's Final SHA created one stale-metadata event per implementation head. Their later edited-event runs above passed, but one retry of the original events confirmed GitHub retained the original body snapshot: only metadata binding still failed; source tests passed. Retrying cannot repair that immutable event. No validator was weakened and no run history was deleted.

The successor containing this checkpoint is prepared first, its exact Final SHA is set in PR metadata, then its branch is moved using an expected-head lease. All required checks must run again on that successor. Any pending/cancelled/failed earlier run remains historical and is not represented as final-source success. Final technical evidence belongs in the PR acceptance comment, separately from these source checkpoints.

## Unchanged holds

G2 BLOCKED and Wave3 BLOCKED; R27 owner-proposed budget decisions unresolved; R28 CONFIGURATION_ONLY / HOSTED_ENVIRONMENT_BLOCKED; R16/R18 and live-money holds preserved. No permission grant, spend, secret change, database reset, deployment or merge authorization is implied by this document.
