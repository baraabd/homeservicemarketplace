# R26 — application security implementation

Status: IMPLEMENTED, local unit/type/build source verification complete; INTEGRATION_PENDING and EXTERNAL_BLOCKED. This is a review candidate, not release acceptance. Mode A; no product redesign, merge or deployment.

## Source and authority

Frozen G1 runtime source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`, tree `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`. The owner merged acceptance PRs #170 and #171. This branch starts at published coordination base `0568739096ceeaf0cfc79034626886e258fe4328`; runtime paths are identical to frozen G1. Exact ownership and the serialized shared-file lease are in [OWNERSHIP.md](OWNERSHIP.md). Other Wave 2 lanes remain held for their own handoff.

The final published commit is the PR's `Final SHA`, checked against the live head by existing governance. R26 CI checks out that same head and puts it in `boundaries.json` and `browser.json`; the built HTML additionally has a SHA-256 digest. A document cannot contain its own final Git commit SHA. No unmerged peer implementation is consumed.

## Reproduced defects and changes

| Finding       | Before                                                                                                                             | Remediation and regression                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R26-HTTP-01   | Raw Express parser errors reached generic error handling as 500; Nest may expose a JSON syntax message containing submitted bytes. | Translate recognized parser type/status pairs before Nest wraps them. Safe 400/413/415 responses, retaining existing 1 MiB JSON, 256 KiB signed feedback and 10 MiB raw media caps. Tests exercise both production and development redaction and legitimate raw bytes.         |
| R26-HTTP-02   | An early parser failure could reflect an arbitrary request-ID header before normal request middleware bounded it.                  | Reuse the existing safe correlation-ID validator in the exception filter. An unbounded ID is omitted.                                                                                                                                                                          |
| R26-CSP-01    | The web edge policy was report-only, allowed broad schemes, and did not establish an enforced browser boundary.                    | Build-bound enforced CSP metadata precedes resource loading. Exact API/WS origins and optional explicit media/upload origins; no wildcard, remote script, inline script or eval allowance. Browser tests require actual CSP violation events and actual PDF/gallery rendering. |
| R26-CONFIG-01 | Bootstrap collected raw CORS configuration without central canonical validation.                                                   | Validate exact HTTP(S) origins, reject credentials/path/query/fragment/wildcards/backslashes, canonicalize and deduplicate. Existing hardened HTTPS runtime validation remains in force.                                                                                       |

No migrations, schema, dependencies, lockfile, permissions, contracts or money policy change. Existing API responses keep their envelope; malformed/oversized/unsupported bodies now get their correct client-error statuses rather than 500. No new public domain endpoint is introduced.

## Enforced browser topology

`VITE_API_URL` must be an exact HTTPS origin; HTTP is allowed only for loopback acceptance. `VITE_CSP_MEDIA_ORIGINS` and `VITE_CSP_UPLOAD_ORIGINS` accept at most 20 explicit comma-separated HTTPS origins. Docker exposes these public build arguments; they are not secrets. Operators must supply their actual approved storage/CDN origins before building. There is no inferred hosted deployment approval.

Scripts and workers are self-hosted. Identity PDFs retain the existing bounded PDF.js canvas renderer with scripting/eval/XFA and auxiliary network retrieval disabled. `blob:` is allowed for images/media, not scripts or frames. Existing Google Fonts origins, four exact OpenStreetMap tile hosts and the existing Nominatim API origin are explicit. Existing React inline **styles** remain allowed; this does not allow inline scripts.

The meta policy travels with the built HTML across Vite preview, Vercel and nginx. Meta cannot enforce framing ancestors, so Vercel/nginx emit the separate enforced `frame-ancestors 'none'; object-src 'none'; base-uri 'none'` header and DENY framing header. nginx repeats security headers in cache-header locations because location-level `add_header` replaces inherited headers. Vercel's disabled deployment setting is preserved. See [W3C CSP3](https://www.w3.org/TR/CSP3/#meta-element) for meta delivery limitations.

## Existing controls inspected and retained

- IAM: HttpOnly access/refresh cookies, strict refresh path and SameSite policy, double-submit CSRF on cookie mutations, server-side session revocation, permission guards and R18 last-active-admin protection. No authority is inferred from UI visibility.
- Private media: authorized reads, uniform not-found identity policy, no-store/nosniff, bounded stream/file validation and restricted storage. Browser acceptance uploads synthetic bytes through public authenticated APIs; it never writes database scan status or grants account authority.
- Money: existing admin financial summaries/bookings/earnings remain admin-only. R19 subscription-money component/integration coverage remains in the full suite. R24 money review/receipt HTTP interfaces are not present in frozen G1 and cannot be accepted by testing a nonexistent route.
- Disputes/support: owner-scoped reads, command guards, idempotency/revision and immutable history remain unchanged; independent-session denials assert no write.
- Metrics/throttling/redaction: protected metrics guard, Redis-backed production rate limiting and failure-closed behavior, registration/OTP limits, logger privacy tests. No limiter ceiling was raised by R26.
- Images: API `USER app`, web `USER nginx`, separate migrator, no API npm/compiler toolchain, scoped writable storage. Actual image build/boot/scanning proof belongs to final-head CI, not this source inspection. Remaining writable API application ownership is tracked in RISKS.

## Acceptance implementation

The new job owns disposable Postgres `r26_security_ci`, Redis service, SMTP catcher, `/tmp/r26-restricted`, API 4326 and web 5326. Independent browser contexts isolate cookies; ports alone are not cookie isolation. Existing real-AppModule integration fixtures use scoped rows and advisory locks; their mail/scanner adapters are component fixtures. Browser journeys use real SMTP/OTP, compiled API and a production web build, with test scanning explicitly identified. The loopback API uses development configuration; this does not attest hosted HTTPS/production cookies or ClamAV.

Metrics acceptance uses a generated ephemeral token with both denied and authorized scrapes. Existing CI/CodeQL/security gates are retained. R26 adds two independently runnable browser scenarios with two workers and zero retries, five real database authorization cases and 18 build-policy regressions. Raw traces, cookies, request bodies and identity files are not published. Only synthetic preview screenshots and sanitized source-bound JSON are retained.
