# Provider evidence and review lifecycle repair

## Scope and baseline

Repository: `baraabd/homeservicemarketplace`. Baseline: `develop` at
`460b9eefd8e0eafc5f4aad65a2c03c3ef102ca30`. Branch:
`fix/provider-review-evidence-lifecycle`. The latest `develop` update
`e1f7f5148c72743542ac6fab23b02646ef20573e` was integrated safely
before final acceptance; its messaging tests and browser gate are preserved.

Backend work uses Integration and Bug-Fix Mode; the provider dossier uses scoped
UX/UI Redesign Mode under the current repository design policy. No unrelated
customer, payments, or payout work is included. No pull-request merge into `develop`, deployment, live
provider decision, permission grant, destructive migration, or storage cleanup
is authorized by this repair.

The seven supplied screenshots are evidence of the user's starting interface.
They are not evidence that every stored object exists, that malware scanning is
configured, or that the user's Windows runtime is using this exact commit.

## Root causes and UX gap matrix

| Area                        | Finding                                                                                                                                       | Repair / intended behavior                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application state           | `NOT_SUBMITTED` was added whenever status was not `PENDING_REVIEW`, including returned submissions with a recorded submission date.           | The blocker means no submission exists. A real but nonpending review receives `REVIEW_NOT_PENDING`; a decided submission retains its decision blocker.                                                                                            |
| Identity resumption         | `createOrResume` loaded scalar case columns; the safe view serializer returned an empty evidence list and no latest decision.                 | Reuse the complete safe case projection so uploaded documents and correction reasons survive resumption.                                                                                                                                          |
| Identity readiness          | Final application review checked CLEAN/current/uploaded evidence but omitted erasure and retention boundaries checked by identity decisions.  | One predicate checks current document, kind/category, expiry, restricted visibility, completed upload, scan verdict, retention and erasure across both decision paths.                                                                            |
| Missing identity object     | CLEAN database metadata alone could authorize a decision even after the actual stored object was lost.                                        | Bounded storage HEAD checks required immutable object length before either approval path; a server-only fingerprint is rechecked inside the decision transaction. Storage I/O never holds decision row locks. Replay does not read storage again. |
| Identity upload concurrency | A second slow PUT admitted before finalization could overwrite the first file after it was scanned CLEAN.                                     | Conditionally claim one content hash and publish restricted bytes with atomic create-if-absent. A losing or failed retry cannot overwrite or erase finalized evidence.                                                                            |
| Existing-object retry       | A legacy or stale restricted object of the same length could be adopted as an identical retry without comparing its actual SHA-256.           | Bounded byte/hash verification proves identical contents; first finalization also refuses mismatched bytes. Preserve existing objects on every failure.                                                                                           |
| Identity projection         | The standalone case projection could offer reads/approval that the protected reader would refuse, including missing evidence-view permission. | Use fresh reviewer permissions and the existing audited reader's access policy; require matching current eligible evidence before offering approval.                                                                                              |
| Historical identity         | Replaced documents were mixed with current evidence and retained pending-style labels.                                                        | Current evidence comes first; historical replacements are disclosed separately. Retained readable versions remain securely inspectable but cannot satisfy current requirements.                                                                   |
| Scan copy                   | `PENDING` malware scan looked like pending human review.                                                                                      | Separate safety-check state from case/application review state and explain why opening is unavailable.                                                                                                                                            |
| Metadata                    | A missing filename/date/category reused generic “Not added” copy.                                                                             | Acknowledge an existing upload and name the missing metadata precisely.                                                                                                                                                                           |
| Portfolio attachment        | Expired, retired or erasing reservations could be attached while cleanup was eligible to remove their bytes.                                  | Reject those reservations both before inspection and at conditional claim; persist detected MIME.                                                                                                                                                 |
| Portfolio capacity          | Count and append position were read before the creation transaction.                                                                          | Recheck capacity and position under serializable isolation; concurrent conflicts require retry.                                                                                                                                                   |
| Portfolio read              | The read projection omitted completed-upload and retirement/erasure fences; storage failures lacked a bounded service response.               | Read only finalized, live, eligible media and return a safe availability failure.                                                                                                                                                                 |
| Portfolio approval          | Moderation could publish an item whose stored image was missing or failed byte validation.                                                    | Read the bounded immutable object and fully decode its pixels before new attachment and approval, outside the transaction; repeat permission/self/revision/DB checks inside the atomic decision. No approval for unreadable media.                |
| Transient portfolio storage | Stream failures and read deadlines were classified like invalid or permanently missing images.                                                | Keep transport/dependency failures retryable as safe HTTP 503; reserve invalid/missing-image recovery for validated permanent evidence failures.                                                                                                  |
| Portfolio state             | Broken assets were conflated with legacy migration requirements.                                                                              | Add server-owned `MEDIA_UNAVAILABLE`, retain the distinct S3 migration gate, and permit a reasoned rejection/correction when appropriate.                                                                                                         |
| Image decoding              | Receiving an allowed MIME blob enabled decisions before the browser decoded the image.                                                        | Enable approval only after the exact current preview loads successfully. Failed decoding offers retry and replacement/rejection recovery.                                                                                                         |
| Dossier hierarchy           | Historical submission portfolio metadata preceded current actionable image moderation.                                                        | Present current moderation first and disclose the immutable historical snapshot separately.                                                                                                                                                       |
| Decision summary            | A correction-only state could show a generic Ready indicator.                                                                                 | Ready requires the server-advertised approval action.                                                                                                                                                                                             |
| Identity approval errors    | Missing physical evidence and unfinished checks returned HTTP 409, but both approval dialogs displayed a generic revision-conflict message.   | Allowlisted domain reasons explain replacement, current evidence readiness, or a changed preflight in AR/EN. Unknown conflicts retain safe existing copy; notes and refresh requirements are preserved.                                           |
| Test scanner wait           | The browser helper accepted any `CLEAN` string, including an old replaced document.                                                           | Wait for all current nonsuperseded documents to be CLEAN before proceeding.                                                                                                                                                                       |
| Responsive task labels      | Viewport-based three-column tabs split English words when the dossier shared a 1024px viewport with the navigation and decision rail.         | Size the task grid from its actual container width, preserve word boundaries, and measure rendered word lines across EN/AR, light/dark and all six supported widths.                                                                              |

## Security and state ownership

“Private/protected” is a privacy property, not an access-denied state. Authorized
identity inspection keeps the existing audited private byte endpoint and
retention boundaries. Portfolio previews keep authenticated mediated delivery,
no public/signed GET fallback, no-store responses, and disposable object URLs.
Unscanned/quarantined/deleted/erasing evidence is never exposed or accepted to
make a workflow appear green.

Portfolio decoding uses pinned `sharp@0.35.5`, at most 10 MiB encoded bytes,
16 million aggregate decoded pixels and four channels. Storage reads have a
five-second deadline and native decoding has a three-second budget. Valid
legacy GIFs remain supported by moderation; new upload format rules remain
JPEG/PNG/WebP. Decoder unavailability is a dependency failure, not an assertion
that the provider supplied an invalid image. No decoded output is persisted.

Identity collision recovery and first finalization incrementally verify the
actual SHA-256 and exact byte count under a five-second storage budget.
This proves byte identity, not full PDF/image decoding or human legibility.
Identity approval still uses current CLEAN metadata and immutable-object HEAD
availability, with current database fences checked inside the decision.

The backend owns permissions, eligibility, available actions, review revision,
moderation, verification, and work access. UI labels organize those facts;
they do not invent an approval policy. Portfolio is optional for application
submission. Application acceptance and portfolio publication remain distinct.

Approval remains the existing atomic application/identity/work-grant operation.
Returning a request sends a provider-visible correction message through the
existing transaction, audit, notification and outbox path. Private reviewer
notes are not substituted for provider instructions.

## Acceptance matrix

| Scenario                                                  | Expected result                                                                                                                                                            | Evidence layer                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| First current identity upload and submission              | CLEAN evidence opens privately; current application can be reviewed.                                                                                                       | Real API/browser plus existing audited-read integration              |
| Identity correction, two replacements, resubmission       | Same open correction case; one current document; retained previous records; new application submission and revision.                                                       | New real API/browser lifecycle                                       |
| Resume a case containing evidence and a reason            | Evidence and latest decision remain present.                                                                                                                               | Service regression and real DB integration                           |
| Allowlisted identity approval conflicts                   | Missing object, unfinished checks and changed preflight display safe actionable AR/EN explanations; drafts stay intact and unknown reasons disclose no raw server message. | Web/API reason and decision regressions                              |
| Current document pending/failed/quarantined scan          | No unsafe read or approval; visible reason and correction path.                                                                                                            | Predicate/projection unit matrix and existing protected reader tests |
| Missing/truncated physical identity object                | Both standalone identity approval and final application/work approval refuse the decision without writing a grant. Rejection/correction still works.                       | New availability, command and real local-object/DB regression        |
| Two overlapping identity PUTs, finalization, CLEAN scan   | A late PUT never changes the accepted object/hash/scan state or deletes the first writer's evidence. Identical prefinalization retries are safe.                           | Upload race and restricted adapter regressions                       |
| Existing same-size identity bytes differ from claimed SHA | Failed upload does not adopt or delete the old object, and direct first finalization cannot attach mismatched bytes.                                                       | Upload collision and finalize regressions                            |
| Expired document/retention, erasing/deleted media         | No readiness or approve action; decision fails without changing accepted state/work grant.                                                                                 | New unit and real DB regression                                      |
| Terminal EXPIRED case renewal                             | Create a new DRAFT case; subsequent resume selects it. Old idempotency receipts remain old receipts.                                                                       | Existing renewal integration plus new service regression             |
| Anonymous or another provider reads identity/portfolio    | Request refused, no storage key or signed object credential disclosed.                                                                                                     | New real HTTP/browser-run case                                       |
| Owner/admin opens pending or rejected portfolio           | Eligible stored bytes remain privately readable; public publication requires APPROVED.                                                                                     | Unit and real DB HTTP integration                                    |
| Missing/corrupt portfolio bytes                           | Approval refused; visible retry/replacement or reasoned rejection.                                                                                                         | Unit, real DB HTTP, and fixture browser recovery tests               |
| Transient portfolio read/deadline                         | Upload and moderation return safe retryable 503, preserving the review reason and avoiding a permanent unavailable verdict.                                                | Validator/service regressions and existing preview retry UI tests    |
| Expired/retired upload attaches                           | Claim refused and no new portfolio item persists.                                                                                                                          | Reservation regression and real DB HTTP                              |
| Concurrent uploads at final slot                          | Capacity is preserved; losing transaction conflicts.                                                                                                                       | New real DB concurrency regression                                   |
| Provider edits during reviewer inspection                 | Old revision conflicts; current image remains pending; reason retained; refresh available; immutable snapshot unchanged.                                                   | New real API/browser lifecycle                                       |
| Final approval after correction                           | Application accepted, identity verified, work grant active and operational capability usable.                                                                              | New real API/browser lifecycle plus existing atomic integration      |
| Returned/accepted/nonpending application                  | Accurate state and blockers; no false “not submitted” message.                                                                                                             | Unit/API projection and web copy                                     |
| AR/RTL and EN/LTR, mobile/tablet/desktop                  | Current evidence and next actions are reachable, no clipping, keyboard focus retained, accessibility checks pass.                                                          | Existing real rendered-screen matrix plus new lifecycle captures     |

## Operational findings that code cannot silently repair

1. The ordinary example configuration selects `EVIDENCE_SCANNER_DRIVER=none`
   and disables the scan worker. This intentionally leaves identity uploads
   pending. The existing local launcher starts a real ClamAV and scan worker:
   `node --env-file=.env scripts/dev/review-runtime.cjs`. It requires the normal
   local PostgreSQL/Redis/Mailpit stack and preserves `.env` and storage roots.
   The deterministic test scanner is CI-only evidence, not malware detection.
2. A database row is not the stored image. A Docker volume and a native API's
   local storage directory may contain different bytes. The correct original
   mapping/backup must be restored or a replacement requested; no arbitrary
   directory search, public fallback, or fabricated upload is added.
3. Legacy S3 `portfolio/` objects need the existing private-staging migration
   and CDN invalidation. `MEDIA_MIGRATION_REQUIRED` remains distinct from a
   missing image. This repair does not migrate live buckets or purge caches.
4. EXPIRED cases are intentionally absent from the default active identity
   queue. A screenshot showing an expired dossier and no active cases is not
   sufficient proof of queue corruption. A new renewal creates a new case.
5. The supplied account's actual database, storage roots, scanner health and
   running Windows build have not been accessed by this authoring workspace.
   Synthetic persisted-data acceptance does not certify those live objects.
6. Upload immutability is repaired, but abandoned-upload cleanup still lacks
   a durable shared lease with in-flight storage promotion. The new request
   checks retirement after promotion and compensates only its own created
   object. A process crash before that compensation can still leave private
   orphan bytes after a cleanup receipt. Database retirement fences keep them
   unreadable and ineligible for approval; crash-safe physical erasure needs
   separate durable coordination/reconciliation and is not certified here.

## Verification record

Local authoring validation uses Node 24.19.0 with pnpm 10.32.1. The repository
requires Node 24.21.0; the downloaded exact binary was unstable in this
authoring runtime, so these results do not certify the required Node release.
Remote CI uses the exact repository pin. No runtime declaration was weakened.

Before publishing, affected scoped suites passed: 164 dossier UI tests,
267 identity/review API tests and 69 portfolio/media tests. A whole Web run
passed 2375 tests across 189 files; Web typecheck, E2E typecheck and build
passed. Web lint reports 34 existing warnings and no errors after removing
an unused test import. API typecheck/build passed; a whole API run passed
4006 tests with 1390 explicitly gated tests skipped because local database/
Redis services were absent. Additional immutable-upload tests are validated
with 48 passing tests across five scoped suites and the final source checks.
The dependency audit reports zero findings.

The collision/finalize follow-up passed 96 scoped tests across six executed
suites; 42 evidence-upload database cases remained explicitly gated locally.
That set includes a new real-HTTP regression proving a rejected stale-object
PUT cannot be finalized into a document. Those database cases require the
final exact-head service job; gated tests are not counted as passing.

The transient-storage follow-up passed 101 tests across six scoped suites,
covering validator/callers and local/S3 adapter failure classification.
Full API TypeScript and scoped lint/format checks passed. Invalid/missing
images remain separate from retryable outages, and failed approval writes
no moderation state, transaction or audit decision.

The full real-browser gate also exposed shared fixture login-budget leakage:
independent suites reused one loopback IP and the later login received 429.
A guarded disposable-CI helper expires only Redis rate counters between
suite commands. Sessions, OTPs, queues and database state stay intact;
production thresholds and all in-scenario limiter assertions remain active.
The same boundary isolation applies to the R17 two-instance browser gate brought in by the latest `develop` merge; that upstream
gate and all its assertions remain enabled.

A broad replay exposed an existing provider-profile test race: the service
catalog and saved skill selection arrive independently, but the assertion
waited only for the catalog. The same selection assertions now await the
saved selection; the 31-test file and the 2375-test Web replay passed. No
production profile behavior or expected selection was weakened. The added
approval-error copy has 14 AR/EN regressions, including unknown unsafe reasons.

Local PostgreSQL installation cannot perform its required UID/group changes
in this workspace, and Chromium download repeatedly returned truncated
archives. Real HTTP/PostgreSQL/browser/visual acceptance is therefore delegated
to the existing required CI jobs, not replaced with stub-only evidence.
The complete Admin evidence archive is retained. An additional small archive
contains ten existing synthetic identity/portfolio/application screenshots,
including AR/EN, mobile/desktop and light/dark samples, for visual inspection
by clients with bounded transfer sizes. It contains no logs, traces or auth
material and does not replace the full browser evidence or any test gate.
Final-head results and inspected screenshots are recorded in the delivered
acceptance report. Authored or skipped tests are not passing tests, and
baseline results are not reused as evidence for the repair commit.

After integrating the latest `develop` and the two follow-up fixes, the
full local API replay passed 4054 tests with 1396 service-gated cases skipped
(223 passing suites, 64 gated suites). Full Web passed 2376 tests across
189 files. An initial authoring command omitted the documented CI stub
environment, causing three API suites to fail during environment validation
before their cases ran; supplying the same nonsecret placeholder variables
as CI resolved that setup failure without a source change. Web production
build likewise requires an explicit `VITE_API_URL`; the missing-value guard
was retained and the validation build uses the documented local CI value.
These local checks still use Node 24.19.0, not the required CI pin.

CodeQL retains its generated SARIF as a separate diagnostic artifact so
security alerts can be inspected through the supported evidence transfer
path. Its queries, analysis, upload and official security-result gate remain
unchanged; a successful Actions job is not a successful security verdict.

The diagnostic artifact identified `js/insecure-temporary-file` in the local
storage test fixture: its timestamp-derived shared temporary root was
predictable. Each test now owns a private unique directory returned by
`mkdtemp`, and cleanup uses only that returned directory. All 27 adapter
tests, scoped lint and formatting passed; production storage behavior and
security queries are unchanged. Final acceptance requires a fresh official
CodeQL result with zero new-alert annotations. An unchanged baseline
`js/user-controlled-bypass` result in the provider category update path is
separate from that pull-request verdict; this repair does not claim that
the entire repository has no security findings.

## Rollout and rollback

No database schema migration is introduced. Deploy compatible API/contracts/web
artifacts together after required final-head checks. The additive blocker and
portfolio unavailable reason require the compatible client. Retain existing
verification enforcement, private staging, scanner and storage mappings.

Rollback reverts the scoped code together while preserving uploaded objects,
audit/history, decisions and work grants. Never roll back to a public media
fallback or clear scan state merely to regain availability. Merging and live
deployment remain separate from this implementation.
