# G2 coordinator ownership

## Authority and source

The repository owner requested G2 SHA ownership and the Wave 2 closeout record on
2026-10-17. This is delegated coordination, not authorization to merge, deploy,
spend, grant permissions, activate live money or waive a failed requirement.

Single writer: this G2 coordinator session for baraabd.
Branch: `coord/g2-wave2-closeout`.
Inspection/publication parent: `4e87bf03663fb3c72ffee983fdb70c2863e1ce8a`.
Candidate tree: `eaca9cdeab15e719570f7997c4fc3bbeb64e562e`.
This candidate is not an accepted Wave 3 execution base.

This checkpoint precedes substantive edits. No other G2 branch was found during
ownership inspection. Recheck the remote head before every publication; use only
normal fast-forward updates guarded by the expected head. No other worktree,
stash, branch, registry entry, runtime module or infrastructure resource is leased.

## Exact allowlist and shared-file lease

The coordinator exclusively reserves these 15 files for the closeout record,
conditional next-wave preparation and fail-closed record tests:

```text
.github/scripts/g2-record.mjs
.github/scripts/g2-record.test.mjs
docs/production-readiness/post-r18/ACTIVE_STATUS.md
docs/production-readiness/post-r18/waves/WAVE_02.md
docs/production-readiness/post-r18/waves/wave-02.closeout.json
docs/production-readiness/post-r18/waves/wave-03.plan.json
docs/production-readiness/post-r18/gates/g2/OWNERSHIP.md
docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json
docs/production-readiness/post-r18/gates/g2/IMPLEMENTATION.md
docs/production-readiness/post-r18/gates/g2/ACCEPTANCE.md
docs/production-readiness/post-r18/gates/g2/BLOCKERS.md
docs/production-readiness/post-r18/gates/g2/RISKS.md
docs/production-readiness/post-r18/gates/g2/ROLLBACK.md
docs/production-readiness/post-r18/gates/g2/evidence/r25-summary.json
docs/production-readiness/post-r18/gates/g2/shared-change-requests/CR-001-publication.md
```

The two new governance scripts and two existing status documents are explicitly
leased shared files. Existing workflow discovery runs `*.test.mjs`; no workflow,
existing assertion, timeout, scan policy, dependency or lockfile edit is allowed.
The status documents retain the historical G1 start authorization and identify
current closeout separately. `SPRINT_REGISTRY.json` remains the sprint authority;
this closeout is gate evidence, not a replacement registry. Its synchronized
lifecycle/publication transition is specified in CR-001, not silently applied.

Expiry: this coordination PR closes, a successor coordinator explicitly accepts
handoff, or the repository owner revokes the lease. The receiving coordinator
must verify current paths and active writers before reassignment.

## Next-wave ownership is conditional

Only the supplied full R29 prompt supports an exact R29 preparation allowlist.
The Wave 3 plan records it as a conditional reservation, effective only after
accepted G2 source, verified merged publication and a current non-overlapping
lane ownership manifest. Missing peer packages stay unassigned, never invented.
No R29 runtime branch is created and no lane is authorized to start by this
checkpoint. Shared money wiring, raw-body parsing, SDK/API pins and schema changes
still require separate serialized leases. Live rails remain disabled.
