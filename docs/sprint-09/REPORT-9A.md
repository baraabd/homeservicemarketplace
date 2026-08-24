# Sprint 9A — report

Branch `feat/sprint-09-provider-verification-access`, cut from `develop` at
`207dc1b`. Not pushed, no PR opened.

## Why 9A and 9B

The brief allowed splitting if only one delivery lane was available. One was, so
the work is split — and the split line was chosen so that **9A changes no
production behaviour on its own**:

- Both rollout flags default **off**, and off reproduces the pre-Sprint-9 rule
  exactly.
- Both migrations are additive; the backfill grants access to providers who
  already had it and takes nothing away.

9A is therefore independently mergeable and independently revertible. 9B is the
lane that turns evidence into a thing a reviewer can see and act on.

|                      | Lane                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **9A — delivered**   | Threat model + 5 ADRs. Full data model and forward-only migrations. Backfill, count-verified. Capability ranks 6 and 7 armed behind flags. One admin transition table, server-owned. Regression suite.                                                                                                                    |
| **9B — not started** | Restricted media pipeline (magic bytes, scanner port, short-lived reads, IDOR, access audit). Policy resolver and case service. Admin queue/detail with the evidence tabs and the six reviewer actions. Atomic approval → grant → outbox. Redacted preview + rate limiting. Portfolio. EN/AR/RTL UX. Playwright journeys. |

## Threat model — before and after

Full table in `THREAT-MODEL.md`. Movement in 9A:

| #        | Threat                                           | Before                                                                 | After 9A                                                                            |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| T4       | Provider works with no identity check            | **Open.** Legacy `status = ACTIVE` was the whole gate; ranks 6–7 inert | **Closed, flag-gated.** Both ranks armed; backfill landed first                     |
| T3       | Unverified provider reads customer addresses     | Open by construction                                                   | **Unchanged** — no preview exists yet; 9B                                           |
| T1/T2/T9 | Evidence exposure, malicious upload, PII in logs | Open                                                                   | **Modelled and scheduled.** Schema supports them; pipeline is 9B                    |
| D-3      | Admin UI offers a transition the backend forbids | **Open, confirmed**                                                    | **Closed.** One table, server-owned                                                 |
| T6       | Two reviewers, two decisions                     | Partly closed                                                          | Unchanged — `decideIfInStatus` still the conditional write; case-level races are 9B |

## Storage and authorization design

Recorded in ADR 0009 (restricted media), 0011 (redacted preview), 0013
(capability transition). The load-bearing decisions:

- Media is a **row**, not a URL. A URL cannot carry a scan state, hash, owner or
  retention date, so "restricted" had nowhere to live.
- `RESTRICTED` is **not** a synonym for `PRIVATE`. Private is owner-controlled;
  restricted is reviewer-gated, short-lived and audited.
- Evidence gets its own namespace the public route cannot resolve — enforced by
  config **and** by code, because one is the control and the other catches the
  misconfiguration.
- The preview will be a **separate query with its own select**, so redaction is
  structural. `distanceKm` is excluded: a provider who moves their own
  service-area centre trilaterates the customer's address in three reads.

## Retention decisions

ADR 0012. Bytes and findings have different lifetimes, so they are different
rows: evidence is deleted on a per-outcome schedule, the decision is permanent
and content-free, and the `sha256` survives the bytes.

| Trigger         | Default | Reasoning                                                      |
| --------------- | ------- | -------------------------------------------------------------- |
| VERIFIED        | 90 d    | Decision made; only the appeal window justifies holding at all |
| REJECTED        | 30 d    | Strongest claim to erasure, weakest reason to keep             |
| Abandoned draft | 30 d    | Never submitted, never reviewed                                |
| QUARANTINED     | 180 d   | **Longest.** Destroying malware destroys the incident record   |

These are engineering defaults chosen to be conservative-short. **They are not
legal advice** and are listed as an outstanding legal decision below.

## State and capability matrix

Sprint 9 adds two ranks to the ADR 0005 precedence table. First-deny-wins is
unchanged, and rank 0 still outranks everything.

| Rank  | Rule                              | 9A status                                                          |
| ----- | --------------------------------- | ------------------------------------------------------------------ |
| 0     | Account eligibility               | Unchanged, absolute, re-tested against a VERIFIED+granted provider |
| 1–5   | Profile, standing, onboarding     | Unchanged                                                          |
| **6** | Verification required and not met | **Armed** behind `VERIFICATION_ENFORCED`                           |
| **7** | No live work-access grant         | **Armed** behind `WORK_ACCESS_ENFORCED`                            |
| 8     | Subscription / recognition        | Still never grants, never denies                                   |

Both new ranks deny **work only**: `COMPLETE_ONBOARDING`, `VIEW_OWN_PROFILE` and
`APPEAL_DECISION` survive, because a denial with no route out is a support ticket
rather than an authorization decision.

`verificationState = NULL` counts as unverified. That is not defensive coding:
the seven ACTIVE providers in the local database carry NULL because the Sprint 7
axis backfill never reached them.

## Migrations

Both forward-only. `grep` for `DROP TABLE|DROP COLUMN|TRUNCATE|SET NOT NULL`
returns nothing.

1. **`20260824084629`** — 8 enums, 7 tables, plus `source` and `caseId` on the
   existing grant. Additive.
2. **`20260824084700`** — the backfill, and it runs **second on purpose**. ADR
   0005 names the reverse order as the way to lock out the entire supply side.
   Writes `DataRemediationLog` before the change, then ends in a `DO` block that
   `RAISE`s unless every working provider holds a live grant — so a partial
   backfill aborts the deploy instead of being discovered by a provider who
   cannot work.

Applied to the local database: **7 working providers, 7 live grants, 7
`LEGACY_BACKFILL` rows, 7 remediation rows.**

`grantedAt`/`expiresAt` were **not** renamed to `startsAt`/`endsAt`. They already
are those: ADR 0005 documents the access predicate on exactly these names and the
authorization index leads with them. The mapping is recorded in the schema.

## API and UI changes

- `AdminProviderSummary.availableActions` — the server now tells the client which
  actions are legal. Optional, and absent degrades to **nothing** offered.
- `ADMIN_PROVIDER_TRANSITIONS` exported from contracts, `Object.freeze`d.
- `VerificationSection.tsx` renders server-supplied actions and owns no rule.
- No new routes. No design drift: no spacing, colour, typography or component
  rewrites.

## Tests

| Suite                     | Result                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| API full                  | **1666 passed**, 0 failed (10 DB/Redis-gated suites skipped as designed) |
| Web full                  | **661 passed**, **1 failed** — the 9B criterion                          |
| New: capability ranks 6/7 | Cross-product in **both** flag positions, incl. rank-0 supremacy         |
| New: transition table     | Full status × action cross-product, round-trip property, immutability    |
| New: Sprint 9 regression  | 16 assertions, red at branch open, now green except the 9B one           |

**The one failing test is deliberate**: `renders real evidence rather than a
documents placeholder`. The reviewer's panel is still `<DocumentsPlaceholder />`.
It is the executable acceptance criterion for 9B and was not removed to make a
gate green.

### Security results

- Ranks 6/7 deny-by-default; a capability omitted from the rules is denied.
- Denial reasons remain policy-free stable codes; a test asserts no date appears
  anywhere in the payload.
- `ADMIN_PROVIDER_TRANSITIONS` immutability assertion **failed when first
  written** — `as const` is erased at compile time. Now frozen, arrays included.
- Rank 0 re-verified against the best possible provider row.

## Commands actually run

`pnpm --filter @homeservicemarketplace/contracts build` · `database
prisma:validate | typecheck | build | migrate dev` · `api lint | typecheck | test
| build` · `web lint | typecheck | test:ci | build` · `prisma migrate status` ·
`psql` count verification · a runtime probe against the live database.

### Runtime verification

Mocks prove the branch; only the database proves the SQL. Against live Postgres:

```
backfilled provider   verification=NULL  liveGrant=YES  source=LEGACY_BACKFILL
revoked grant selected by the predicate?  no
expired grant selected by the predicate?  no
```

## Manual checks NOT performed

- **No GitHub CI run.** No `gh` CLI and no token on this machine; nothing pushed.
- **No Docker cold build, compose smoke, or Playwright run.**
- **No flag-on runtime exercise.** Both flags were runtime-verified at the query
  level, but the API was not booted with `WORK_ACCESS_ENFORCED=true` and driven
  through a browser.
- **No staging or production verification.**
- **No load or scraping test** — the preview does not exist yet.

## Rollback / forward-fix

1. **Flags** — set both to `false`. Restores the pre-Sprint-9 rule exactly, in
   seconds, no deploy. This is the primary control.
2. **Code** — `git revert` the arming commit; the schema is additive and can stay.
3. **Schema** — additive, so leaving it costs nothing. If it must go, drop the
   seven new tables and the two grant columns; `DataRemediationLog` records
   every backfilled row.
4. **Forward-fix preferred over rollback** for the backfill: revoking the grants
   would take access from providers who legitimately have it.

## Remaining legal and product decisions

1. **Country verification rules.** No production policy is seeded. Encoding a
   guess about licensing law would be inventing law.
2. **Retention windows** — engineering defaults, need legal sign-off.
3. **`approximateArea` resolution and budget bands** for the preview — product.
4. **Malware scanner selection.** Port defined; the no-op reports `PENDING`, so
   unscanned evidence is unreadable rather than trusted.
5. **Object-store configuration** — versioning must be off for the restricted
   namespace and backup expiry shorter than the longest retention window, or the
   deletion guarantee is fiction.
6. **Reviewer permission model** — whether reviewers are a distinct role or an
   admin permission.

## Commits

|           |                                                                   |
| --------- | ----------------------------------------------------------------- |
| `17c1101` | `test:` failing regressions for the evidence and access gaps      |
| `27be184` | `docs:` ADRs 0009–0013 and the threat model                       |
| `d258dc7` | `feat(db):` verification, restricted media and work-access schema |
| `014fb67` | `feat(api):` arm verification and work-access ranks behind flags  |
| `6dacd15` | `fix(admin):` one transition table, owned by the server           |

## Status: partially fixed

9A complete and verified. 9B not started. The branch is **not** ready to merge as
a whole while the 9B acceptance test is red — merging 9A alone would require
moving that test with it.
