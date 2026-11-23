# K03 — Web image identity evidence (local)

**Scope: local Docker Desktop (engine 29.1.3), synthetic origin
`https://api.example.test`.** No registry push and no digest-pinned provenance.
Image IDs are local content IDs, not registry digests.

Each image was built from a clean `git archive` of the stated commit, not from a
working tree.

## 1. Defect reproduced on the base

Base `92770ea65ee1154f94f4251d5febfa39822f9b9a`, built with
`--build-arg VITE_STRIPE_SANDBOX_ENABLED=true`. Docker printed no warning.

| Observation       | Value                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Image ID          | `sha256:f24def5f927df208063002249b68f206cb94216dd42e29217a6930151dc4033a`                                             |
| Document CSP      | `script-src 'self'` · `connect-src … (no api.stripe.com)` · `frame-src 'none'`                                        |
| `build-info.json` | `{"sourceSha":"92770ea6…","apiUrl":"https://api.example.test","onboardingV2":false}` (no flag recorded)               |
| Labels            | revision and `io.hsm.web.api-url` only                                                                                |
| Chromium 390×844  | Injecting `https://js.stripe.com/v3` as `loadStripe` does: **blocked** (`script-src-elem`), `window.Stripe` undefined |

## 2. Fixed image, both explicit states

Built from commit `e4458df34bceebccf0dd8126477bb90cdade4b48`. That commit contains
the Dockerfile and identity fix. The later code commits do not change the web build
inputs: they add a header-CSP check to the launcher and the smoke, and leave
`nginx.conf` unchanged. Final-SHA images are rebuilt by the `Staging image
boundaries` CI job on the PR.

| State   | Fingerprint                                                        | Image ID                   | Document CSP (excerpt)                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `false` | `c87ba282bb0185d89820f1d3980bcaf67f7625af3322ece4f7d92cf0af58c383` | `sha256:c94902ff…f33a726`  | `script-src 'self'`; `frame-src 'none'`; no Stripe                                                                                                                                                   |
| `true`  | `01dd38d457aa41dafa9a3aa8b10c34107b8b0839bb7707c903e8b4e9dbf2f9e5` | `sha256:6a40d237…456d63f2` | `script-src 'self' https://js.stripe.com https://*.js.stripe.com`; `connect-src … https://api.stripe.com`; `frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com` |

Full labels are in `web-image-labels.json`. Full build identities are in
`build-info-stripe-{false,true}.json`.

For each state:

- `infra/production/web-image-smoke.cjs` passed;
- the container ran as uid 101;
- the web root was not writable;
- the read-only, `cap-drop=ALL` boot succeeded.

Chromium on the served document:

| Image                            | Stripe.js | `window.Stripe` | CSP violations |
| -------------------------------- | --------- | --------------- | -------------- |
| base `92770ea6`, built with flag | blocked   | no              | 1              |
| K03 `stripeSandbox=false`        | blocked   | no              | 1 (intended)   |
| K03 `stripeSandbox=true`         | loaded    | yes             | 0              |

The SPA mounted and showed its loading state, waiting on the unreachable synthetic
API. This proves the bundle boots under each policy. It is **not** checkout or
visual acceptance: the Payment Element needs a sandbox API with
`MONEY_STRIPE_PUBLISHABLE_KEY` (BLOCKED).

## 3. Negative builds (fail closed)

| Input                                              | Result                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_STRIPE_SANDBOX_ENABLED` omitted              | exit 1, `WEB_IMAGE_INPUT_REQUIRED: VITE_STRIPE_SANDBOX_ENABLED`                                                                    |
| `VITE_STRIPE_SANDBOX_ENABLED=TRUE`                 | exit 1, `WEB_IMAGE_INPUT_INVALID: VITE_STRIPE_SANDBOX_ENABLED`. The first attempt failed on a Docker Hub TLS timeout and was rerun |
| Fingerprint of the `false` config with flag `true` | exit 1, `WEB_IMAGE_CONFIG_FINGERPRINT_MISMATCH`                                                                                    |
| `SOURCE_SHA` empty                                 | exit 1, `WEB_IMAGE_INPUT_REQUIRED: SOURCE_SHA`                                                                                     |

## 4. Not produced locally

- Final-SHA (`5fd98555`) image rebuild: a host low-memory reaper stopped it during
  the first build. No result was recorded.
- API runner image preflight smoke, including the new `--release` assertions: the
  build was stopped twice (once superseded, once by the memory reaper). It is covered
  by CI `Staging image boundaries` on the pushed SHA.
- Registry digests, buildx provenance and SBOM: no registry is approved.
