# Gitleaks historical baseline — reviewed non-secret findings

**Date** 2026-09-06
**Sprint** 9B.28 (CI remediation)
**Reviewer** Principal DevSecOps review, recorded here for audit

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| Failing CI run   | `34031702673` (run number **114**)                             |
| Failing job      | `Dependency, secret, and container scans` — job `101482725050` |
| Failing step     | `Secret scan`                                                  |
| Gitleaks version | `8.24.3`                                                       |
| SARIF artifact   | `9988877094`                                                   |
| Findings         | 10, all rule `generic-api-key`                                 |
| Commits scanned  | 397 in CI #114; 398 locally after one further commit           |

---

## 1. What actually failed, and what it was not

The secret scan is a **blocking** gate and it did its job: it reported ten
`generic-api-key` hits and exited non-zero. Everything downstream of it in that
job — the image build, the SBOM, and the container vulnerability scan — was
**skipped as a consequence**, which is why a single scanner finding took four
controls offline at once.

Two things it was **not**:

- **Not a regression from the branch under test.** All ten findings live in
  three commits from April, May and August 2026, every one of them an ancestor
  of `origin/develop`.
- **Not the Node 20 / `punycode` / `url.parse()` deprecation warnings** in the
  same log. Those are warnings and were present on green runs too. No Actions
  runtime upgrade was bundled into this remediation.

### Why it surfaced now

`gitleaks-action` scopes its scan by event. On `push` and `pull_request` it
scans the **commit range** for that event. On `workflow_dispatch` there is no
range, so it scans the **entire history**.

Sprint 9B.28's PR is stacked onto a feature branch, and this repository's
workflows only trigger on `main`/`develop`, so the branch had to be dispatched
manually — which turned a range scan into a full-history scan and surfaced
findings that range-scoped runs had never looked at. The findings were always
there; nothing about them changed.

---

## 2. Classification

Method, applied to each finding:

1. Read the flagged line and its surrounding code at the originating commit.
2. Extract the literal and search the **entire worktree** for it.
3. Search the **entire history** for it — `git log --all -S<literal>
--name-only`, deliberately _without_ `--pickaxe-all`, which reports
   co-changed files and produces a misleading answer.
4. Check local (gitignored) env files.
5. Check the value against known provider-credential prefixes.

The ten findings resolve to **five distinct literals**. Every one of them has
appeared, across all 398 commits, **only inside `.spec.ts` / `.test.tsx`
files** — never in application source, never in `.env*`, never in a deployment
manifest, never in CI configuration. None carries a provider prefix
(`AKIA`, `ghp_`, `sk_live`, `xox…`, `AIza`, `ya29.`).

**Verdict: all ten are `Synthetic test fixture`. Zero real, zero
revoked-historical, zero undetermined. No credential rotation is required.**

| #   | Commit     | Path                                                                            | Rule            | Line | Class     | Why                                                                                             |
| --- | ---------- | ------------------------------------------------------------------------------- | --------------- | ---- | --------- | ----------------------------------------------------------------------------------------------- |
| 1   | `37c90005` | `apps/api/src/modules/iam/authentication/services/token.service.spec.ts`        | generic-api-key | 6    | Synthetic | `const SECRET` feeding a mock `AppConfigService`; ≥32 chars only to satisfy `env.schema.ts`     |
| 2   | `37c90005` | `apps/api/src/modules/iam/authentication/services/verification.service.spec.ts` | generic-api-key | 13   | Synthetic | same shared IAM test signing secret                                                             |
| 3   | `37c90005` | `apps/api/src/modules/iam/authentication/services/session.service.spec.ts`      | generic-api-key | 21   | Synthetic | same shared IAM test signing secret                                                             |
| 4   | `37c90005` | `apps/api/test/integration/auth-flow.integration.spec.ts`                       | generic-api-key | 75   | Synthetic | local `const SECRET` inside the suite's mock config factory                                     |
| 5   | `f3cce56e` | `apps/api/src/infrastructure/storage/local-disk-storage.adapter.spec.ts`        | generic-api-key | 14   | Synthetic | `JWT_ACCESS_SECRET` in a mock config; media signing falls back to it                            |
| 6   | `f3cce56e` | `apps/api/src/infrastructure/storage/local-disk-storage.adapter.spec.ts`        | generic-api-key | 157  | Synthetic | the same value, used to sign a token the test then asserts is **expired**                       |
| 7   | `f3cce56e` | `apps/api/test/e2e/media.e2e.spec.ts`                                           | generic-api-key | 43   | Synthetic | `JWT_ACCESS_SECRET` in the e2e mock config; the file performs no signing                        |
| 8   | `6d63dc35` | `apps/api/test/e2e/password-reset.e2e.spec.ts`                                  | generic-api-key | 95   | Synthetic | local `const SECRET` in the suite's mock config                                                 |
| 9   | `6d63dc35` | `apps/api/test/integration/password-reset.integration.spec.ts`                  | generic-api-key | 132  | Synthetic | local `const SECRET` in the suite's mock config                                                 |
| 10  | `6d63dc35` | `apps/web/src/app/pages/AuthPages.test.tsx`                                     | generic-api-key | 240  | Synthetic | a 15-character reset token whose only purpose is proving `-` and `_` survive the route verbatim |

**No secret value is recorded in this document, in `.gitleaksignore`, in any
commit message, or in any log or artifact produced by this remediation.** Every
diagnostic command used `--redact`, and the provenance tooling printed paths
and counts only.

---

## 3. The remediation

### `.gitleaksignore` — exactly ten fingerprints

Fingerprints only, in `commit:path:rule:line` form. Verified mechanically:

```
non-comment entries                         : 10
entries containing a glob/wildcard/regex    : 0
entries not matching commit:path:rule:line  : 0
```

A fingerprint pins **one occurrence in one historical commit at one line**. A
finding at a new commit, or the same value at a different line, produces a
different fingerprint and still fails CI.

### What was deliberately NOT done

- No `.gitleaks.toml` — the rule set is untouched and `generic-api-key` is
  still enabled.
- No path, directory, extension or regex exclusion; no "ignore all test files".
- No `continue-on-error`, no `exit-code: 0`, no removal of the job, no
  narrowing of the scan to the current commit to dodge history.

### Source-level prevention

The historical fingerprints must stay, because rewriting the worktree does not
change what is already in the history. But the **habit** that produced them was
also removed, so a future edit to one of these lines cannot resurrect the
failure under a fresh fingerprint:

`apps/api/test/support/test-secrets.ts` exports `makeTestSecret(label, length)`,
which derives a deterministic value at runtime. A derived value is not a
literal in a blob, so there is nothing for a scanner to match. Nine call sites
were converted; the web token was reassembled from short segments with its
URL-safe characters made explicit.

One trap found while doing this, worth recording: in
`local-disk-storage.adapter.spec.ts` lines 14 and 157 were the **same** literal.
`MEDIA_SIGNING_SECRET` is empty in that suite, so the adapter falls back to
`JWT_ACCESS_SECRET` — giving the two sites different labels made the expired
token fail as `signature-mismatch` instead, silently converting an expiry test
into a duplicate of the signature test above it. Both now use one label.

No test was deleted, skipped, weakened, or had its assertions changed. Length
and entropy expectations are preserved (`makeTestSecret` refuses a length below
the 32-character config minimum rather than returning a value the schema would
reject three layers away).

---

## 4. Proof the gate still blocks

A throwaway repository was created **outside** the project, carrying this
repository's `.gitleaksignore` verbatim (10 entries), with two runtime-generated
canaries committed to it. No canary value was printed, and no canary was ever
committed to this repository.

```
=== ignore entries      : 10
=== gitleaks exit code  : 2   (2 = leaks found, which is the PASS condition)
    RuleID:      generic-api-key     File: canary-generic.ts
    RuleID:      github-pat          File: canary-pat.ts
    leaks found: 2
=== canary repo removed : yes
```

The first canary matters most: `generic-api-key` is the **same rule** as all ten
baselined findings, and it still fires.

An earlier canary attempt using AWS's published example key
(`AKIA…EXAMPLE`) was **not** detected, because Gitleaks allowlists well-known
documentation values. Recorded here so the next person does not mistake that
for a broken scanner.

---

## 5. Review and removal

Baseline entries are **debt, not policy**. They should shrink over time.

**Review trigger:** whenever any of the three originating commits is rewritten,
dropped, or squashed away, and at minimum once per release cycle.

**To check for stale entries** — an entry whose fingerprint no longer resolves
is dead weight and should be deleted:

```bash
docker run --rm -v "$PWD":/repo -w /repo zricethezav/gitleaks:v8.24.3 \
  detect --redact -v --exit-code=2 --log-level=info
# then remove any .gitleaksignore line whose commit is no longer reachable:
git cat-file -e <commit>^{commit} 2>/dev/null || echo "stale entry: <commit>"
```

**Adding an entry is a security decision, not a build fix.** A new finding must
be individually reviewed — classified against §2's method, its provenance
proven, and the outcome recorded in this document — before a fingerprint is
added. If a finding cannot be proven synthetic, it is treated as a live
credential: rotate first, then decide about history.

## 6. Sprint 12A delta — non-secret request identifiers (2026-09-17)

CI `35242994528`, security job `105277441969`, stopped on exactly two
`generic-api-key` findings in `dispute-intake.dto.spec.ts`. SARIF artifact
`10506239201` was retrieved; its ZIP SHA-256 matched GitHub metadata:
`4434866a0a982171d0619e02272963a1f6a5a1f81b0ebdf798879d5396c5bfb4`.

| Origin commit                              | Rule            | Source line | Classification                                     |
| ------------------------------------------ | --------------- | ----------- | -------------------------------------------------- |
| `b876db762045bf70ee7d1fb3eea9eb00ac4bbb97` | generic-api-key | 4           | Authored synthetic UUID-v4 DTO idempotency example |
| `58488e0580e5bbd89612f450aac3f2e56aa6eb1c` | generic-api-key | 8           | The same example after test formatting/expansion   |

Both flagged source versions were read at their exact commits. The value was
introduced during this implementation solely as the valid UUID input to local
DTO/ValidationPipe tests; those tests neither authenticate with it nor contact
an external provider. A request idempotency key is not an authorization token.
The application's real command separately requires authenticated participation
and CSRF, and derives an actor-bound opaque intent identifier. This literal was
not obtained from an account, environment, credential store or external service.
It is therefore an individually reviewed non-secret test fixture, not an
unresolved credential requiring concealment.

The fixed example is replaced by `randomUUID()` from `node:crypto`, retaining
UUID-v4 validation and all negative tests. Only the two exact SARIF-derived
historical fingerprints are appended to `.gitleaksignore`; the original ten
remain unchanged. No extension/directory/path pattern, rule, tolerance, scan
range, workflow, or blocking exit status is changed. Future occurrences at any
other commit or line are not covered by these entries. History is not rewritten.

Review scope differs from the original §2 retrospective: source provenance is
known because this session authored the example, and both reported historical
occurrences and the current affected-file fixture were inspected. A complete
repository/history clone, machine-local environment inspection and a new live
scanner canary run were **not available in this editing environment** and are
not claimed. The original 398-commit review and canary figures above remain
historical evidence, not measurements for Sprint 12A. Final remote CI must run
the unchanged scanner again before this PR is accepted. Maintain these two
entries only while their originating commits remain reachable; review/remove
them using §5's procedure at release review.

## 7. R07 delta — test placeholders (2026-10-02)

CI run `36977816747`, security job `110746741744`, on PR #125 head
`8968db809d5a89e1b4e44ac07e8a79c5f435144f`, stopped on exactly five
`generic-api-key` findings. The fingerprints below are copied from that job's
log.

| Origin commit                              | File                                                                  | Line               | Classification                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `7c7a11861f85cf1168db7a0d217594f3388bbc44` | `apps/api/src/modules/requests/requests.service.spec.ts`              | 329, 337, 352, 355 | One fixed request idempotency-key example, repeated four times in a unit spec       |
| `8968db809d5a89e1b4e44ac07e8a79c5f435144f` | `apps/api/test/integration/r07-marketplace-races.integration.spec.ts` | 212                | A dummy signing secret passed to a mock configuration object in an integration spec |

Both values were read at their reporting commits. The idempotency-key example
is a readable placeholder string used only as an argument to mocked repository
calls; an idempotency key is not an authorization token, and the real command
additionally requires an authenticated session and CSRF. The signing-secret
placeholder is a readable sentence-like string given to a hand-built config
object so that an opaque storage-key reference can be derived inside the test;
it signs nothing that leaves the test process.

Provenance was checked with `git log --all -S<value>` for each value. Each
appears only in the commits listed above (plus one unpushed local commit that
is not part of any published branch), and only in `.spec.ts` files. Neither
appears in any environment, deployment, workflow or source file, and neither
resembles a provider credential.

The sources are fixed in the same change: the unit spec now uses
`randomUUID()` from `node:crypto`, and the integration spec uses
`makeTestSecret()`. Only the five exact fingerprints are appended to
`.gitleaksignore`; the existing twelve are unchanged. No path pattern, rule,
tolerance, scan range, workflow or blocking exit status is changed. A finding
at any other commit or line still fails CI. History is not rewritten.

Not done, and not claimed: a new scanner canary run was not performed for this
delta. The unchanged scanner must pass on the final PR head before the PR is
accepted. Maintain these five entries only while their originating commits
remain reachable, and review them with §5's procedure at release review.

## 8. R13 delta — test-only CI placeholder (2026-10-04)

Found before publication, by a local gitleaks 8.24.3 history scan
(`--no-merges 5e7a02b..HEAD`, 12 commits) of PR #135's integration candidate.
No hosted run had reported it: on every earlier R13 head the dependency audit
failed first and the _Secret scan_ step was skipped (runs 37188327866,
37189568393). Once the audit passes, the unchanged scanner would stop on it.

| Origin commit                              | File                                   | Line | Classification                                        |
| ------------------------------------------ | -------------------------------------- | ---- | ----------------------------------------------------- |
| `d316a2f46270024b301c78bfa86d15e94e2350c9` | `.github/workflows/r13-validation.yml` | 39   | Readable `JWT_ACCESS_SECRET` placeholder for a CI job |

Read at its commit: a 44-character, sentence-like value set as the job-level
`JWT_ACCESS_SECRET` of a branch-only diagnostic workflow. That job used a
disposable PostgreSQL database and test-only environment (`NODE_ENV=test`); the
value signs nothing outside that job. `git log --all -S<value>` finds it only
where that workflow file was added (`d316a2f`) and deleted (`1e3005b`, whose
commit also staged the workflow deletion). It is absent from the worktree, from
every environment file, and from application source and deployment
configuration. It carries no provider prefix. No value is recorded here.

**Verdict: synthetic CI placeholder. No rotation is required.**

The source is already gone: the workflow was deleted on the same branch. Only
this one exact fingerprint is appended to `.gitleaksignore`; the existing
seventeen are unchanged. No path pattern, rule, tolerance, scan range or
blocking exit status is changed, and history is not rewritten.

Proof the gate still blocks: in an isolated temporary repository carrying the
updated `.gitleaksignore`, a runtime-generated `generic-api-key` canary was
committed and detected (exit 2). The canary value was neither printed nor
committed here. Maintain this entry only while `d316a2f` remains reachable, and
review it with §5's procedure at release review.

## 11. R23 delta — synthetic redaction-test values (2026-10-14)

Numbered 11 because §9 (R19) and §10 (R21) were added on develop after R23's
base (`059c018`); this section does not depend on them.

Reported by hosted CI on Draft PR #163 (run `38534564439`, job
`115757197418`, steps _Secret scan_ and _Secret scan of the exact tracked
source tree_) and reproduced with a local gitleaks 8.24.3 history scan
(`--no-merges --first-parent 059c018..feat/r23-observability-incidents`) on a
bare clone of the branch.

| Origin commit                              | File                                                        | Line | Rule              | Classification                    |
| ------------------------------------------ | ----------------------------------------------------------- | ---- | ----------------- | --------------------------------- |
| `4c438f05f262cd05eef9746027e34dbefa58d6e6` | `apps/api/src/infrastructure/logger/logger.privacy.spec.ts` | 46   | `generic-api-key` | `SYNTH`-prefixed fake API key     |
| `4c438f05f262cd05eef9746027e34dbefa58d6e6` | `apps/api/src/infrastructure/logger/logger.privacy.spec.ts` | 50   | `generic-api-key` | `SYNTH`-prefixed fake DB password |
| `4c438f05f262cd05eef9746027e34dbefa58d6e6` | `apps/api/src/infrastructure/logger/logger.privacy.spec.ts` | 59   | `jwt`             | Unsigned-looking fake JWT         |

Read at its commit: the three values are entries of the spec's `SECRETS`
table. The spec plants them in request headers, bodies, exception causes and
SDK-shaped errors, then asserts that none of them reaches logs, spans, the
metrics exposition or client responses. The JWT's segments decode to
`{"alg":"HS256"}`, `{"sub":"SYNTHjwt"}` and the text `SYNTHjwtsignature`; it
is not signed by any key. `git log --all -S<value>` finds each value only in
`4c438f0`. None is in the current worktree or any environment file, and none
carries a provider prefix. No value is recorded here.

**Verdict: synthetic test fixtures. No rotation is required.**

The source is fixed: the spec now assembles these values at runtime
(`synthetic(...)` and base64url encoding), producing the same strings without
a literal. Only these three exact fingerprints are appended to
`.gitleaksignore`; existing entries are unchanged. No path pattern, rule,
tolerance, scan range or blocking exit status is changed, and history is not
rewritten.

Proof the gate still blocks: with the updated `.gitleaksignore`, the branch
range scan exits 0. In an isolated temporary repository carrying the same
file, a runtime-generated `generic-api-key` canary was committed and detected
(exit 1, one leak). The canary value was neither printed nor committed.
Maintain these entries only while `4c438f0` remains reachable, and review them
with §5's procedure at release review.

## 12. G1 delta — ordinary requirements prose (2026-10-16)

CI run `38876680432` (run number 489), security job `116895556319`,
failed on PR #168 head `8c730d9a73099d64b6d3fe6175da2601ee3efc35`.
The history step reports two `generic-api-key` findings from its first commit,
`9c5b3f36e2bd37558a2d0c7ef5873f5e6484ce0e`. The current-tree scan succeeds;
the later prose correction did not remove the earlier commit from history.
R18 acceptance and CI gate fail because they depend on that security job.

| Historical path                                                  | Line | Classification                                         |
| ---------------------------------------------------------------- | ---- | ------------------------------------------------------ |
| `docs/production-readiness/post-r18/gates/g1/REQUIREMENTS.md`    | 12   | Non-secret requirements prose                          |
| `docs/production-readiness/post-r18/gates/g1/prompts/R19-R28.md` | 78   | The same non-secret requirement in the retained prompt |

Review performed by the Codex agent under the owner's explicit CI-repair
request; this records the performed classification, not an independent human
security approval. Both full lines were read at the exact originating commit.
The scanner interpreted wording after the noun "keys" as an assigned value.
That wording describes refund and reservation persistence records in R19
implementation item 4. It is ordinary English business terminology, not a
credential, token, environment value, signed payload or provider-issued key.

The identical phrase was searched with `git grep -l -F` in the tracked source
and `git log --all -S` in all locally available refs. It occurs only in the two
G1 records and their editorial provenance note. The fresh checkout contains
only the tracked `.env.example`; no external environment or secret store was
accessed. This provenance establishes that these two matches are non-secret;
it is not a repository-wide credential inventory or production security audit.

**Verdict: two false positives in ordinary documentation. No credential
rotation applies to these prose matches.** The source wording was already
clarified in `8c730d9a`; the requirements remain unchanged.

Only the two exact `commit:path:rule:line` fingerprints from the failed job
are added to `.gitleaksignore`. Existing fingerprints remain unchanged. There
is no path/extension exclusion, regex allowance, disabled rule, changed scan
range, tolerated failure or history rewrite. A new occurrence, including the
same prose at the same path and line in a new commit, still fails the scan.
The current-tree scanner has no matching historical fingerprint for new data.

Review/remove these two entries using §5 when the originating commit is no
longer reachable, and at every release review. Scanner verification is
recorded in the G1 `INTEGRATION_EVIDENCE.md` follow-up. Final-head remote CI
must succeed before technical acceptance; G1's independent blockers remain.

## 13. G2 delta — compile-time idempotency identifiers (2026-10-17)

[CI run 39071261819](https://github.com/baraabd/homeservicemarketplace/actions/runs/39071261819),
[security job 117510127234](https://github.com/baraabd/homeservicemarketplace/actions/runs/39071261819/job/117510127234),
reported three `generic-api-key` findings in the history and tracked-tree
scans of PR #180 head `736208b70c211c5c1fe931f0a2f0f37c4d55d529`.
All three are in `apps/api/test/support/g2-money-ports-consumer.fixture.ts`:

| Reported line | Input field                         | Classification and purpose                                                     |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| 53            | Collection `providerIdempotencyKey` | Authored synthetic identifier for the collection adapter's compile-time input  |
| 74            | Receipt `idempotencyKey`            | Authored synthetic identifier for the receipt participant's compile-time input |
| 105           | Refund `providerIdempotencyKey`     | Authored synthetic identifier for the refund adapter's compile-time input      |

The Codex fixture author performed this individual classification under the
owner-delegated G2 coordinator's recorded three-path lease. The coordinator
also inspected the three source lines. This records the performed agent
review; it does not claim independent human security approval.

Each full source line and its surrounding function was read at the reported
commit. The identifiers were authored for the new `g2MoneyPortsConsumerFixture`
function, which has no caller in tracked source and is never invoked by tests
or application runtime. Its input objects exercise the actual frozen ports
with synthetic account references, `SANDBOX` mode and `XTS` amounts. None of
these three identifiers authenticates a request, signs a payload, selects a
live rail account or comes from an external credential provider. No value
carries a known provider-credential prefix. **Verdict: three non-secret,
authored compile-time fixtures; credential rotation does not apply.**

Provenance was checked with exact-value `git grep -l -F` searches of both the
reported tree and current tracked files: each identifier has one occurrence,
only in this fixture. The consumer function name likewise appears only in
its declaration file. The locally available fixture history was inspected
at `f93ddb5509a33c471a4f3758889643e581727aa9` and the reported head, plus the
local hook checkpoint `ca32750c535338cab7a1821452086468370dd216`; each source
version contains the same three fixture inputs. These local checkpoints do
not receive additional baseline entries.

The checkout exposes 183 refs and 1,145 reachable commit objects. An attempted
repository-wide `git log --all -S<literal> --name-only` search could not finish
because this partial clone lacks an unrelated historical promisor blob and
automatic network hydration was unavailable in the default sandbox. The
completed review therefore covers the exact reported source, available
fixture history and current tracked-file searches, consistent with the
bounded authored-provenance reviews in sections 6 and 12. It does not claim a
complete historical-content search, environment inventory or credential-store
audit. Only source paths, commit identities and counts are retained as
provenance evidence; the fixture values are not recorded here.

The three fixed inputs are replaced with `randomUUID()` from `node:crypto`.
All actual-port calls and all seven `@ts-expect-error` transaction-boundary
controls remain unchanged. No runtime money orchestration is added.

Only the three exact reported `commit:path:rule:line` fingerprints are added
to `.gitleaksignore`, preserving its 23 existing entries. There is no path or
extension exclusion, regex allowance, disabled rule, altered workflow or scan
range, tolerated failure, or history rewrite. A finding at a different commit
or line remains outside these historical entries. Review/remove the three
entries using section 5 when the reported commit is no longer reachable and
at every release review.

The official Gitleaks 8.24.3 Linux x64 archive was verified against the
workflow's pinned SHA-256:
`9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c`.
Before correction, that binary reproduced exactly the three findings in both
the unchanged published history range
(`--no-merges --first-parent 736208b70c211c5c1fe931f0a2f0f37c4d55d529^..736208b70c211c5c1fe931f0a2f0f37c4d55d529`)
and the existing tracked-tree scanner on the reported commit. After the three
reviewed fingerprints were added, that identical history range scanned one
commit and 447,485 bytes, returning zero findings and exit 0.

To prove the gate still blocks, a separate temporary directory outside this
repository received the updated 26-entry `.gitleaksignore` and two freshly
generated canaries. Gitleaks detected both `generic-api-key` and `github-pat`,
returning exit 2 with exactly two findings. No canary value was printed or
committed; the canary source directory was removed after the redacted results
were recorded. API TypeScript checking, exact fixture lint and scoped
formatting checks also passed; all seven negative type controls are retained.

The corrected-tree verification uses a complete private copy of the reported
tracked tree with only these three leased file changes overlaid. It creates
no source commit or Git ref and cannot stand in for the coordinator's final
commit-bound scan. Final remote CI remains an acceptance requirement.

## 14. PR183 R36 recovery-inventory prose (2026-10-23)

CI run `39863810716`, job `120122846166`, reported one `generic-api-key`
finding in both its historical scan and tracked-source scan. The exact
historical fingerprint is:

`6c7aac2ea68ee4943d60b0db3be33012d572ac8d:docs/production-readiness/post-r18/gates/g2/prompts/R36.md:generic-api-key:72`

The Codex coordinator reviewed that complete requirement at its introducing
commit and the current source. It describes recovery inventory and build
artifact names, with no assigned credential or runtime value. The prompt's
recorded source provenance and surrounding recovery requirements confirm its
documentation purpose. This is an agent classification under the owner's PR
repair request, not independent human security approval or a credential-store
audit. Verdict: one ordinary-prose false positive; rotation does not apply.

Only this exact historical fingerprint is added; all 26 earlier entries remain
unchanged. The current prompt changes one space into a Markdown continuation
newline. Its normalized text is identical, and PROMPT_PROVENANCE.md records the
new retained-file digest. No scanner rule, scan range, blocking status or path
exclusion changes. A new occurrence outside the exact historical fingerprint
continues to fail. Review/remove this entry using section 5 when its originating
commit is no longer reachable and at each release review.

Verification used Gitleaks 8.24.3 from the archive matching the workflow's
pinned SHA-256 `9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c`.
The unchanged first-parent/non-merge PR range from `3139cafe` to `7843ed58`
scanned three commits and 687,365 bytes, returning exactly that one finding
with exit 2 before correction, then zero findings and exit 0 after the exact
fingerprint. With the updated baseline, two freshly generated canaries in a
separate temporary repository were both detected (`generic-api-key` and
`github-pat`, exit 2). Canary values were never printed or committed here;
their temporary repository was removed. All seven existing tracked-tree scanner
policy tests also passed. Final corrected-commit tree scanning and exact-head
CI remain required; the earlier failed run is retained.

## 15. G3 evidence digest matches (2026-10-24)

The Codex coordinator individually reviewed two `generic-api-key` findings
in published commit `2757d86f7d9e4a3b1cd655a5c4c9cd1d7848787c` under the
user's G3 integration authorization. This is an agent classification, not
independent human security approval.

| File                                                                     | Line | Classification                                   |
| ------------------------------------------------------------------------ | ---- | ------------------------------------------------ |
| `docs/production-readiness/post-r18/gates/g3/IMPLEMENTATION.md`          | 25   | SHA-256 of the sanitized configuration inventory |
| `docs/production-readiness/post-r18/gates/g3/evidence/LOCAL_CHECKS.json` | 227  | SHA-256 of the local API test report             |

Both complete source records were inspected at the originating commit. Each
64-character value was independently recomputed from its exact input and
matched: canonical sorted compact JSON for the configuration inventory, and
raw bytes for the test report. They were authored by this session for evidence
integrity. Neither authenticates, signs, authorizes or comes from a provider
account or credential store. No production environment was inspected. This
bounded derivation proof does not assert a repository-wide credential audit.

The actual Gitleaks 8.24.3 first-parent/non-merge range from `73a4a64a` to
`2757d86f` reproduced exactly these two findings (exit 2), matching the
tracked-tree scan. The current prose and artifact-digest layout are clarified
without changing either digest. Only the two exact historical fingerprints
are added. No scanner rule, path pattern, range, budget or blocking status is
changed, and no history is rewritten. Local-only commit aliases receive no
ignore entries.

Review/remove these entries under section 5 when the originating commit is
unreachable or at release review. The corrected tracked-tree scan and final
remote CI remain mandatory.

Verification: the unchanged historical range scanned five commits and 134,200
bytes after the two fingerprints, with exit 0 and no findings. An isolated
temporary Git repository carrying the updated baseline received two freshly
generated canaries. Both generic-api-key and github-pat were detected (exit 2,
two findings); their values were never printed or committed here, and the
temporary source was deleted.
