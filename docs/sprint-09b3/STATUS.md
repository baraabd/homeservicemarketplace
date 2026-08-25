# Sprint 9B.3 — restricted evidence upload: STATUS

Resume point for a new session. Updated at every milestone.

## Branch

- `feat/sprint-09b3-restricted-evidence-upload`, created from `309ddf7`.
- Base: `a51b1a6` (PR #42 squash-merge of 9B.2 into `develop`).
- The older `feat/sprint-09b-provider-verification-experience` remote ref still
  points at the pre-merge `e0e0697` and is deliberately NOT force-updated.
- Four user stashes untouched throughout.

## Milestones

### M1 — restricted storage abstraction + read-path repair — DONE

The Sprint 9A restricted read injected `LocalDiskStorageAdapter` and called
`absolutePathForKey()`. That has no meaning under `STORAGE_DRIVER=s3`, so
restricted evidence reads were broken in every production configuration, and no
test noticed because every test ran on the local backend.

Added `RestrictedObjectStoragePort` — a SECOND, narrow port, not more methods on
`StoragePort`:

|                        | `StoragePort`                         | `RestrictedObjectStoragePort` |
| ---------------------- | ------------------------------------- | ----------------------------- |
| Shape                  | browser-direct URLs (`presignUpload`) | server-side bytes only        |
| Returns a URL          | always                                | **never — no method can**     |
| Public routes may call | yes                                   | no                            |

Keeping them apart is structural: a public controller cannot leak a signed URL
for evidence because no method exists that could produce one.

Operations: `putObjectFromFile`, `openReadStream`, `head`, `deleteObject`.
`putObjectFromFile` takes a PATH, not a Buffer, so a maximum-sized upload never
becomes a maximum-sized allocation per concurrent request.

Both backends selected by the SAME `STORAGE_DRIVER`, so public media and
passports cannot end up on different infrastructures.

Two defects were found by the shared contract suite itself:

1. local `head()` swallowed invalid-key errors and answered `null`, making a
   traversal attempt indistinguishable from "not found" while S3 rejected it;
2. `S3RestrictedStorageAdapter` let raw SDK errors escape — they carry the
   bucket name and can echo credentials. All S3 calls now route through
   `guarded()` and collapse to one opaque `restricted-storage-unavailable`.

Files:

- `apps/api/src/infrastructure/storage/restricted-object-storage.port.ts` (new)
- `apps/api/src/infrastructure/storage/local-disk-restricted-storage.adapter.ts` (new)
- `apps/api/src/infrastructure/storage/s3-restricted-storage.adapter.ts` (new)
- `apps/api/src/infrastructure/storage/restricted-object-storage.contract.spec.ts` (new)
- `apps/api/src/infrastructure/storage/storage.module.ts` (binds the new token)
- `apps/api/src/config/env.schema.ts` (`RESTRICTED_STORAGE_DIR`, `S3_RESTRICTED_BUCKET`)
- `apps/api/src/modules/provider/verification/media/evidence-read.controller.ts` (migrated)

Tests: 25 contract tests, run twice over (local, s3-compatible fake), plus an
architecture guardrail that fails if any file under `provider/verification`
imports `LocalDiskStorageAdapter` again.

Verified: `app-module-di` + `restricted-media-boundary` + all evidence suites =
7 suites / 120 tests green after the migration.

### Scan-state decision — ACCEPTED AND TEST-LINKED

Initial state for a newly uploaded, unscanned object is **`PENDING`**, not
`QUARANTINED`.

| State         | Meaning here                                                  |
| ------------- | ------------------------------------------------------------- |
| `PENDING`     | no scanner verdict yet. Unreadable.                           |
| `CLEAN`       | the ONLY readable state                                       |
| `QUARANTINED` | failed scanning; retained as attack evidence (longest window) |
| `SCAN_FAILED` | scanner infrastructure failed                                 |

Marking an unscanned file `QUARANTINED` would fabricate a verdict nobody
reached and hold an innocent provider's passport under the malware retention
policy. `PENDING` already delivers the guarantee: `evidence-read.policy.ts`
denies anything whose state is not exactly `CLEAN`.

Test-linked: `evidence-upload-policy.spec.ts` pins
`INITIAL_EVIDENCE_SCAN_STATE === 'PENDING'` and `!== 'QUARANTINED'`.

### M0 — carried in from the previous session — DONE

- `8d379bb` evidence limits through `ADMIN_SETTINGS_SCHEMA` (7 tests)
- `309ddf7` pure prepare/finalize policy (31 tests)

## Remaining work

- M2 upload contracts + module wiring
- M3 prepare / content PUT / finalize services and routes
- M4 cleanup + compensation for expired and failed preparations
- M5 integration, HTTP-boundary and privacy/log regressions
- M6 documentation, full local gates, push, Draft PR, CI loop

## Blockers

None.
