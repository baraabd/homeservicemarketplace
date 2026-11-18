# picomatch 4.0.7 — repository-owned security fork

## Why it exists

The full dependency audit fails on [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
(CVE-2026-112366, high): a repeated extglob containing a wildcard, such as
`+(*a)`, compiles to nested unbounded quantifiers and can block the event loop.
The npm registry was checked on 2026-11-18: the latest release is 4.0.7 and the
advisory has no patched release. This is a repository-maintained mitigation,
not a claim that upstream has released a fix.

This directory retains the 4.x API and uses the published **4.0.7** tarball.
Separate 2.x and 4.x forks avoid silently upgrading Jest's legacy consumers
across a major version. Upstream source files and the MIT license are retained;
`upstream-sha256.json` records each file's SHA-256 as published. The original
README is `UPSTREAM-README.md`. The manifest adds `private: true`, an explicit
fork version, and removes unused upstream development scripts/dependencies.

The JavaScript and Markdown files are formatted with the repository formatter.
Unused catch bindings, a redundant navigator lint directive and an unused
initial value are removed; the legacy unused platform argument is explicitly
consumed with `void`. These cleanup edits do not change matching behavior.
The MIT license remains byte-for-byte unchanged.

## Security change

`lib/parse.js` adds `hasRepeatedWildcard()` before `analyzeRepeatedExtglob()`.
It detects unescaped wildcard stars in repeated extglob bodies, including
single branches, while preserving quoted stars and stars in character classes.
The existing risky-extglob path then compiles the whole repeated group as a
literal. This also applies when `maxExtglobRecursion: false` is requested: the
recursion option cannot disable this security guard.

Compatibility change: unsafe repeated wildcard groups are treated literally.
Ordinary `*.ts`, `**/*.ts`, brace expansion, negation and non-repeated extglobs
keep their behavior. Already-safe nested literal extglobs retain upstream's
existing handling. This patch addresses the cited advisory; it does not claim
to make every arbitrary regular-expression feature safe for untrusted inputs.

CodeQL also identified an existing quadratic regex in `removeBackslashes()`.
The fork replaces that helper with a linear scan that preserves bracket
expressions and JavaScript line-terminator behavior. Differential testing
against the official helper matched all 335,923 strings of up to seven
characters over the bracket/backslash/letter/line-break alphabet. A bounded
public `scan()` regression reproduces the upstream timeout on 100,000 escaped
opening brackets and completes with the replacement.

## Verification

`node --test scripts/security/picomatch-redos.test.cjs` checks both forks,
literal/escaped character compatibility, and attack inputs in child processes
with a hard timeout. The unfixed 4.0.7 tarball times out in the same child test;
the patched forks complete. To reproduce against an upstream checkout:

```sh
PICOMATCH_UNDER_TEST=/absolute/path/to/unfixed/package \
  node --test --test-name-pattern='bounded subprocess' scripts/security/picomatch-redos.test.cjs
```

`scripts/security/vendored-forks.test.cjs` also checks the actual dependency
resolution and rejects any remaining vulnerable registry picomatch package.
The audit command and zero-finding policy are unchanged; no advisory is muted.

## Exit criterion

Replace these forks with official releases when upstream publishes a fix
outside the advisory's affected range for all required major versions, or when
no consumer requires the affected packages. Remove the matching overrides,
reinstall, run the exploit/compatibility tests and the full dependency audit,
and verify actual Jest, lint, build and watcher consumers still work.
