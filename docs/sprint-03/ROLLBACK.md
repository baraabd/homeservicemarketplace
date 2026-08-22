# Sprint 3 — rollback plan

Four classes of change shipped, and they roll back very differently. The
important distinction is between changes that are **reversible by config** (no
deploy), reversible by **revert** (a deploy), and **not reversible at all**.

Ranked by how fast you can undo them:

| Change                          | How to undo                                      | Speed            | Notes                                   |
| ------------------------------- | ------------------------------------------------ | ---------------- | --------------------------------------- |
| CSP                             | `CSP_MODE=off`                                   | env var, restart | No deploy                               |
| HSTS                            | `HSTS_MAX_AGE_SECONDS=0`                         | env var, restart | **Only stops NEW pins** — see below     |
| `/metrics` gate                 | unset `METRICS_TOKEN`                            | env var, restart | Reverts to 404-in-prod, open in dev     |
| Permissions-Policy              | revert commit                                    | deploy           | Header-only, no behaviour depends on it |
| Dependency upgrades             | revert commit + `pnpm install --frozen-lockfile` | deploy           | Lockfile is the source of truth         |
| `ws` override removal           | re-add to `pnpm.overrides`                       | deploy           | Reintroduces a HIGH advisory            |
| CI / Dependabot / CodeQL / SBOM | revert commit                                    | none             | Cannot affect a running system          |

## Header rollout — the one that does not fully roll back

**CSP** is safe. It ships Report-Only, so the worst case is console noise and
report volume; `CSP_MODE=off` removes the header entirely without a deploy.
Flipping to `enforce` is the risky step, and its rollback is the same env var.

**HSTS is different and deserves care.** Setting `HSTS_MAX_AGE_SECONDS=0`
stops the server _sending_ the header, but every browser that already received
it keeps refusing plaintext for the remainder of the max-age it was given.
There is no server-side way to shorten that. The only real mitigation is to
serve `max-age=0` over **HTTPS** for at least as long as the previous value —
which is why the default here is 300 seconds rather than a year, and why the
ramp exists at all. A five-minute mistake ages out over a coffee break; a
31536000 mistake does not.

Practical consequence: do not skip ramp steps, and do not enable
`includeSubDomains` until every subdomain is known to serve TLS, including the
ones nobody remembers. That is the failure this header is famous for.

## Dependency upgrades

All upgrades were within existing major versions and none required an
override. Reverting is `git revert` of the dependency commit followed by
`pnpm install --frozen-lockfile`, which restores the exact prior tree — the
lockfile, not `package.json`, is what pins the build.

Per-group blast radius, worst case:

| Group                   | If it misbehaves                      | Signal                                       |
| ----------------------- | ------------------------------------- | -------------------------------------------- |
| Nest 11.1.17 → 11.2.1   | request handling, DI, guards          | API suite, boot                              |
| mongoose 8.23 → 8.24.4  | draft persistence, health             | mongo suites, `Mongo connection established` |
| qs / body-parser        | query and body parsing on every route | e2e suites                                   |
| AWS SDK 3.1041 → 3.1116 | media presign / upload                | media suites                                 |
| helmet 8.1 → 8.3        | response headers only                 | header suite                                 |

The AWS bump is the one with a real behavioural change worth knowing: 3.1116
no longer depends on `fast-xml-parser` at all (XML moved into `@smithy/core`).
Reverting reintroduces that dependency.

## The `ws` override

Removing it is a one-line edit and a reinstall — and it puts a HIGH advisory
back in the production tree, failing the audit gate. That is the intended
behaviour, not an obstacle to work around. If it must come out temporarily,
the exception in `docs/sprint-03/EXCEPTIONS.md` (E-1) is the record of why it
was there and what has to be true to remove it permanently.

## `/metrics`

Unsetting `METRICS_TOKEN` returns the endpoint to: open outside production,
404 inside it. It does **not** return to the pre-sprint state of "open
everywhere" — that behaviour is gone deliberately, and restoring it requires
reverting the guard commit.

Health probes were never coupled to this. They are on `/health/live` and
`/health/ready`, served by a different controller, and the guard is mounted
only on the metrics controller. Verified at runtime: probes returned 200 while
`/metrics` returned 404.

## Deployment topology (ADR 0001)

Nothing in this sprint changed the cookie contract, so no rollback applies.
The ADR documents a constraint that already existed and was previously
undocumented: `hsm_rt` and `hsm_csrf` are `SameSite=Strict`, so a cross-domain
web/API split has no working session. If a deployment is currently broken in
that way, the fix is topology (a `/v1/*` rewrite, or sibling hosts under one
registrable domain), not a revert of this sprint.

## Verification after any rollback

```bash
pnpm --filter @homeservicemarketplace/api test          # gates off: fast
pnpm --filter @homeservicemarketplace/web test
pnpm audit --prod --audit-level high                    # must exit 0
```

Plus, if headers or cookies were touched, the two runtime checks that only a
real server and a real browser can give you:

```bash
curl -sD - -o /dev/null http://127.0.0.1:PORT/health/live | grep -iE 'content-security|strict-transport|permissions-policy'
E2E_REAL_API=http://127.0.0.1:4010 pnpm --filter @homeservicemarketplace/web exec \
  playwright test e2e/auth-cookies.spec.ts --project=chromium-desktop
```
