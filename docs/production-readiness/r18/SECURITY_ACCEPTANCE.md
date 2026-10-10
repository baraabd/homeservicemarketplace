# R18 — Security acceptance

Source: `develop@fabeb07` post-merge runs and the GitHub code-scanning API,
read on 2026-10-10. The R18 head re-runs the same jobs; its results are
recorded in the PR.

## Scans

| Control                                                  | Where                                                     | Result on `fabeb07`             |
| -------------------------------------------------------- | --------------------------------------------------------- | ------------------------------- |
| Full dependency audit (zero at every severity)           | CI `Dependency, secret, and container scans`              | success                         |
| Production dependency audit                              | same job                                                  | success                         |
| gitleaks over history                                    | same job (`Secret scan`)                                  | success                         |
| gitleaks over the exact tracked tree                     | same job                                                  | success                         |
| SBOM (CycloneDX, API image)                              | same job, artifact `sbom` (`hsm-api-sbom.cyclonedx.json`) | generated                       |
| Container image scan (fail on unmitigated CRITICAL/HIGH) | same job                                                  | success                         |
| CodeQL `Analyze JavaScript/TypeScript`                   | CodeQL workflow run 38076416622                           | success (the run); alerts below |
| Docker cold build, non-root, graceful SIGTERM            | CI `Docker cold build + production boot`                  | success                         |
| Production runtime configuration checks                  | `Production governance`, `Staging release boundary`       | success                         |
| GitHub secret scanning                                   | repository setting                                        | **disabled** (R18-O2, P2)       |

## Open CodeQL alerts on `develop`

| #   | Severity | Rule                                            | Location                                                                | Disposition                                                                                                                                                   |
| --- | -------- | ----------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3   | critical | `js/type-confusion-through-parameter-tampering` | `local-disk-storage.adapter.ts` / `media.controller.ts`                 | **FIXED** by #150; GitHub `fixed_at` 2026-10-10T17:58:58Z                                                                                                     |
| 2   | high     | `js/xss-through-dom`                            | `apps/web/src/app/components/wizard/JobWizardModal.tsx:913`             | **Proposed exception, not yet accepted** (below). Unresolved until the owner approves it                                                                      |
| 13  | medium   | `js/http-to-file-access`                        | `apps/web/e2e/assets/vendor-prototype-assets.mjs:91`                    | test tooling, not shipped; P3                                                                                                                                 |
| 16  | medium   | `js/http-to-file-access`                        | `.github/scripts/pr-acceptance.mjs:194`                                 | CI script writing a GitHub API snapshot; not shipped; P3                                                                                                      |
| 20  | medium   | `js/http-to-file-access`                        | `apps/api/src/infrastructure/storage/local-disk-storage.adapter.ts:145` | the production runtime policy refuses any `STORAGE_DRIVER` but `s3` (`runtime-policy.ts:124`); the presigned PUT is HMAC-verified and type-checked (#150); P2 |

### Proposed exception for CodeQL #2

- Identifier: code-scanning alert #2, `js/xss-through-dom`.
- Severity: high (CodeQL).
- Component: seeker request wizard, media preview (`<img>` line 913, `<video>` line 901).
- Exploitability: `previewUrl` has one writer, `URL.createObjectURL(file)`
  (line 235), for a `File` the user picked in their own browser. The browser
  mints a `blob:` URL bound to the document origin. It cannot be a
  `javascript:` URL, an `<img>`/`<video>` `src` does not execute script, and no
  server or other user supplies the value. The file name appears only as React
  text in `alt`, which React escapes. Not exploitable.
- Compensating control: React attribute escaping; previews are revoked
  (lines 402, 417, 726); uploads are server-validated (type, size, malware
  scan) before they attach to a request.
- Review date: before the first production release, and again if the preview
  code changes.
- Owner: repository owner (approval and the GitHub dismissal are the owner's
  actions; R18 does neither).

## Runtime configuration (fail-closed)

The production configuration is validated by the env schema
(`apps/api/src/config/env.schema.ts`, `env.validation.ts`), the API's
hardened runtime policy (`apps/api/src/config/runtime-policy.ts`, which
refuses to boot on an issue) and the launcher checks
(`infra/production/check-runtime.cjs`, tested in `Production governance`).
Items the task names and where they are enforced:

| Item                                                              | Enforcement                                                                                                                                                                                      | Evidence                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `NODE_ENV=production`, placeholder secrets                        | runtime policy refuses placeholder or low-diversity `JWT_ACCESS_SECRET`, insecure cookies, a `.local` sender and a missing SMTP host; launcher requires `NODE_ENV=production`, `APP_ENV=staging` | `runtime-policy.spec.ts`, `check-runtime.test.cjs`, `staging.test.cjs` |
| Secure, HttpOnly, SameSite cookies; CSRF; refresh/logout          | auth cookie contract                                                                                                                                                                             | CI `Auth cookie contract (real browser + real API)`                    |
| CORS allowlist                                                    | env `CORS_ORIGINS`; launcher requires the exact web origin                                                                                                                                       | `STAGING.md`, runtime checks                                           |
| Rate limiting, OTP limits, session invalidation                   | IAM module                                                                                                                                                                                       | R04 auth lifecycle workflow                                            |
| Private storage, presigned upload validation, malware scan        | media module, evidence-retention worker                                                                                                                                                          | CI `Evidence retention`, `Dispute journey` (ClamAV)                    |
| No public identity bucket                                         | restricted bucket separation in runtime policy                                                                                                                                                   | `Evidence retention` job                                               |
| No debug endpoints, no test mailbox, no QA override in production | not separately re-verified in R18; a hosted check needs the target                                                                                                                               | NOT_RUN                                                                |
| HTTPS redirect, HSTS, TLS                                         | delegated to the approved HTTPS edge (`STAGING.md`); not testable without a hosted target                                                                                                        | HOSTED_ENVIRONMENT_BLOCKED                                             |
| No secrets committed                                              | gitleaks history + tracked tree                                                                                                                                                                  | CI                                                                     |

## Result

- CRITICAL: zero open.
- HIGH: one open (#2) with a proposed, not yet accepted exception. **P1 until the owner decides.**
- Secret leak: none found.
- Production default credentials: refused by the runtime policy (tested in CI); not verifiable on a hosted target.

Status: `SECURITY_ACCEPTANCE_BLOCKED` on CodeQL #2's owner disposition.
