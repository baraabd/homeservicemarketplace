# Sprint 12C — connected dispute workspace

Status: implementation in review; not a production activation or an assertion
that the entire KYC/privacy sprint has passed. Read the exact-SHA PR ledger.

## Design and ownership

The existing intake now optionally hydrates an encrypted, versioned server draft.
The shared `/disputes/:id` workspace lets historical/current booking participants
supply statements and encrypted evidence, respond to timed requests, read a
compound service proposal, consent to its exact version, read an immutable
reasoned decision, ask for independent review, and attest fulfilment. Only an
authorized assigned reviewer closes the case after the review window and guards.
The Admin route is `/admin/disputes/:id`; its inbox preserves legacy tickets as a
separate disclosure instead of silently promoting old role-only permissions.

Cases pin a content-versioned pilot policy. Every mutation uses a booking/case
lock, revision, actor-bound idempotency receipt, durable event, and transactional
Outbox. Original and superseding decisions remain separately identifiable.
Permissions are resolved from current database grants on each reviewer action;
no migration grants these permissions to real accounts. A party cannot review
its own case, and the original decision-maker cannot decide the appeal.

The source-record panel distinguishes booked amounts from payments. Service
commitments, partial remedies and compound terms do not execute money transfers,
account sanctions or automatic booking changes. Each party confirms actual
fulfilment before closure; these are attestations, not proof of payment.

Private drafts, statements, questions, proposal text, rationales, appeal grounds
and evidence bytes use context-bound AES-256-GCM with a versioned keyring. No
key/default credential is seeded. Draft writes serialize and acknowledge the
saved revision; 409s preserve local text and require explicit reconciliation.
Private text is never persisted in local/session browser storage. Unsent modal
text remains memory-only and has a leave confirmation.

Evidence is restricted, type/size/hash checked, encrypted before object storage,
unreadable before a positive scanner verdict, and read only through an audited
API. Original evidence is private to its author and authorized reviewers. An
explicitly reviewed, separately uploaded and scanned PNG derivative can be
shared; browser masks alter exported pixels, not just CSS. Erasure records a
fence before I/O and certifies completion only after primary object/versions
absence. Transient failures retain provenance and converge on bounded retries.

The independent `dist/dispute-maintenance.worker.js` owns expiration, scan and
erasure queues. It is disabled by default; shadow mode only reads counts.
Enforcement requires configured keys/scanner/storage and explicit policy/infra
references. These references are inputs, not Product/Security/Privacy approval.

## UI system

Common case tokens, badges, dates, errors, modal focus management and logical
RTL properties are reused. Components own one concern: requests/replies,
evidence upload/view/redaction, proposals/decisions, timeline, command forms,
server drafts and Admin queue. Server-projected actions drive affordances; the
client is not a second authorization/state-machine authority.

Unknown/loading/failure/expired/blocked states remain distinct. No success is
shown for a mutation or upload until acknowledged. The command modal captures
its reviewed revision and retains the same intent after an uncertain response.
Notifications contain neutral text and canonical case links; preferences affect
notifications, not durable access to records.

## Acceptance and provenance

Local Node 20.20.2, pnpm 10.32.1, real PostgreSQL 16 and restricted filesystem were
restored from verified tracked-source/frozen-dependency archives. The development
snapshot incorporates develop `1311b5a` without discarding its migration repair,
provider fixes or stronger dependency-audit gate. The isolated Git history is
not a full clone and its local commit IDs are not GitHub source SHAs.

Local checks completed before first publication: API/web TypeScript, scoped
backend/frontend ESLint, 18 targeted integration/crypto tests, two actual
AppModule dependency-graph tests, and a real password/OTP-cookie HTTP flow that
asserts CSRF denial, ownership, encrypted draft reload, acknowledged intake,
immutable decision replay and logout invalidation. The integration fixture uses
synthetic accounts and the documented test scanner unless ClamAV is explicitly
selected. This is not production evidence or malware-detection certification.

The new required CI job runs the real-AppModule browser journey against Postgres,
Redis and ClamAV. OTPs travel only over the test process's private IPC channel
from the normal test mail adapter; there is no debug HTTP route or auth override.
The browser captures EN/AR widths 320/390/430/768/1024/1440 from real case data and
runs axe. The local managed Chromium refused localhost navigation with
ERR_BLOCKED_BY_ADMINISTRATOR; that restriction was not disabled/bypassed. Browser
success and visual acceptance must come from the CI results, not a local claim.

## Release constraints

This increment does not establish production backup/replica expiry, physical
sector erasure, restore suppression, account-wide erasure, or orphan/temporary
KYC-object inventory. These remain explicit privacy work, not assumptions.
Manual screen-reader/usability acceptance and installation/observation of workers
and alerts in an approved environment remain separate. See 12B's runbook for its
finalized-evidence scope. Neither code nor a green test substitutes for required
Product, Security and Privacy decisions. Rollout stays default-closed.
