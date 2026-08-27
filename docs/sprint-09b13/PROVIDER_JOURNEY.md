# Sprint 9B.13 — The provider journey, end to end

One person, from "no account" to "suspended", through the real application.

`apps/api/test/integration/provider-journey.integration.spec.ts`

---

## 1. Why this suite exists

Every other suite in this repository composes a **minimal** Nest module: the
controller under test, the services it needs, and hand-built database rows for
everything upstream of it. Each one is right about its own slice. None of them
can say whether the slices **join up** — and not one of them ever registers
anybody, so "a provider who signs up can reach a work-access grant" was a claim
no test in the codebase supported.

This suite boots `AppModule`: the real dependency graph, the real guards, the
real routes, real PostgreSQL, real Redis, real files on disk. It walks one
provider through eighteen steps and asserts each at the HTTP boundary.

It found two production defects on its first complete run. Both are described
below. Neither was findable from inside the existing tests, and that is the
point of the suite.

### The harness matches production bootstrap

`createNestApplication()` does **not** apply `main.ts`. The suite applies it
explicitly, in the same order:

| Bootstrap step                                                   | Why it is load-bearing here                                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cookieParser()`                                                 | Without it `req.cookies` is undefined and every authenticated step answers 401 — a property of the harness, not the app. This cost the first hour. |
| `express.raw` on `/v1/media/uploads`                             | Evidence bytes are a binary body, not JSON.                                                                                                        |
| `express.json({ limit: '1mb' })`                                 | Everything else.                                                                                                                                   |
| URI versioning                                                   | Every route is `/v1/...`.                                                                                                                          |
| `ValidationPipe({ whitelist, transform, forbidNonWhitelisted })` | Without it the journey walks an app that accepts payloads the real one rejects.                                                                    |

Two ports are replaced, and only two:

- **Mail** → in-memory. A verification code exists to be known only by whoever
  received the mail; the database stores a hash, which is right, and means the
  only way for a test to learn a code is to _be_ the mailbox. Overriding the
  port (rather than relying on `SMTP_HOST` being unset) also makes the suite
  independent of the developer's `.env` — this machine has `SMTP_HOST=localhost`,
  which bound Nodemailer and delivered the journey's codes to Mailpit where no
  assertion could reach them.
- **Scanner** → `EVIDENCE_SCANNER_DRIVER=test`, by env, through the same
  selection function production uses. `none` never returns CLEAN, so evidence
  would stay unreadable and step 7 could not happen at all.

Both enforcement flags are **ON** (`WORK_ACCESS_ENFORCED`,
`VERIFICATION_ENFORCED`). With them off, steps 9 and 16 cannot fail and the
suite would be asserting nothing.

Background timers are **off** (`OUTBOX_WORKER_ENABLED`,
`VERIFICATION_EXPIRY_WORKER_ENABLED`). The suite drives those actors itself, at
the point the journey reaches them, because in production a timer does and
there is no route to stand in for one.

---

## 2. Defect 1 — onboarding was impossible for every provider

**`phoneNumber: NOT_VERIFIED`, with no way to clear it.**

The completeness policy refuses a candidate that reports an unverified phone.
The wizard's `toCandidate()` supplied `phoneVerified: p.phoneVerifiedAt != null`
on every submission. And **nothing in the system can set `phoneVerifiedAt`**:

- no SMS port, no adapter, no challenge, no command, no route;
- the only code that touches the column _clears_ it, when the number changes;
- the sole place it is ever set to a date is a **unit-test fixture**,
  `makeCompleteProfile`.

So every real provider was refused at submit, forever, with an issue they could
not act on. Onboarding — the front door of the supply side — was unreachable in
production.

### Why the tests missed it

Every wizard unit test builds its profile with `makeCompleteProfile`, which sets
`phoneVerifiedAt`. The suite therefore only ever exercised a state the
application could not reach. One test asserted the refusal explicitly and passed,
which made the defect look like intended behaviour.

The journey registered a real account, and hit it on the first run.

### The fix, and its boundary

`toCandidate()` no longer supplies `phoneVerified`. The policy already defines
`undefined` as **"not asked"** — the contract it uses for every Sprint 8 field,
so that legacy profiles are not failed on data nobody ever collected from them.

This is deliberately _not_ `phoneVerified: true`. The platform does not claim
the number was verified; it stops asking a question it cannot accept an answer
to. The column stays null, the UI still reads "Not verified yet", and the rule
stays in the policy.

**Reactivation condition:** the day a phone-verification channel exists (an SMS
port, a challenge, a route that sets `phoneVerifiedAt`), `toCandidate()` supplies
the field again — one line — and the rule bites with no other change. The test
`submits with an UNVERIFIED phone, because nothing in this system can verify one`
is the one that should turn red on that day.

Pinned by:

| Test                                                                         | Pins                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| policy: `still refuses a candidate that reports an unverified phone`         | the rule is intact                                                               |
| policy: `does not judge a candidate that is SILENT about phone verification` | "not asked" ≠ "verified"                                                         |
| wizard: `submits with an UNVERIFIED phone…`                                  | the reachability fix, and the reactivation tripwire                              |
| wizard: phone change writes `phoneVerifiedAt: null`                          | changing the number still clears verification                                    |
| journey step 3                                                               | a really-registered provider has `phoneVerifiedAt === null` and can still submit |
| existing policy tests                                                        | every other mandatory field still blocks submission                              |

---

## 3. Defect 2 — the verification case did not match its own contract

The case row stores the resolution **verbatim**, which is right: a reviewer's
checklist and any later replay must not depend on the policy row still existing,
or still saying what it said that day.

```
requirementsSnapshot = { requirements: [...], policyVersion, verificationRequired }
```

The published contract is a different shape:

```ts
interface ProviderVerificationCase {
  requirements: ProviderVerificationRequirement[];
  verificationRequired: boolean;
}
```

The API handed the snapshot straight out under the array's name, and omitted
`verificationRequired` entirely. The web client, written against the contract,
calls `verificationCase.requirements.filter(...)`. **An object is truthy**, so
the `?? []` guard never fired and `.filter` threw: the provider verification
screen crashed for every provider who had a case.

### Why the tests missed it

Three independent blind spots lined up:

1. The controller cast `as unknown as Promise<CreateVerificationCaseResponse>` —
   the compiler was told not to look.
2. Every API test asserted the shape the API **produced**, never the shape it
   **published**.
3. Every web test fed itself contract-shaped fixtures the API never sent.

Each layer was self-consistent. Nothing compared them, and the journey is the
first thing that reads a real response with the client's expectations in hand.

### The fix

- `ProviderCaseView` is now an **alias of `ProviderVerificationCase`**, not a
  lookalike. The mapper cannot return anything the client is not expecting.
- Both controller casts are **gone**. The next drift is a build failure.
- `unwrapSnapshot()` translates stored → published, and is the only place that
  knows both shapes. The stored snapshot is untouched: no migration, and history
  stays immutable.
- Narrowing happens at the **leaves** (`state`, `kind`, `scanState`, `outcome`),
  where a database enum and a contract union genuinely coincide — not by casting
  a whole object and losing every other field's check with it.

**Fail-safe rules for a snapshot the mapper cannot trust:**

| Input                             | Behaviour          | Why                                                                                                                                                                             |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| null / undefined / non-object     | `requirements: []` | Never throws on a row older than the code.                                                                                                                                      |
| `requirements` not an array       | `[]`               | Same.                                                                                                                                                                           |
| entry with an unknown `kind`      | **dropped**        | Not coerced to `{ kind: '' }`. A checklist row with no label is one the provider can neither understand nor satisfy, and emitting it would only be to satisfy the type checker. |
| `serviceCategoryId` not a string  | `null`             | Normalised, never passed through.                                                                                                                                               |
| `verificationRequired` unreadable | `true`             | Fails **closed**. "We could not parse this" must never read as "verification does not apply".                                                                                   |

The admin case service already unwrapped correctly; it was checked, and no
second endpoint exposes the nested shape.

### Client-side defence in depth

`deriveVerificationView` now guards with `Array.isArray`, not `?? []`. The API
is fixed and the compiler guards it, but a client cannot verify what a server
sent it — a stale deployment, a proxy or a rollback can still put the wrong
shape on the wire, and a blank checklist is recoverable where a white screen is
not. Removing that guard turns exactly three tests red, one of which feeds the
precise object that shipped.

---

## 4. The journey

| Step  | What is proved                                                                                                                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2   | Register, verify the OTP, hold a real cookie session; account ACTIVE and email-verified.                                                                                                                                                                                                                                                                 |
| 3     | Upgrade to provider; **refresh the session**, because roles live in the access token and a role gained mid-session is unusable until rotation. Complete all eight wizard steps over HTTP with optimistic `version` handling. An admin approves the leaf specialty — a _request_ until someone agrees. Submit. Application is then locked (409 on edit).  |
| 4     | The policy in force **where the work happens** resolves; the case snapshots it. Re-creating **resumes** rather than opening a second case. The wire carries the contract shape.                                                                                                                                                                          |
| 5–6   | Prepare → PUT bytes → finalize. Server-derived size and detected type, not the client's claims. No storage key or signed URL in any response.                                                                                                                                                                                                            |
| 7     | Unscanned evidence is unreadable **even by its owner**. The sweep clears it; only then does the audited route serve it.                                                                                                                                                                                                                                  |
| 8     | Submit for review; a replay is not a second submission.                                                                                                                                                                                                                                                                                                  |
| 9     | **403 on work.** Submitting evidence is not being verified. Capabilities show `SUBMIT_BID` and `VIEW_MARKETPLACE` denied, `PREVIEW_MARKETPLACE` allowed.                                                                                                                                                                                                 |
| 10    | The preview is **off** until an operator turns it on — with the setting absent it answers 200 and nothing, so toggling is not observable as a status change. Armed, it carries no email, no precise coordinate, no storage key, no raw owner id, no address, no customer name.                                                                           |
| 10b   | Evidence is **not** reachable as public media, and the portfolio surface lists none of it.                                                                                                                                                                                                                                                               |
| 11    | The reviewer sees the case; the provider gets 403 on the admin route — asking is not a way to find out.                                                                                                                                                                                                                                                  |
| 12–13 | Approval writes case + decision + grant + notification + outbox **together**. The grant carries a real expiry and `source: VERIFIED_DOCUMENTS`. The reviewer's note never reaches the provider.                                                                                                                                                          |
| 14    | The marketplace opens; the preview capability is **retired**, so a verified provider is not offered both.                                                                                                                                                                                                                                                |
| 15–16 | Expiry: denied at the expiry instant **before any sweep runs** (access is a read-time predicate), then the sweep marks the grant EXPIRED and work stays denied.                                                                                                                                                                                          |
| 17–18 | The two axes are visible: the provider has been VERIFIED since step 12 and worked in step 14, yet the **account** is still `PENDING_REVIEW`. Suspension is legal only from ACTIVE, so the account is approved on its own axis first. Suspended: no marketplace, no preview, no feed. The case, its APPROVED decision and its CLEAN evidence all survive. |

---

## 5. Negative and security coverage

The brief's list, and where each lives. Items marked **new** were added this
sprint; the rest already existed and were verified to cover the named property.

| Item                             | Where                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| MIME spoofing                    | `evidence-upload` — executable as PNG, PDF as PNG, SVG refused                                            |
| Infected files                   | `evidence-scan` — EICAR quarantined, never released                                                       |
| Oversized files                  | `evidence-upload` — declared ceiling, **and mid-stream cap (new)**                                        |
| IDOR                             | `evidence-upload`, `evidence-read-boundary`, case service takes a user id by construction                 |
| Unauthorized reviewer            | `verification-case-workflow`, journey step 11                                                             |
| Self-review                      | `verification-case-workflow`                                                                              |
| Missing reason                   | `verification-case-workflow`                                                                              |
| Invalid transition               | **new** — `ILLEGAL_TRANSITION` had no test at all                                                         |
| Duplicate finalize               | `evidence-upload`                                                                                         |
| Duplicate decision               | `verification-case-workflow` + **new** replay test                                                        |
| Stale concurrency                | `verification-case-workflow` (`expectedState`)                                                            |
| Simultaneous approval/revocation | **new**                                                                                                   |
| Transaction rollback             | **new** — induced failure at the last write; nothing survives, and the case is still decidable afterwards |
| Expired evidence read            | **new** — retention-deleted document refused, identically to unknown, and still audited                   |
| Rate limits                      | `registration-throttle`, `marketplace-preview.throttle`                                                   |
| Log-sensitive-data leakage       | `evidence-log-hygiene`                                                                                    |
| Cross-provider access            | `evidence-read-boundary`, `evidence-upload`                                                               |
| VIP/Featured bypass              | capability matrix (unit) + **new HTTP-level test with flags armed**                                       |

**Invalid transition vs. replay.** `approve` on a VERIFIED case is deliberately
_idempotent_ — a reviewer whose response was dropped must be able to retry
without producing a second decision or grant. `revoke` on a case that was never
approved has no replay to fall back on, and that is the clean
`ILLEGAL_TRANSITION`. Both halves are now pinned.

---

## 6. Fixture isolation

| Resource       | This suite's namespace                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts       | `@provider-journey.integration.test`                                                                                                                                                                                      |
| Country        | `XH` — XA–XG are taken by sibling suites, and the live-policy-per-scope index is global                                                                                                                                   |
| Policy version | `2099.13-provider-journey-v1`, `publishedAt` in the **past** (a future date is not live, and the resolver silently fell back to the dev default until this was corrected)                                                 |
| Category       | `it-provider-journey-leaf`                                                                                                                                                                                                |
| Storage        | two `mkdtemp` roots, removed in `afterAll`                                                                                                                                                                                |
| Redis          | only `rl:auth:register:{ip,email}` for loopback and this suite's two addresses. `registration-throttle.integration.spec.ts` uses synthetic `198.51.100.x` identities, so nothing here can hide a real throttle regression |
| Locks          | `providerLifecycle` shared, `outbox` shared — a producer, never the consumer                                                                                                                                              |

**Outbox cleanup is by asset id as well as case and profile.** The scanner sweep
is global and keys `evidence.scanned` by the asset — a generated cuid carrying
no prefix. Cleaning only by case and profile left exactly one row behind per run,
and `outbox.integration.spec.ts`, a queue consumer asserting on table-wide
claims, failed for a defect that was not its own. Deterministically, three runs
out of three. That is what running the suite repeatedly is for.

---

## 7. Commands and counts

```
# API — real Postgres + Redis, all gates armed, normal workers
DATABASE_URL=… REDIS_HOST=… REDIS_PORT=6379 \
RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 \
pnpm --filter @homeservicemarketplace/api test

# Web
pnpm --filter @homeservicemarketplace/web typecheck   # tsc -b
pnpm --filter @homeservicemarketplace/web lint
pnpm --filter @homeservicemarketplace/web test
pnpm --filter @homeservicemarketplace/web build
E2E_PREBUILT=1 pnpm --filter @homeservicemarketplace/web test:e2e
```

Counts are recorded in the PR description for the exact SHA.

---

## 8. Deliberately deferred

- **Phone verification.** No SMS port is in scope for this sprint. The rule is
  parked, not deleted, with its reactivation condition written down above.
- **VIP / Featured.** Still no schema, by instruction. The bypass test asserts
  that the flags that _do_ exist (`verified`, `topPro`) buy nothing.
- **The local `_prisma_migrations` ledger.** The development database was
  created with `db push` and has no migration ledger, so `migrate status`
  reports `P3005` against it. The schema itself matches. This is local
  bookkeeping, not an application regression, and repairing it would rewrite the
  user's database — so it is reported rather than fixed. Migration correctness is
  verified against a clean database in CI.

---

## 9. Running the Compose smoke beside a live dev stack

`infra/docker/docker-compose.yml` pins `container_name` and host ports, and
`scripts/ci/compose-smoke.sh` ends in `down -v`. Run as-is on a machine whose
dev stack is up and it collides on both — and the teardown takes the
developer's data volumes with it.

The script now accepts `COMPOSE_EXTRA_FILE` and `MAILPIT_HOST_PORT` (alongside
the existing `API_HOST_PORT`). Defaults are unchanged, so CI runs exactly as
before. Write this override **next to the base file** — build contexts resolve
relative to the first `-f` — and delete it afterwards:

```yaml
# infra/docker/docker-compose.smoke.yml
#
# !override is load-bearing: Compose MERGES sequences, so a plain `ports:` is
# APPENDED to the base list. Without it the run dies with
#   Bind for 0.0.0.0:6379 failed: port is already allocated
services:
  postgres:
    container_name: hsm-smoke-postgres
    ports: !override ['15432:5432']
  mongo:
    container_name: hsm-smoke-mongo
    ports: !override ['17017:27017']
  redis:
    container_name: hsm-smoke-redis
    ports: !override ['16379:6379']
  mailpit:
    container_name: hsm-smoke-mailpit
    ports: !override ['11025:1025', '18025:8025']
  api-migrate:
    container_name: hsm-smoke-api-migrate
```

```bash
COMPOSE_PROJECT_NAME=hsmsmoke \
COMPOSE_EXTRA_FILE=infra/docker/docker-compose.smoke.yml \
API_HOST_PORT=14000 MAILPIT_HOST_PORT=18025 \
  bash scripts/ci/compose-smoke.sh
```

The project name namespaces the volumes (`hsmsmoke_postgres_data`), so the
script's `down -v` can only reach its own. Pick ports outside the Windows
reserved ranges — 54000 fails with "an attempt was made to access a socket in a
way forbidden by its access permissions", which is the OS, not Docker.

**One transient, recorded honestly.** The first run of a freshly built stack
failed at `8c. Outbox worker is running` — while the evidence block it printed
contained the very line it had just failed to find. A clean re-run of the same
command passed all 29 checks, and the check greps correctly when reproduced by
hand against a running stack. The API container is recreated by the
idempotent-migrate step, so the most likely explanation is a log captured from
the pre-restart instance. It is a raciness in the smoke script, not in the
application, and it is left as-is rather than papered over with a retry.
