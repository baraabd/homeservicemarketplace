# R18 — Blockers and open decisions

Base: `develop@fabeb0765689131025208f8dca2e7a4fae924118` (R18 baseline,
`GO_NO_GO.md`). Every row cites its source. A decision is not resolved
because the sprint that recorded it merged, and R18 resolves none of them.

Classification:

- **RELEASE_BLOCKER**: first release should not ship until it is closed.
- **POST_LAUNCH_DECISION**: the current behavior is safe, honest and fails
  closed; the decision changes product policy later.
- **INTENTIONALLY_DISABLED**: the capability is off on purpose and is shown
  honestly.
- **RESOLVED**: closed with evidence.

Whether a POST_LAUNCH_DECISION may wait is itself the owner's call. R18
records the engineering view: what the code does today and whether it is safe.

## 1. Engineering and release blockers

Read from GitHub on 2026-10-10 against `fabeb07`.

| ID     | Blocker                                                                                    | Evidence                                                                                                          | Class                       | Closure                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| R18-G1 | `develop` has no branch protection and no rulesets                                         | `GET /branches/develop/protection` → 404 "Branch not protected"; `GET /rulesets` → `[]`                           | P1 RELEASE_BLOCKER          | `RELEASE_BLOCKER_BRANCH_PROTECTION`; payload in `BRANCH_PROTECTION_EVIDENCE.md`, applied by the owner   |
| R18-S1 | CodeQL #3 critical `js/type-confusion-through-parameter-tampering`                         | fixed by #150 (`31d73a0`); GitHub marks the alert `fixed` at 2026-10-10T17:58:58Z                                 | RESOLVED                    | —                                                                                                       |
| R18-S2 | CodeQL #2 high `js/xss-through-dom` (`JobWizardModal.tsx:913`)                             | open on develop                                                                                                   | P1 RELEASE_BLOCKER          | evidence in § 3; the owner dismisses it as a false positive or asks for a code change                   |
| R18-F1 | E-18: My Bids read only its first page                                                     | #149 merged as `fabeb07`; the E-18 step (7 cases, fail-closed) passed in the post-merge CI run 38076416877        | RESOLVED                    | —                                                                                                       |
| R18-F2 | Provider wallet and admin financials show an unapproved fee, a "balance" and "Refunds: $0" | reproduced from source on `fabeb07`                                                                               | P1 RELEASE_BLOCKER          | prerequisite PR #152 (Draft), then refresh R18 on its merge                                             |
| R18-H1 | No hosted staging or production target                                                     | GitHub environment `staging` has no secrets, variables or protection rules; the repository has no Actions secrets | P1 RELEASE_BLOCKER (launch) | `HOSTED_ENVIRONMENT_BLOCKED`: the owner supplies an authorized target (`infra/production/STAGING.md`)   |
| R18-O1 | No executed backup restore, rollback rehearsal or alert test                               | depends on R18-H1                                                                                                 | P1 RELEASE_BLOCKER (launch) | `BACKUP_RESTORE_EVIDENCE.md`, `ROLLBACK_RUNBOOK.md`                                                     |
| R18-O2 | GitHub secret scanning is disabled for the repository                                      | `GET /secret-scanning/alerts` → "Secret scanning is disabled on this repository."                                 | P2                          | gitleaks runs on history and on the exact tracked tree in CI; the owner may also enable GitHub scanning |
| R18-O3 | No build SHA or version is exposed by the API                                              | `/health/live` and `/health/ready` report health only                                                             | P2                          | `OBSERVABILITY_AND_ALERTS.md`                                                                           |

## 2. Open product decisions

| ID   | Decision                                                                                             | Source                            | Today's behavior                                                                                                                                                                                                                                                          | Class                  |
| ---- | ---------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| D-1  | Marketplace-funds model, payout rail, funding provenance (R16 P1–P5 …)                               | `r16/PAYOUT_POLICY.md`            | no payout, withdrawal, capture, refund or escrow path exists; the wallet's withdraw control is disabled                                                                                                                                                                   | INTENTIONALLY_DISABLED |
| D-2  | Money unit and currency for bid, booking, wallet and admin amounts                                   | R16 P8, R17-D N3, R17-E P18       | amounts are stored and shown with the record's own currency code; no conversion, no fee                                                                                                                                                                                   | RELEASE_BLOCKER        |
| D-3  | Dispute windows: intake, eligible states, appeal, proposal, resolution target                        | R17-C decision 3                  | window settings are unseeded and intake fails closed until they are set (CI arms a pilot cohort)                                                                                                                                                                          | RELEASE_BLOCKER        |
| D-4  | Legacy admin dispute authority (`admin` role vs `dispute:decide`)                                    | R17-C decision 1                  | the legacy ticket path keeps the `admin` role check                                                                                                                                                                                                                       | POST_LAUNCH_DECISION   |
| D-5  | Evidence access vs case assignment                                                                   | R17-C decision 2                  | `dispute:evidence:view` alone grants original-evidence reads (audited)                                                                                                                                                                                                    | POST_LAUNCH_DECISION   |
| D-6  | Database-enforced history immutability                                                               | R17-C decision 4                  | append-only by application code; erasure rewrites cipher columns                                                                                                                                                                                                          | POST_LAUNCH_DECISION   |
| D-7  | Dispute intake-notice opt-out scope                                                                  | R17-C decision 5                  | the counterparty receives the intake notice                                                                                                                                                                                                                               | POST_LAUNCH_DECISION   |
| D-8  | Minimum active admins / break-glass                                                                  | R17-D decision 1                  | a status change can leave no active admin                                                                                                                                                                                                                                 | RELEASE_BLOCKER        |
| D-9  | Suspension reason model                                                                              | R17-D decision 2                  | no reason is stored                                                                                                                                                                                                                                                       | POST_LAUNCH_DECISION   |
| D-10 | Structured-policy write permission                                                                   | R17-D decision 3                  | `admin` role                                                                                                                                                                                                                                                              | POST_LAUNCH_DECISION   |
| D-11 | Inert settings (`platform_fee_bps`, `default_currency`, `support_email`, `feature_show_hourly_rate`) | R17-D decision 4                  | stored, typed, audited; nothing reads them                                                                                                                                                                                                                                | POST_LAUNCH_DECISION   |
| D-12 | Audit read permission                                                                                | R17-D decision 6                  | admin audit list behind the existing admin guard                                                                                                                                                                                                                          | POST_LAUNCH_DECISION   |
| D-13 | Custom-text (uncategorised) request audience                                                         | R17-E decision 1                  | notifies nobody; the feed shows such a request to nobody                                                                                                                                                                                                                  | RELEASE_BLOCKER        |
| D-14 | Pending bids after a capability loss                                                                 | R17-E decision 2                  | kept, not acceptable until authority returns (acceptance re-checks)                                                                                                                                                                                                       | POST_LAUNCH_DECISION   |
| D-15 | Booking obligations after lapsed access or suspension                                                | R17-E decision 3                  | RESTRICTED keeps MANAGE_BOOKINGS; lapsed verification/grant and SUSPENDED lose it                                                                                                                                                                                         | POST_LAUNCH_DECISION   |
| D-16 | Recognition ("Top Pro", bid badges)                                                                  | R17-E decision 4                  | not projected to seekers (`null` / `false`); no product code writes either, only the dev seed (R17-E P16)                                                                                                                                                                 | POST_LAUNCH_DECISION   |
| D-17 | Deactivated category behavior                                                                        | R17-E decision 6                  | the link still applies on every surface; an explicit filter naming it is 400 (P20)                                                                                                                                                                                        | POST_LAUNCH_DECISION   |
| D-18 | Re-announcing a request whose category changed                                                       | R17-E decision 7                  | not re-announced; the feed reads the live row                                                                                                                                                                                                                             | POST_LAUNCH_DECISION   |
| D-19 | Production values of `WORK_ACCESS_ENFORCED` and `VERIFICATION_ENFORCED`                              | ADR 0013; `env.schema.ts:105-117` | both default `false`: approved work access and identity verification gate nothing until enabled; ADR 0013 requires the grant backfill and a matching live-grant count before the flip. CI enables both only in the admin review job and the production-smoke Compose file | RELEASE_BLOCKER        |

Why D-2, D-3, D-8, D-13 and D-19 are marked RELEASE_BLOCKER (D-19: the release scope promises verified, access-granted providers, which holds only with both flags on): each leaves an
in-scope journey either unusable in production (D-3: disputes cannot be opened
until the windows exist; D-13: a seeker can post a request nobody can see) or able to
mislead (D-2: the unit of every displayed amount; D-8: an admin can lock the
platform out). The others fail closed or keep a documented, honest default.

## 3. CodeQL #2 — evidence for a disposition

`JobWizardModal.tsx:913` renders `<img src={item.previewUrl}>` (and `<video>`
at 901). `previewUrl` is assigned only at line 235, `URL.createObjectURL(file)`,
for a `File` the user picked in their own browser; it is revoked at 402, 417
and 726. A `blob:` URL is minted by the browser for that document's origin. It
cannot be a `javascript:` URL, and an `<img>`/`<video>` `src` does not execute
script. No server or other user supplies the value. The finding is a false
positive on that basis. Dismissing it in GitHub is an owner action, not done
here.

## 4. Release-governance controls

See `BRANCH_PROTECTION_EVIDENCE.md` for the exact check names read from
GitHub and the payload. Functional acceptance does not close this risk.
