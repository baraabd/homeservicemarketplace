# R18 — Owner decision packet

Prepared on 2026-10-11 against `develop@ffe9a398c777a892ba1227989a84c2a60fe8a041`.
Every item below is a **proposal**. None is approved business policy until the
owner's answer is recorded in the "Decision" line, with its date. No newer
approved decision for any of them was found in the repository
(`r16/PAYOUT_POLICY.md`, `r17/R17_C_*`, `r17/R17_D_ADMIN_POLICY.md`,
`r17/R17_E_PROVIDER_POLICY.md`, ADR 0013 were re-read).

## D-2 — Money unit, currencies, rounding and display

**Facts** (source inventory, read-only):

- `Bid.amount` and `Booking.priceAmount` are `Int` with a `currency TEXT`
  column defaulting to `USD`. They have no unit column and no CHECK constraint.
  Accepting a bid copies its amount and currency into the booking
  (`bids.service.ts:193-203`).
- The only producer of bids is the provider bid form, which sends **whole
  units**: `LiveJobsScreen.tsx:112` (`Math.round(parseFloat(price))`), input
  `max=999`, label "USD/hr". This has been unchanged since the bootstrap
  commit `493e36c` (2026-03-15). The DTO and contracts describe the same
  field as "cents-equivalent" (`submit-bid.dto.ts:11`,
  `submit-bid.request.ts:11`).
- Bid, booking, job-detail, My Bids and provider booking screens show the
  integer as is (`formatOffer`, `booking-copy.ts:150-162`). Since 2026-05-02
  the wallet (`WalletScreen.tsx:61,103,238`), admin financials
  (`FinancialsSection.tsx:38`) and the dashboard
  (`DashboardOverview.tsx:92,126,293`) divide it by 100 and round to whole
  units. A 150 USD bid is shown as "150 USD" on the bid card and as "$2" in
  the wallet and admin pages.
- The wallet and financials aggregates sum across currencies and label the
  total with the most frequent one (`booking.repository.ts:269-320`,
  `admin-financials.service.ts:84-99`). Only admin analytics groups by
  currency and returns `null` for a mixed total.
- `admin-financials.service.ts:111-114` and
  `provider-earnings.service.ts:145-148` still compute a 10 % fee
  (`PROVIDER_PLATFORM_FEE_BPS`), although analytics and the contracts say no
  fee is approved.
- The R15 ledger is bigint minor units with per-entry currency, but nothing
  posts to it. There is no currency allowlist anywhere, and every bid and
  booking currency is the column default.
- **Provenance.** Stored rows cannot tell their unit. Every row written
  through the web UI is whole units (at most 999). Rows written by direct
  API clients could be either. No seed creates bids or bookings.

**Recommendation.**

- Declare `Bid.amount` and `Booking.priceAmount` **whole major units of the
  row's currency**, matching the only producer. Make no data conversion.
- Change the wallet, admin financials and dashboard to stop dividing by 100.
  Group every aggregate by currency and never sum across currencies.
- Remove the fee computation from the financials and earnings read models
  until a fee is approved.
- Allow only `USD` for launch, as an explicit allowlist validated on bid
  submission, and reject any other currency.
- Leave conversion into ledger minor units (×10^exponent per ISO 4217) as
  a later, explicit step when ledger posting is approved.

**Alternatives.**

| Option                                         | Effect                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Whole units, as recommended                | no data change; fixes the wallet and admin pages; sub-unit prices (e.g. 35.50) stay impossible                                                                                  |
| (b) Minor units everywhere                     | change the bid form to ×100 and every whole-unit display to ÷100, and migrate existing rows ×100 — **only** with provenance for each row, which does not exist; not recommended |
| (c) Add a `amountScale` column, then (b) later | migration adds the column defaulting to 0 (whole units) for existing rows; new rows can carry 2; displays read the scale; more work, keeps both paths honest                    |

**Data and migration.** Option (a) needs no migration and no backfill. A
blanket ×100 or ÷100 migration is unsafe: provenance is missing.

**Acceptance examples.**

- A 150 USD bid shows 150 USD on the bid card, the booking, the wallet, the
  admin financials and the dashboard.
- A EUR booking next to a USD booking produces two totals, never one.
- No screen shows a fee, and a bid in a currency outside the allowlist is
  refused with 400.

**Decision:** _pending owner_.

## D-3 — Dispute intake and workflow policy

**Facts.**

- There are two policy keys:
  - `disputes.self_service.intake`: `enabled`, `pilotUserIds` (1–500),
    `allowedBookingStates` ⊆ SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED, and
    `terminalWindowHours` (1–2160).
  - `disputes.workflow.v1`: appeal 24–2160 h, request 1–720 h,
    proposal 1–720 h, resolution 24–2160 h, plus retention periods.
- Neither key is seeded. Without a valid policy, intake answers 404/409 and
  the workspace is closed. Both keys are set through
  `PUT /v1/admin/settings/:key`, which is validated, history-logged and
  audited, but **there is no admin UI for them**.
- The terminal window is measured from the `BookingEvent` that completed or
  cancelled the booking, never from `updatedAt`. Each case freezes its policy
  revision.
- The worker runs only when `DISPUTE_WORKER_MODE` is set (off, shadow or
  enforce). Enforce requires `DISPUTE_WORKER_APPROVAL_REF` and
  `DISPUTE_WORKER_INFRA_REF`. `DISPUTE_WORKER_ENABLED` is declared but
  **read by nothing**, so the manifest's earlier reference to it was wrong.
- `VITE_DISPUTE_INTAKE_V1` only hides the entry link. The API enforces the
  pilot cohort.

**Recommendation.**

- Launch with intake **closed** to the public and a **pilot** for named
  internal accounts only (`pilotUserIds`). Allowed states: COMPLETED and
  CANCELLED. Terminal window: 168 h (7 days).
- Workflow: request 72 h, proposal 72 h, appeal 168 h, resolution 336 h
  (14 days). Retention: the R17-C defaults.
- Run the worker in `shadow` on staging, then `enforce` only after its
  approval and infrastructure references exist. Keep `VITE_DISPUTE_INTAKE_V1`
  false in the public build until the pilot is reviewed.
- Every value above is a proposal. The numbers must come from the owner's
  support capacity.

**Alternatives.** (a) No disputes at launch: keep both keys unset. This is
honest and fail-closed, and support handles complaints through tickets
(R13). (b) Public intake from day one: needs staffed resolution targets.

**Data and migration.** None. A policy is one audited settings write.
Removing it closes intake again, while open cases keep their frozen policy.

**Acceptance examples.**

- With the policy unset, `POST` intake returns 404 and the participant view
  says intake is closed.
- With a 168 h window, a booking completed at T can be disputed at T+167:59,
  and at T+168:00 the request is refused with `WINDOW_ELAPSED`. These are
  already pinned by `dispute-intake.policy.spec.ts:18` and the integration
  boundary suites.
- A non-pilot user is refused while a pilot user is accepted.

**Decision:** _pending owner_.

## D-8 — Minimum active administrators and break-glass

**Done on this branch (safety floor, not policy).** A suspension or lock
can no longer take the **last** administrator in good standing out of
standing. Both routes take one platform-wide transaction lock before the
row lock, so two admins suspending each other cannot both succeed: the
second receives 409 (`admin-users.service.ts`, unit tests, and
`r18-admin-floor.integration.spec.ts` on real PostgreSQL). Operator admin
grants are now audited (`ROLE_ASSIGNED`, actor `operator-cli:grant-admin`),
and admin-access approvals now record the reviewer.

**Facts.**

- No HTTP route removes a role, revokes a permission or deletes a user. The
  repository methods exist but have no callers.
- Dispute permissions (`dispute:*`) have no grant or revoke API at all.
- `grant:admin` refuses production unless `ALLOW_PROD_GRANT=true`. With
  `--create-if-missing` it creates a passwordless, verified, ACTIVE account
  that signs in through password reset.

**Recommendation.**

- Minimum **two** active administrators before public launch. The floor
  stays at one, enforced in code; two is an operating rule checked at
  gate C.
- Break-glass: `grant:admin` with `ALLOW_PROD_GRANT=true`, run by the named
  operator from a host with database access. Before running it, record a
  ticket reference. Afterwards, the ROLE_ASSIGNED audit row is reviewed and
  the access is either kept through an AdminAccessRequest or removed within
  24 h.
- The `ALLOW_PROD_GRANT` value lives only in the operator's session, never in
  a deployed environment.

**Alternatives.** (a) Raise the coded floor to two. This adds an
availability risk: if only two admins exist, neither can be suspended. (b)
Keep one, with no operating rule.

**Acceptance examples.**

- With admins A and B, A suspends B (200), then B's session is revoked and
  any further suspension of A is refused (409).
- A break-glass grant produces exactly one ROLE_ASSIGNED row naming the CLI.

**Decision:** _pending owner_ (minimum count, break-glass owner and
review window).

## D-13 — Custom-text (uncategorised) requests

**Facts.**

- A request without a category is stored with `categoryId = NULL`. Fan-out
  logs `request.fanout.skipped_uncategorised` and notifies nobody, and no
  provider feed, detail or bid route can see it (pinned by
  `r17-provider-surfaces.integration.spec.ts:385`).
- There is no admin triage or categorisation route.
- A seeker update that adds a category makes the request visible in feeds,
  because they read the live row, but it is never announced.

**Done on this branch (honest expectation, not policy).**

- The success step no longer promises "bids within 15–30 minutes" or "average
  response under an hour" for any request.
- A custom-text request is labelled "Saved · not shown to providers yet",
  and the seeker is told how to reach providers: post under a listed
  service.
- Arabic and English copy updated; unit tests cover both paths.

**Recommendation.**

- For launch, **limit intake**: the free-text entry (search Enter, "General")
  routes the seeker to pick a listed service, offering the closest categories
  by name. Keep the custom-text path closed until matching exists.
- After launch, add admin triage that sets a category and announces the
  request once.

**Alternatives.** (a) Keep custom-text intake with the honest label only;
this is safe, but it is a dead end for the seeker. (b) Broadcast custom text
to every provider in the area: rejected (spam, false expectations).

**Data and migration.** None for the limit. Existing uncategorised rows stay
invisible until triaged or re-posted.

**Acceptance examples.**

- The free-text search proposes categories and never creates an
  uncategorised request.
- An existing uncategorised request appears in no provider feed and is
  labelled as not shown.

**Decision:** _pending owner_.

## D-19 — Production `WORK_ACCESS_ENFORCED` and `VERIFICATION_ENFORCED`

**Facts.**

- Both flags default to false. With them off, any provider whose profile
  status is ACTIVE can work. Legacy `/approve` activates providers **without**
  a work-access grant. Only verification-case approval writes a grant.
- The Sprint 9 migration backfilled grants and checked the count once, at
  deploy time.
- New on this branch: `pnpm --filter @homeservicemarketplace/database
work-access:readiness` reads the counts again at any time (counts only)
  and exits 1 while a working provider lacks a live grant. `--apply
--limit=N` backfills in bounded, logged, restartable runs, exactly as the
  migration did. It sets no verification and needs
  `ALLOW_PROD_WORK_ACCESS_BACKFILL=true` in production.
- Rehearsal on a freshly migrated and dev-seeded database: 7 working
  providers, 0 live grants, 0 verified. Turning `WORK_ACCESS_ENFORCED` on
  there would deny all 7. Turning `VERIFICATION_ENFORCED` on would also deny
  all 7, even after the backfill, because backfilled grants are truthfully
  UNVERIFIED.
- With `VERIFICATION_ENFORCED`, the hardened runtime also requires ClamAV and
  the scan worker.

**Recommendation.**

- For a **new** production database (no legacy providers), enable both
  flags **from the first launch**. Every provider then joins through
  onboarding, verification case and review, which issues the grant.
- Before launch, publish a real verification policy through the audited
  admin surface; the dev placeholder is never seeded in production.
- For an **upgraded** database with existing providers, follow these steps:
  1. Take a backup.
  2. Run `work-access:readiness`.
  3. Run `--apply` in bounded batches until it is ready.
  4. Run the readiness check again and record the counts.
  5. Enable `WORK_ACCESS_ENFORCED`.
  6. Enable `VERIFICATION_ENFORCED` only after the owner accepts that
     UNVERIFIED providers lose work until they verify.
- Rollback for either flag: set it false and restart. No data is deleted.

**Alternatives.** (a) Launch with both off: providers approved by the
legacy path work unverified, which contradicts the release scope's
"verified, access-granted providers". (b) `WORK_ACCESS_ENFORCED` on and
`VERIFICATION_ENFORCED` off: grants gate work, but identity is not required.

**Acceptance examples.**

- With both flags on, a provider with no grant sees the onboarding/status
  centre and cannot see the feed, bid or bookings.
- A provider with an expired grant (`expiresAt` in the past) is denied from
  the next request onward.
- Setting both flags false restores the legacy rule with no data change.
- These are pinned by `provider-capability.service.spec.ts` and the Phase 3
  journey suites, flag on and flag off.

**Decision:** _pending owner_.

## Security and governance

| Item                                                                             | Recommendation                                                                                                                                                                                                                                                       | Decision  |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| CodeQL #2 high `js/xss-through-dom` (`JobWizardModal.tsx:913`)                   | dismiss as **false positive**: the only writer is `URL.createObjectURL(file)` for a file the user picked; source/sink analysis in `SECURITY_ACCEPTANCE.md`. Owner performs the dismissal in GitHub                                                                   | _pending_ |
| CodeQL #20 medium `js/http-to-file-access` (`local-disk-storage.adapter.ts:145`) | accept as **used in development only**: production refuses `STORAGE_DRIVER` other than `s3` (`runtime-policy.ts:124`); the PUT is HMAC-signed, size- and type-checked, path-contained and write-once for attachments                                                 | _pending_ |
| CodeQL #16 medium (`.github/scripts/pr-acceptance.mjs:194`)                      | accept as **CI tooling**: writes a GitHub API snapshot to a `0600` file chosen by the workflow; not shipped                                                                                                                                                          | _pending_ |
| CodeQL #13 medium (`apps/web/e2e/assets/vendor-prototype-assets.mjs:91`)         | accept as **test tooling**: refuses bytes that differ from pinned SHA-256 hashes; not shipped                                                                                                                                                                        | _pending_ |
| Branch protection on `develop` (payload in `BRANCH_PROTECTION_EVIDENCE.md`)      | apply with `required_approving_review_count: 0` (single maintainer; a review requirement would block the owner's own merges), `enforce_admins: true`, the observed check names including `Real Seeker Provider Admin startup`; the owner applies it or authorizes it | _pending_ |
| GitHub secret scanning and Dependabot alerts (both disabled)                     | enable both; gitleaks and the dependency audit keep running in CI either way                                                                                                                                                                                         | _pending_ |

## Hosting, registry and budgets

- **Target.** `infra/production/STAGING.md` defines the operator launcher:
  one Docker host, a local daemon, an existing external network, an HTTPS
  edge, and existing PostgreSQL, Redis, S3-compatible storage, SMTP and
  ClamAV. No vendor, account or registry is named anywhere in the
  repository. The Vercel integration last deployed on 2026-04-23 and is
  disabled (`git.deploymentEnabled: false`).
- **Needed from the owner:**
  - the staging host;
  - the registry;
  - the two HTTPS origins;
  - the managed database, with separate migration and application roles,
    TLS `sslmode=require&sslaccept=strict`;
  - the Redis, storage buckets, SMTP sender and ClamAV endpoints;
  - who operates them;
  - the monthly budget.
- **Performance thresholds (proposal).** These come from the PR #154 lab
  medians:
  - Cold mobile content-ready is about 4.7–5.1 s and warm about 2.3–2.5 s,
    on 4× CPU, 150 ms latency and 1.6 Mbps.
  - Proposed lab budget: cold mobile ≤ 5.5 s and warm ≤ 3.0 s per role, with
    no more than a 10 % regression against the previous release median.
  - Hosted API: p95 ≤ 500 ms for reads and ≤ 1000 ms for writes at the
    owner's launch load, with an error rate below 0.5 %.
  - These are **proposals**. The launch load (concurrent users and requests
    per second) must come from the owner.
