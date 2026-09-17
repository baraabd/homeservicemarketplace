# Gitleaks historical baseline — synthetic test fixtures

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

| Origin commit | Rule | Source line | Classification |
| --- | --- | --- | --- |
| `b876db762045bf70ee7d1fb3eea9eb00ac4bbb97` | generic-api-key | 4 | Authored synthetic UUID-v4 DTO idempotency example |
| `58488e0580e5bbd89612f450aac3f2e56aa6eb1c` | generic-api-key | 8 | The same example after test formatting/expansion |

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
