# CR-003 — private financial receipt isolation and access

Status: **REQUESTED / UNAPPLIED / G2_BLOCKED**. Runtime: **NOT_IMPLEMENTED**.
Source inspected: `96e92825f9b65cf124317f43b55ce42fc97f5b49`; source tree:
`68f4e926eabeb37bb70382c62b75272cf67bd02c`. The recorded preparation lease covers
this document only. It grants no storage/IAM change, financial permission or
retention decision.

## Reusable authorities and observed boundaries

| Existing source                                                                                                                        | Reuse and limitation                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/infrastructure/storage/restricted-object-storage.port.ts`                                                                | `RESTRICTED_OBJECT_STORAGE` provides create-if-absent `putObjectFromFile`, `head`, `openReadStream` and deletion operations without a URL-returning API. `openReadStream(key, { sizeBytes })` checks length; it does not prove a SHA-256 content match. |
| `apps/api/src/infrastructure/storage/storage.module.ts`                                                                                | Exports the restricted object port for local/S3 selection. Do not create a second storage transport.                                                                                                                                                    |
| `apps/api/src/modules/provider/verification/media/evidence-validation.ts` and `file-signature.ts`                                      | Reuse byte/type/signature validation with explicitly approved receipt limits; do not silently inherit identity-document size or retention policy.                                                                                                       |
| `apps/api/src/modules/provider/verification/media/malware-scanner.port.ts`, `clamav-scanner.adapter.ts` and `scanner-selection.ts`     | Reuse `MALWARE_SCANNER_PORT`, the real ClamAV adapter and the production test-scanner prohibition. `isRealScanner` alone is not runtime evidence: the deterministic test adapter deliberately reports it too.                                           |
| `apps/api/src/modules/provider/verification/provider-verification.module.ts`                                                           | Already exports `MALWARE_SCANNER_PORT`; use that composition authority without recreating the driver selector or attaching receipts to dummy verification cases.                                                                                        |
| `apps/api/src/modules/provider/verification/media/evidence-scan.service.ts`                                                            | `scanPending` currently selects eligible restricted assets without a finance-purpose exclusion, then writes identity audit/outbox semantics. Its conditional state update also needs the purpose guard.                                                 |
| `apps/api/src/modules/provider/verification/media/evidence-cleanup.service.ts`                                                         | `sweepExpiredPreparations` currently selects expired restricted preparations without a purpose guard and calls `deleteObject` before the conditional row update. A guard only on the final update is too late to protect bytes.                         |
| `apps/api/src/modules/provider/verification/media/evidence-keys.ts`                                                                    | `RESTRICTED_NAMESPACES` currently contains only `verification`; public media denial relies on this list.                                                                                                                                                |
| `apps/api/src/modules/iam/authorization/services/permission-resolver.service.ts` and `apps/api/src/modules/iam/audit/audit.service.ts` | Reuse fresh permission resolution and transactional audited reads/state changes, with a dedicated financial capability and allowlisted identifiers. Identity permission is not finance permission.                                                      |

The source IAM template `infra/production/storage/aws/iam-api.json` grants
restricted object actions only under `verification/*`. The source plan and
validator likewise restrict this prefix. This is source evidence, not evidence
of deployed IAM or an available financial storage environment. R20 policy/live
acceptance is not created by adding a proposed finance prefix.

## Exact shared changes requested

| Exact path                                                                       | Minimal semantic patch                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/provider/verification/media/evidence-scan.service.ts`      | Exclude `FINANCIAL_RECEIPT` from identity candidate selection and conditional scan writes. Preserve eligible historical NULL-purpose identity/dispute evidence.                                                         |
| `apps/api/src/modules/provider/verification/media/evidence-scan.service.spec.ts` | Prove financial assets are not read, scanned or mutated by the identity scanner; preserve existing NULL-purpose behavior.                                                                                               |
| `apps/api/src/modules/provider/verification/media/evidence-cleanup.service.ts`   | Exclude financial purpose during selection, recheck before destructive `deleteObject`, and retain the exclusion in conditional mutation. Purpose immutability from CR-002 prevents reassignment races.                  |
| `apps/api/test/integration/evidence-cleanup.integration.spec.ts`                 | Prove financial expired preparations survive identity cleanup in both metadata and storage, including race/stale-candidate cases.                                                                                       |
| `apps/api/test/integration/evidence-scan.integration.spec.ts`                    | Prove financial rows cannot receive identity verdicts/events; legacy eligible rows still scan.                                                                                                                          |
| `apps/api/src/modules/provider/verification/media/evidence-keys.ts`              | Add `finance` to the restricted namespace denial list without changing identity key construction.                                                                                                                       |
| `apps/api/src/modules/provider/verification/media/evidence-keys.spec.ts`         | Cover finance root/prefix, leading slashes and case handling; avoid widening allowed public resolution.                                                                                                                 |
| `apps/api/test/e2e/restricted-media-boundary.e2e.spec.ts`                        | Prove public media serving/upload paths cannot expose or create financial keys, including path variants.                                                                                                                |
| `apps/api/src/modules/iam/audit/audit.service.ts`                                | Add only reviewed R30 identifier keys: `manualReviewId`, `manualDecisionId`, `receiptVersionId`, `manualSettlementId`, `manualRefundOperationId`. Reuse existing actor, payment, refund, policy and reason-code fields. |
| `apps/api/src/modules/iam/audit/audit.service.spec.ts`                           | Prove those identifiers survive and raw receipt bytes, keys, filenames, hashes, references, amounts and free-text notes are omitted.                                                                                    |
| `packages/database/src/seed.ts`                                                  | Add the proposed `money:receipt:read` definition to `UNGRANTED_MONEY_PERMISSIONS` only. Any further approved finance capabilities use that same ungranted list.                                                         |
| `apps/api/test/unit/seed.spec.ts`                                                | Assert registration never grants the new capability through seeded role mappings.                                                                                                                                       |
| `apps/api/test/integration/seed-idempotency.spec.ts`                             | Assert repeated real database seeds preserve zero new user/role grants.                                                                                                                                                 |
| `infra/production/storage/aws/iam-api.json`                                      | Only after owner storage approval, add the narrow receipt-object permissions needed for an approved `finance/receipts/*` prefix. Keep identity-worker authority unchanged; see the gating below.                        |
| `infra/production/storage/storage-plan.json`                                     | Describe that separately approved API-mediated prefix and its policy evidence; retain the blocked baseline until approval.                                                                                              |
| `scripts/production/storage/storage-plan.cjs`                                    | Validate the approved financial-prefix variant explicitly; do not accept arbitrary restricted prefixes.                                                                                                                 |
| `scripts/production/storage/storage-plan.test.cjs`                               | Keep the original deny-by-default fixture and add a distinct approved-finance fixture plus scope/privacy negative tests.                                                                                                |
| `apps/api/test/integration/r20-storage/r20-s3-storage.integration.spec.ts`       | Verify the approved prefix variant under real isolated S3-compatible storage and preserve identity/storage boundary coverage.                                                                                           |

All paths above are existing shared sources and need a new exact serialized
lease. Schema purpose/audit enum additions belong solely to CR-002. The R30-owned
upload/read/scan/key services and their tests appear in `PROPOSED_OWNERSHIP.json`;
they are not shared changes and are not implemented here.

## Required owned receipt pipeline

Reserve an immutable financial purpose, owner and intent association before
accepting bytes. Generate an opaque server key under
`finance/receipts/<opaque-owner>/<asset-id>.<detected-extension>`; no filename,
account reference or caller-supplied path enters the key. Preserve original
bytes under the existing create-if-absent storage boundary. Stream uploads to
bounded private staging, validate MIME/signature/size, hash the original bytes,
finalize once, and scan those same bytes through actual ClamAV. Missing scanner,
failed/truncated read, mismatch or inconclusive verdict cannot produce CLEAN.

Do not decode/re-encode an image before the authoritative scan and claim the
original is clean. A display derivative, if approved, is separate and follows a
successful original-byte scan; it never replaces original evidence. Record the
byte identity and scanner provenance used for inspection. Existing CLEAN or
terminal evidence is not overwritten by a stale scan result.

The financial scanner handles only financial receipts and uses financial audit
semantics. The identity worker exclusion must explicitly retain NULL-purpose
legacy rows; a bare SQL `purpose <> 'FINANCIAL_RECEIPT'` drops NULLs and is not
equivalent. Check both candidate and conditional write predicates, and check the
cleanup guard before any storage side effect.

Receipt reads are authenticated API-mediated operations. Re-resolve active user
status, purpose, ownership or the explicit finance capability, current evidence
availability and erasure/hold fences. An admin role or cached JWT permission
alone is insufficient. Await a privacy-safe audit before disclosure. Use private
no-store caching, `nosniff` and a safe disposition/filename; never return public,
CDN or presigned URLs, storage keys or internal paths. If the read claims byte
identity, verify the stored digest with a bounded read/spool before disclosure;
the storage port's size check alone is insufficient. No storage read, network
scan or preview generation occurs inside the final financial transaction.

`money:receipt:read` is a proposed capability definition, not an account grant.
In the current seed, `ROLE_PERMISSIONS.admin` is derived from `PERMISSIONS`.
Putting a money definition there would automatically grant it. Use
`UNGRANTED_MONEY_PERMISSIONS`; preserve repeated-seed behavior and require separate
owner-authorized account assignment. Existing `money:receipt:review` still needs
fresh authorization for decisions; read access does not authorize approval.

## Storage/retention gate

The future IAM change must specify only approved API operations for the approved
receipt prefix. Upload/read require Put/Get; abandoned-upload compensation or
financial erasure needs a separately approved bounded deletion policy. Do not
silently grant DeleteObject, DeleteObjectVersion or lifecycle expiry for all
finance history just because verification currently has them. If the integrated
pipeline needs cleanup that lacks authority, keep the method disabled and record
that blocker rather than leaving an apparently successful but unrecoverable path.

Both `apps/api/src/infrastructure/storage/local-disk-restricted-storage.adapter.ts`
and `s3-restricted-storage.adapter.ts` currently restrict `eraseObject` to
`verification/`. This request does not widen those erasure implementations or the
identity worker's IAM. A later financial-retention design must cover holds,
primary/versioned objects, staging and backup inventories under its own exact
lease; no retention duration or hosted resource is inferred here.

## Required verification after integration

Run the exact shared regression tests above and the proposed R30 receipt storage,
review lifecycle and concurrency integration suites. Use disposable real
PostgreSQL, private local/S3 storage and real ClamAV with synthetic clean,
malformed, mismatched, truncated and quarantined fixtures. Verify same-size
substitution, immutable replacement, scanner outage, failed finalize, no
cross-owner/admin-without-capability disclosure, revocation between inspection
and approval, no public-key bypass, fresh read audits and no sensitive data in
logs/notifications/outbox. Preserve every existing identity scan/cleanup case.

Contract doubles are component evidence only. No scan, storage/IAM change,
permission assignment, runtime test or hosted/live receipt acceptance occurred
in this preparation. Rollback disables manual receipt routes/processing while
preserving private originals and financial history; it never makes receipts
public or lets identity cleanup claim them.
