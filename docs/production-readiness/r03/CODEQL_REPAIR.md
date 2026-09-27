# PR #117 — Security-result remediation

Parent source: `b52fd21d1663cb41d8d708ffb0b1fcd3afbb8978`.
Parent tree: `1ff823c600c4e1c1c8c6ed07977580660b96e998`.
Integration owner: @baraabd. The repair stays on `feat/r03-staging-release-boundary`.
No merge, deployment, new migration, secret disclosure, DNS change or paid resource
is included. R04 and its separate candidate files are not part of this change.

## Confirmed failure

The CodeQL Actions workflow completed, but GitHub Advanced Security's separate
`CodeQL` check 108629234863 failed with three new alerts (one high, two medium).
Review comments 4115501239, 4115501243 and 4115501248 point to `staging.cjs`.
This distinction is now enforced by the final-SHA acceptance collector.

## Remediation

1. `js/file-system-race`: replace pathname stat/read pairs with a single descriptor.
   Use fstat before/after bounded reads, always close the descriptor, and compute the
   digest from the same bytes that are parsed. Every subsequent consistency check
   goes through the same protected reader. A changed name cannot substitute unchecked
   replacement bytes between the metadata check and the descriptor read. Concurrent
   in-place changes observed by size/metadata checks fail closed.
2. `js/file-access-to-http`: require independent operator-approved API/web origins as
   explicit CLI arguments. Check equality with manifest origins before Docker activity,
   but construct requests only from the independent authority, fixed paths and headers.
   Never put manifest fields, file bytes, digests or credentials into outbound probes.
   No automatic manifest-derived defaults; no redirects or credentialed HTTP transport.
   The origins remain configurable without inventing a hosting provider or target.
3. Codex review 4116461560: force container recreation on application apply so that an
   unchanged image with an authorized rotated environment file loads the new values.
   No volume renewal/deletion is introduced. A single replica can briefly be unavailable.
4. Require the official GitHub Advanced Security result (application ID 57789), not
   just the Actions analysis job. Reject failed/pending/skipped/missing results, alert
   annotations, wrong source/PR/publisher, old analysis results and collection races.
   The read-only collector performs a second result read on the same final source.

No CodeQL queries, paths, severities or required workflows are disabled, excluded or
suppressed. No alert is dismissed as a substitute for a code repair. Final confirmation
must come from the new head's actual security-result check, not from this document.

## Executed local evidence

The downloaded source archive was checked against its SHA-256, embedded source SHA,
and a reconstructed Git tree equal to the parent tree above. The unchanged baseline
passed 198/198 dependency-free tests. After this repair:

- PASS: 93/93 staging/preflight tests, including 21 additional regression cases.
- PASS: 238/238 combined governance/runtime/development-preflight/staging tests,
  including 19 additional security-result acceptance cases; zero failures or skips.
- PASS: governance registry/ownership checks, declaration-only runtime check, and
  whitespace validation. The unchanged runtime pin is Node 24.21.0.

Commands executed on available Linux Node 22.16.0:

```text
node --test .github/scripts/*.test.mjs scripts/runtime/*.test.cjs scripts/dev/*.test.cjs infra/production/check-runtime.test.cjs infra/production/staging.test.cjs
node .github/scripts/production-governance.mjs
node .github/scripts/release-baseline.mjs
node scripts/runtime/toolchain.cjs --declarations
git diff --check
```

File-descriptor tests operate on actual disposable files, including a pathname swap
and post-check growth. CLI rejection tests execute the real launcher without Docker
in PATH. Orchestration and HTTP unit tests use explicit test doubles; they do not claim
an actual deployment, real SMTP delivery, physical DB grants or a hosted TLS journey.
There was no local Docker, Chromium, full dependency install or local CodeQL execution.
Node 24 Windows/Linux and full application/image/browser regressions must be reviewed
on the exact uploaded head through the existing hosted workflows.

## Acceptance and operational limits

After upload, record the actual final SHA and separate CodeQL security-result check,
plus current CI, CodeQL analysis, governance, startup and staging-boundary runs in the
PR. Pending, failed and missing results remain non-PASS. No prior-head workflow result
is reusable as final-head evidence.

The independent origins must come from a trusted operator's reviewed target inputs,
not an untrusted web request or an automatic echo of release-file values. Keep secret
files and their parent directories under trusted ownership. Descriptor consistency is
not an OS-level sandbox against a hostile deployment host, and separate Docker mounts
still require no concurrent secret rotation. Windows ACL validation remains operational.
Actual staging and effective branch protection are not certified by this repair.

## Primary references

- CodeQL: https://codeql.github.com/codeql-query-help/javascript/js-file-system-race/
- CodeQL: https://codeql.github.com/codeql-query-help/javascript/js-file-access-to-http/
- Node.js file descriptors: https://nodejs.org/docs/latest-v22.x/api/fs.html
