# Current-source reconciliation notice

The dated observations below describe the earlier `g1` candidate
`54a69f78c0227a2f2b94df851a3ebb941348d8aa`; they are retained as history.
Their OPEN/INCOMPLETE/BLOCKED assessments are superseded for the current source
by [ACCEPTANCE_PUBLICATION.md](ACCEPTANCE_PUBLICATION.md),
[ACCEPTANCE_EVIDENCE.json](ACCEPTANCE_EVIDENCE.json) and the canonical
[SOURCE_MANIFEST.json](SOURCE_MANIFEST.json).

PR #168 merged CR-R20-01 at `5d3acaf861d74756190854138af485cfbfaa0a43`;
PR #169 merged the remaining source/CI repairs at `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
All nine original Wave 1 implementation/corrective merge commits are ancestors
of that source. G1-01–G1-05 now have executed merged-source evidence. The separate
G1-06 owner-publication hold remains; no Wave 2 start is implied.

---

# G1 integration evidence and limits

## Source identity and workspace

Inspected merged source: `54a69f78c0227a2f2b94df851a3ebb941348d8aa`.
Tree: `6f638f5f3aedbcc5b795b62da11bb3000f7dba4b`.
Current GitHub `develop` was resolved through the authenticated connector.
A separate repository and coordinator worktree were created; no peer checkout,
branch or stash was changed. Root/remote/status/worktrees/stashes were inspected.
The direct Git fetch was unavailable in this environment. The authenticated
GitHub commit payload and signature reconstructed exactly the Git object hash;
its complete tree and parents were already available in the copied object store.
This is exact source materialization, not a guessed base or a new commit.

All nine Wave 1 merge commits pass `git merge-base --is-ancestor <merge> HEAD`.
`git diff --exit-code f3f9ef491ac8d8296c655d0e010d8ad2a39e7cf5 HEAD` exits 0
on the inspected base. The original candidate was preserved when this repair
was prepared. Its green runs do not validate additional source in this PR.
No applicable `AGENTS.md` exists in the tracked tree or current workspace ancestry.
CLAUDE.md, UX policy, relevant ADRs, R15 money authority, R16 payout policy,
R18 blockers, live-money gate, registry, G0 manifest and lane/CR records were read.
Complete R19–R28 requirements are retained with source provenance.

## Independently inspected existing GitHub evidence

The merged candidate has **28/28 distinct named checks successful** across
seven post-merge workflows. These were inspected, not rerun locally.
The raw metadata snapshot is `REMOTE_EVIDENCE.json`.

| Evidence                                                                                                                     | Exact result and provenance                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Post-merge CI](https://github.com/baraabd/homeservicemarketplace/actions/runs/38808254418)                                  | success on candidate SHA above; install/lockfile, contracts, DB, API/Web, real services, browser, production image, scans, R18 aggregate                                                                                                             |
| [Real Postgres/Redis](https://github.com/baraabd/homeservicemarketplace/actions/runs/38808254418/job/116676790935)           | 326 suites / 6043 tests passed; 13 suites / 88 tests skipped; zero failures. Logs include R19, R21 DB and R22 in-process suites. Missing gated cases below remain missing.                                                                           |
| [API verification](https://github.com/baraabd/homeservicemarketplace/actions/runs/38808254418/job/116675463561)              | 251 suites / 4499 tests passed; 88 suites / 1632 tests skipped; zero failures; lint/typecheck/build success                                                                                                                                          |
| [Web verification](https://github.com/baraabd/homeservicemarketplace/actions/runs/38808254418/job/116675084806)              | 203 files / 2473 tests passed; lint/typecheck/build success                                                                                                                                                                                          |
| [Browser](https://github.com/baraabd/homeservicemarketplace/actions/runs/38808254418/job/116676791166)                       | 836 passed / 349 skipped, plus six setup checks. Existing skips do not earn required scenario credit. No new manual visual review claimed.                                                                                                           |
| [Database](https://github.com/baraabd/homeservicemarketplace/actions/runs/38808254418/job/116675084796)                      | validation/generation, fresh and upgraded migration gates, drift verification successful on combined Money/Email schema                                                                                                                              |
| [Security](https://github.com/baraabd/homeservicemarketplace/actions/runs/38808254418/job/116676791093)                      | dependency/secret/container job successful. Artifact inventory includes dependency-audit, secret-scan-tree and SBOM; job success is not repository-wide CodeQL alert disposition.                                                                    |
| [CodeQL](https://github.com/baraabd/homeservicemarketplace/actions/runs/38808254320)                                         | analysis succeeded on merged candidate                                                                                                                                                                                                               |
| [Identical-tree R23 alert test](https://github.com/baraabd/homeservicemarketplace/actions/runs/38792628511/job/116620805026) | pre-merge head `f3f9ef491ac8d8296c655d0e010d8ad2a39e7cf5`, same complete tree; 16 alerts, zero quality problems; firing 2026-10-15T19:22:31.083Z, resolved 19:27:31.086Z, passed=true. This workflow is PR/dispatch-only, not a post-merge push run. |

On the identical-tree pre-merge head, the latest **33 distinct named checks**
are successful; historical cancelled governance attempts remain visible.
The separate official CodeQL result `116622086331` succeeded on that head.
Source/tree equality is documented; neither this result nor the post-merge
analysis establishes that the repository-wide security inventory is empty.

Current alert inventory could not be read: the exposed GitHub connector rejects
`code-scanning/alerts` as unsupported and provides no alert-inventory tool.
Historical R18 findings #2/#13/#16/#20 are therefore **not asserted current**.
The security owner/R26 must provide current IDs and dispositions. `develop`
currently reports `protected: false`; historical R18-G1 is a release control,
not this wave gate. No security finding was dismissed and no check was weakened.

## Commands executed in this coordination worktree

Task-local Linux x64 Node **24.21.0**, pnpm **10.32.1**, Prisma **6.12.0**.
Dependencies, generated Prisma, build outputs and caches are independent of
other worktrees. No user database, shared Redis, storage root or .env was used.
Docker/Postgres/Redis/S3/Mailpit are not available locally; no real-service run
is claimed. The existing GitHub jobs above use disposable services.

| Command                                                                   | Exit / outcome                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile --offline`                                | 1; missing cached AWS SDK tarball. Not counted as PASS.                                                            |
| bounded initial online install                                            | superseded incomplete attempt; no success claimed                                                                  |
| `pnpm install --frozen-lockfile`                                          | 0; completed in 4m37.8s. Lockfile/root package unchanged. Existing ignored-build-script warnings retained.         |
| `pnpm --filter @homeservicemarketplace/database generate`                 | 0; client and native engine generated/loaded                                                                       |
| `pnpm --filter @homeservicemarketplace/api build:deps`                    | 0; database + contracts builds                                                                                     |
| New controller regression, before repair                                  | 1; **4 failed / 0 passed / 0 skipped** on existing source, demonstrating premature document headers                |
| Focused controller/service/policy/restricted storage suites, after repair | 0; **5 suites / 79 tests passed**, zero failures/skips; includes recorded-size propagation and three refusal paths |
| `pnpm --filter @homeservicemarketplace/api typecheck`                     | 0                                                                                                                  |
| `pnpm --filter @homeservicemarketplace/api lint`                          | 0                                                                                                                  |
| `pnpm --filter @homeservicemarketplace/api build`                         | 0                                                                                                                  |
| `node --test .github/scripts/*.test.mjs`                                  | 0; **156 passed**, zero failures/skips, including 23 G1 acceptance/ownership/publication cases                     |
| `node .github/scripts/production-governance.mjs`                          | 0; validates source files, not GitHub branch protection                                                            |
| `node .github/scripts/release-baseline.mjs`                               | 0; source-backed baseline only                                                                                     |
| `node .github/scripts/sprint-registry.mjs`                                | 0; registry/index/gate/wave/ownership consistent                                                                   |
| Platform script suites: storage, mail, outbox CLI, alert receiver         | 0; **35 passed**, zero failures/skips                                                                              |

Focused Jest invocation:

```sh
pnpm --filter @homeservicemarketplace/api exec jest --runTestsByPath \
  src/modules/provider/verification/media/evidence-read.controller.spec.ts \
  src/modules/provider/verification/media/evidence-read.service.spec.ts \
  src/modules/provider/verification/media/evidence-read.policy.spec.ts \
  src/infrastructure/storage/restricted-object-storage.contract.spec.ts \
  src/infrastructure/storage/s3-restricted-storage.stream-ownership.spec.ts
```

The local regression uses explicit storage/permission/service contract doubles.
It proves the controller boundary, not real S3, a real session, or a hosted IAM
policy. The existing real-S3 test was strengthened to require JSON 404 and refuse
size substitution. It still requires actual enabled execution before acceptance.
No skips were introduced, timeouts raised, concurrency lowered or scanners changed.

Scoped Prettier and ESLint also exited 0; `git diff --check` was clean.
All 23 changed/new files match the exact coordinator allowlist.

## Required scenarios that the existing green aggregate omits

- R20's 40 real-storage cases: `RUN_R20_STORAGE_INTEGRATION` is absent from CI;
  source still includes avatar write-once GAP. Retention tests do not substitute.
- R21's three real-Mailpit cases: `R21_MAILPIT_SMTP_PORT` / `R21_MAILPIT_API_URL`
  are absent; DB-only feedback cases do not establish SMTP acceptance.
- R22's independent two-worker kill/restart/SIGTERM suite:
  `RUN_R22_WORKER_PROCESS` is absent. In-process lease tests are not equivalent.
- R22 replay execute cases require the missing audit enum/migration; the current
  default branch exercises refusal and skips real execute cases.
- R19 callable-port freeze/compensation binding and R23 mounted diagnostics /
  dependency metrics remain incomplete source boundaries, not just CI switches.

## Publication checks

The first published head `9c5b3f36e2bd37558a2d0c7ef5873f5e6484ce0e`
failed its tracked-tree secret scan in job `116891924918`, run `38875799702`.
Gitleaks 8.24.3 reported two generic-api-key matches in ordinary R19 requirement
prose (REQUIREMENTS.md and the retained prompt). The pinned scanner reproduced
both locally; the records were reworded with provenance, without an exclusion
or scanner-policy change. The original failed run is retained and is not PASS.
The successor head requires fresh checks.

Final coordinator-head CI must be inspected after publishing. Its head and run
URLs are maintained in the English Draft PR, avoiding a commit that embeds its
own SHA. Mandatory final-head evidence is not claimed in advance. G1 remains
BLOCKED even if all configured coordinator PR checks pass, until the missing
Wave 1 scenarios and source handoffs above are closed on a merged candidate.

No authorized vendor sandbox, hosted target, external delivery, production
incident readiness, deployment, live payment or payout acceptance is claimed.

## Historical scanner repair — 2026-10-16 follow-up

Scope: PR #168, CI run number 489 (`38876680432`), based on
`8c730d9a73099d64b6d3fe6175da2601ee3efc35`. Mode A; see the bounded
follow-up in OWNERSHIP.md. The earlier failures above remain historical facts.

The failed security job `116895556319` scans the two PR commits, including
the first version of the requirement prose. Rewording the latest tree alone
cannot fix that history scan. The two lines are individually classified in
`docs/security/gitleaks-historical-baseline.md`, section 12. Only their exact
historical fingerprints are added; scanner rules/ranges and all CI gates stay
intact. R18 and CI gate need no change: both correctly fail when security fails.

Executed locally with Gitleaks 8.24.3, Node 24.21.0 and pnpm 10.32.1:

| Verification                                                 | Observed result                                                                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original CI history range, before the baseline delta         | Exit 2; exactly the two reported fingerprints, 2 commits / 725,289 bytes scanned                                                                                           |
| Identical history range, after the baseline delta            | Exit 0; 0 findings, same 2 commits / 725,289 bytes scanned                                                                                                                 |
| Isolated temporary repository with the proposed fingerprints | Exit 2; all 4 negative controls detected: new generic and GitHub-PAT synthetic values, plus both original prose lines at their original paths/line numbers in a new commit |
| `node --test scripts/security/*.test.cjs`                    | 46 passed, 0 failed, 0 skipped                                                                                                                                             |
| `node --test .github/scripts/*.test.mjs`                     | 156 passed, 0 failed, 0 skipped                                                                                                                                            |
| `node .github/scripts/production-governance.mjs`             | PASS; GitHub protection not verified by this local check                                                                                                                   |
| `node .github/scripts/release-baseline.mjs`                  | PASS; does not imply sprint completion                                                                                                                                     |

The reproduced history command is `gitleaks detect --redact --exit-code=2
--report-format=json --log-opts="--no-merges --first-parent
9c5b3f36e2bd37558a2d0c7ef5873f5e6484ce0e^..8c730d9a73099d64b6d3fe6175da2601ee3efc35"`.
The canary repository was removed; no synthetic secret value was printed or
committed to this project. Its detections prove that the two historical
fingerprints do not suppress new occurrences at the same location.

The final committed-tree/history scans, formatting and remote checks are
reported against the published SHA in the PR metadata, avoiding a self-SHA
commit loop. Prior-head application test counts are not claimed as new runs.
No application, schema, contract, dependency, workflow or feature flag changes
are part of this follow-up. Remote CI still has to execute the previously
blocked image/SBOM/container steps and the dependent aggregate gates.

G1 remains BLOCKED: G1-01 through G1-06 are unchanged. Technical acceptance
of this repair is not acceptance of Wave 1. G2 follows accepted G1, authorized
R24–R28 implementation/integration and the Wave 2 acceptance decision; it
cannot be obtained by marking this scanner repair green. Rollback is a normal
reviewed revert of this follow-up; it restores the two known history findings
without changing the underlying source or data.
