# K10 — Release and cutover package (template, not executable yet)

Status: **TEMPLATE**. Every `<…>` field must be filled from accepted evidence
before this package can be offered for a go decision. An unfilled field
blocks the package. It never defaults.

## 1. Release identity (must be frozen first)

| Field                       | Value                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Joined candidate source SHA | `<sha>` (coordinator join of reviewed R34–R37 plus K01–K09)                          |
| Candidate tree              | `<tree>`                                                                             |
| API image digest            | `<registry>/<api>@sha256:<…>`                                                        |
| Web image/build identity    | `<…>`                                                                                |
| Worker image digest(s)      | outbox, mail dispatcher: `<…>`                                                       |
| Migrator image digest       | `<…>`                                                                                |
| Migration head              | `<name>`. Source base today: `20261024120000_g3_financial_integration`               |
| Feature flags (prod values) | `<flag=value list>`, including `WORK_ACCESS_ENFORCED` and payment mode               |
| Payment/merchant mode       | `SANDBOX` until G-22 is authorized                                                   |
| Rollback images             | previous accepted API/web/worker digests: `<…>`. **None exists today**: first launch |
| Pre-cutover backup          | `<backup id, time, verified restore reference>`                                      |

## 2. Roles and window

| Role                        | Name      |
| --------------------------- | --------- |
| Release operator            | `<name>`  |
| Rollback authority          | `<name>`  |
| Database owner              | `<name>`  |
| On-call (primary/secondary) | `<names>` |
| Support owner               | `<name>`  |
| Business go/no-go approver  | `<name>`  |

Maintenance/canary window: `<date, time, Asia/Riyadh>`. Avoid prayer and peak
local hours, per the owner's choice.

## 3. Sequence

Each step is gated on the previous step's check.

1. **Pre-flight.** Run `GO_NO_GO.md` at version N with all non-policy rows PASS
   on this candidate. Confirm the owner decisions are recorded. Run
   `validate-plan.cjs --check … --require-target --expected-plan-sha <reviewed>`.
2. **Backup.** Take a full backup. Verify a restore to an isolated target
   (R36 procedure). Record the RPO point.
3. **Migrate.** Run the authorized one-shot migrator digest once with the
   migration role.
   - Expect: `prisma migrate status` clean at the expected head.
   - Expect: the application role has no DDL rights (R28 #181 boundary).
4. **Deploy.** Deploy API, workers and web by digest.
   - Expect: `/health/live` and `/health/ready` are 200.
   - Expect: runtime identity equals the frozen SHA/digests (`check-runtime.cjs`).
5. **Edge/DNS.** Apply the approved records (DOMAIN_EDGE_MAIL_PLAN §3). Run
   the §4 edge checks.
6. **Synthetic smoke.** Use isolated synthetic accounts and owner-designated
   mailboxes only:
   - signup, email OTP, login/refresh/logout;
   - customer request → provider bid → booking lifecycle to completion (no
     money capture);
   - provider onboarding upload with a scanner verdict, and restricted-media
     negative access;
   - admin review and moderation;
   - realtime event delivery;
   - required financial/SAR reports via `verify-report.cjs`;
   - mail headers pass.
7. **Cohort.** Open to the approved limited Saudi cohort `<cities/audience>`.
   The mechanism must be server-side. A client flag never grants access.
8. **Observe** (§4), then the owner acceptance decision.

**Point of no return:** step 3, once any forward migration has been applied
**and** real user writes exist. Before real writes, abandon by restoring the
step-2 backup. After them, use forward repair only. There is no automatic down
migration, and legacy money values are never reinterpreted.

## 4. Observation proposal (to approve; not measured)

Proposed duration: 24–72 h. Thresholds are the proposals in
`r18/OWNER_DECISIONS.md` until the owner sets launch load.

| Indicator                 | Proposed rollback/forward-repair trigger                                          |
| ------------------------- | --------------------------------------------------------------------------------- |
| API 5xx rate              | > 0.5 % over 10 min                                                               |
| API p95 latency           | reads > 500 ms, writes > 1000 ms sustained 15 min                                 |
| Outbox / mail queue age   | per `workers/outbox-worker.rules.yml` alerts firing > 15 min                      |
| Mail bounce/complaint     | any DMARC fail or bounce rate > 5 % on auth mail                                  |
| Scanner                   | scan backlog or error alert; any unscanned file reachable                         |
| Storage                   | any restricted-media authorization failure (a security incident, not a threshold) |
| Webhooks / reconciliation | any unreconciled exception (sandbox-only until G-22)                              |

## 5. Rollback

- **Known blocker (R36 CR-001).** `infra/production/staging.cjs` always runs
  `api-migrate` on apply. A migration-free application rollback path does not
  exist yet. It must be delivered and rehearsed by R36/K09 before go.
- On first launch there is no previous release. "Rollback" means:
  - remove the cohort;
  - restore the previous DNS (the custom domain currently serves an older
    `main` Vercel deployment, per PR #204);
  - put the API in maintenance;
  - before real writes, restore the backup.
- After an R36-approved compatible path exists, application rollback means
  redeploying the previous digests without running the migrator.

## 6. Communication drafts (not sent; sending requires authorization)

- **Internal go notice:** candidate SHA, window, operator, rollback authority
  and dashboard links.
- **Cohort invitation (AR/EN):** a limited-availability notice to approved
  cities. It makes no payment claims while in sandbox/non-money mode.
- **Incident/rollback notice (AR/EN):** a short service-interruption notice.
  It contains no internal details.

## 7. Operating handoff (fill after acceptance)

The handoff must record:

- the domain URLs;
- the deployed SHA/digests;
- dashboards (`observability/dashboards/*.json` as imported);
- runbooks (`observability/RUNBOOK.md`, `workers/OUTBOX_PLAYBOOKS.md`);
- support owner;
- first follow-up checks at +1 h, +24 h and +7 d (TLS expiry, DMARC reports,
  backup success, queue health);
- remaining limitations.
