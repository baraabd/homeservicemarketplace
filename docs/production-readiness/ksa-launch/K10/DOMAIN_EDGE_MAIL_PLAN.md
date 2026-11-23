# K10 — Domain, edge and mail plan (proposal, not applied)

Status: **PROPOSAL**. No domain is approved, so `<DOMAIN>` is a placeholder
throughout. Do not substitute a guessed or available-looking name. Nothing
here was registered, purchased, published or applied.

## 1. Registrar, registrant and ownership controls

Owner-supplied inputs (none present today):

- the exact approved domain (for example a `.sa`/`.com.sa` name or the
  Arabic IDN TLD);
- the registrant legal entity and its Saudi eligibility basis (for example
  commercial registration or trademark), as SaudiNIC's current regulations
  require;
- the SaudiNIC-accredited registrar and the account holder.

Verify these against SaudiNIC's **current** published registration rules and
registrar list at execution time. The repository does not encode them, and this
plan does not assert them from memory.

Before any DNS change, verify and record:

| Control                   | Evidence to record                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Registrant matches entity | Registrar WHOIS/RDAP or registry record shows the approved operating entity                   |
| Registrar is accredited   | Registrar appears on SaudiNIC's current accredited list                                       |
| Account access            | At least two named owner-side admins with MFA; no personal-only account                       |
| Transfer lock             | Registrar lock enabled                                                                        |
| Renewal                   | Expiry date ≥ 12 months out, auto-renew on, renewal payment owner named                       |
| Nameservers               | Authoritative NS recorded; the DNS host is owner-controlled                                   |
| DNSSEC                    | Decision recorded (enable if the DNS host and registrar support it; otherwise record why not) |

## 2. Topology decision (required before records)

The existing security contract is **same-origin**. ADR 0001 and
`infra/production/edge/README.md` establish it: one HTTPS origin serves the SPA
and proxies `/v1/`, `/v1/me/events` and `/socket.io/` to the API. `COOKIE_DOMAIN`
stays unset, so cookies are host-only. Refresh and CSRF cookies are
`SameSite=Strict`. The platform validator requires `release.apiOrigin ==
release.webOrigin == edgePolicy.origin`.

The K10 brief also lists "app, API and staging subdomains". A separate
`api.<DOMAIN>` origin is **not implemented**. It would need all of the following:

- a reviewed sibling-host edge variant;
- a cookie-domain decision;
- credentialed CORS between the hosts;
- validator changes;
- browser acceptance.

That is K03/R28-owned source, not a K10 DNS edit.

**Recommendation (to approve):** launch same-origin on `www.<DOMAIN>`. Use
`staging.<DOMAIN>` as a separate same-origin staging host. Do not set
`COOKIE_DOMAIN` in either environment, so staging and production sessions
never share cookies. Defer `api.<DOMAIN>` unless the owner requires it. If
they do, the sibling variant becomes a K03 change request.

## 3. Proposed DNS records

Values in `<…>` come from the approved edge, mail provider and CA. Do not
invent them.

| Name                                  | Type              | Value                                                                 | TTL (steady) | Purpose                                                                     |
| ------------------------------------- | ----------------- | --------------------------------------------------------------------- | -----------: | --------------------------------------------------------------------------- |
| `www.<DOMAIN>`                        | CNAME or A/AAAA   | `<production edge target>`                                            |         3600 | Canonical production origin                                                 |
| `<DOMAIN>` (apex)                     | A/AAAA or ALIAS   | `<edge target>`, which serves only a 301 to `https://www.<DOMAIN>/`   |         3600 | Apex redirect                                                               |
| `staging.<DOMAIN>`                    | CNAME or A/AAAA   | `<staging edge target>`                                               |          300 | Staging same-origin host                                                    |
| `<DOMAIN>`                            | CAA               | `0 issue "<approved CA>"`, plus `0 iodef "mailto:<security contact>"` |         3600 | Restrict certificate issuance                                               |
| `mail.<DOMAIN>` (sending subdomain)   | TXT (SPF)         | `v=spf1 include:<provider SPF host> -all`                             |         3600 | Per `email/SENDER_DOMAIN.md`                                                |
| `<selector>._domainkey.mail.<DOMAIN>` | TXT/CNAME         | provider-generated                                                    |         3600 | DKIM                                                                        |
| `_dmarc.mail.<DOMAIN>`                | TXT               | `v=DMARC1; p=none; adkim=s; aspf=r; rua=mailto:<owned mailbox>`       |         3600 | DMARC stage 1. Move to `quarantine`, then `reject`, after reports are clean |
| bounce / custom MAIL FROM             | provider-specific | provider docs                                                         |         3600 | Return-path alignment                                                       |

Change sequence:

1. Record the existing zone export (the rollback baseline).
2. Add CAA, mail and staging records first. None of them affects production
   traffic.
3. At least 48 h before cutover, lower the TTLs of the existing `www` and apex
   records to 300.
4. At cutover, change `www`, then the apex. Verify from at least two public
   resolvers.
5. After the observation window, restore the steady TTLs.

Rollback: restore the previous `www`/apex values from the exported zone. A
300 s TTL bounds propagation. Mail and CAA records stay.

## 4. Edge acceptance checks (on the live candidate)

Each check must pass against the real hostname, not localhost. Do not log any
cookie values or tokens.

| Check                | Expected                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Certificate coverage | Valid chain for `www`, apex and `staging`; expiry ≥ 30 days; auto-renew configured                                                                                                         |
| HTTPS redirect       | `http://` → `https://` (301/308) for every host; apex → `https://www.<DOMAIN>/` preserving path/query                                                                                      |
| HSTS                 | Start at policy `300`s with `includeSubDomains: false`; raise only by a reviewed edge-policy change after the window                                                                       |
| Cookies              | `hsm_rt`: HttpOnly, Secure, `SameSite=Strict`, `Path=/v1/auth/refresh`, no `Domain`. `hsm_csrf`: Secure, Strict, readable. `hsm_at`: HttpOnly, Secure. Every `Set-Cookie` forwarded intact |
| CSRF                 | A state-changing request without a matching CSRF token is rejected                                                                                                                         |
| CORS                 | `CORS_ORIGINS` is exactly `https://www.<DOMAIN>` (and the staging host only in staging). `Origin: null` is rejected. A foreign origin gets no `Access-Control-Allow-Origin`                |
| CSP                  | Enforced on web and API. `connect-src` lists only the approved https/wss origin. Upload, media and payment origins are added only through `csp.extraAssetOrigins` with evidence            |
| WebSocket / SSE      | `/socket.io/` upgrades through the edge. `/v1/me/events` streams. Idle timeouts exceed the heartbeat interval. A reconnect after an edge idle-close recovers                               |
| Deep links           | A direct load and reload of nested SPA routes (customer, provider `provider/*`, admin) return the app shell, not 404                                                                       |
| Cache                | `/v1/`, `/socket.io/`, `/health/*` and `index.html` are uncached. Hashed assets are long-cached and immutable. Authenticated responses are never cached at the edge                        |
| Denied paths         | `/metrics` is not reachable publicly                                                                                                                                                       |
| Identity             | The read-only release identity (web `deployment.json` from PR #204 if merged; API version/health) matches the frozen SHA and digests                                                       |

Validate the declaration offline first, using `node scripts/production/platform/validate-plan.cjs --check <reviewed-plan> --edge-policy <reviewed-edge> --require-target --api-origin https://www.<DOMAIN> --web-origin https://www.<DOMAIN>`.
The reviewer supplies the origins independently.

## 5. Mail acceptance

1. Publish SPF, DKIM, DMARC and the bounce records for the approved provider.
2. Check them with `node scripts/production/email/check-sender-dns.cjs`.
3. Send AUTH and NOTIFICATION probes with `send-acceptance-probe.cjs`, only to
   **owner-designated monitored test mailboxes**.
4. Record SPF/DKIM/DMARC `pass` from the received headers. Record the bilingual
   rendering and that the bounce is handled.

Never mail real customers or providers for acceptance.
