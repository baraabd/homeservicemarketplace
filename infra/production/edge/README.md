# R28 — Prepared HTTPS edge policy

Status: **CONFIGURATION_ONLY — no edge configured or applied**.

`edge-policy.json` defines a checked reference for the operator-managed topology in
[`../STAGING.md`](../STAGING.md), alongside
[`../platform/topology.json`](../platform/topology.json). It is policy data, not an
NGINX/Caddy/cloud configuration, certificate, domain registration, or deployment
script. The selected origin and certificate/evidence references remain null. The
platform schema validates it through `#/$defs/edgePolicy`.

No hosting vendor or new edge product is selected. A future adapter must translate
these declarations for the owner's actual edge version and pass that product's syntax
and behavior checks. There is no generated Compose overlay, alternate launcher or
implicit deploy-on-merge behavior.

## Offline validation and status

The platform checker loads the committed policy by default. A complete declaration
fixture can use external JSON files without filling the committed null template:

```sh
node scripts/production/platform/validate-plan.cjs --check
node scripts/production/platform/validate-plan.cjs --check /secure/reviewed-plan.json --edge-policy /secure/reviewed-edge.json --require-target
```

The second example remains read-only. Independent `--api-origin` and `--web-origin`
inputs are required to complete the target declaration. The reviewer supplies both
from independently authorized target information; do not copy unreviewed values into
authorization arguments automatically. `--expected-plan-sha` checks a previously
reviewed fingerprint of plan **plus policy plus schema**. All successful reports stay
`CONFIGURATION_ONLY`, `deploymentStarted: false`, `authorizationVerified: false`.
A reference string is not a verified approval, applied configuration or browser test.

The checker validates canonical HTTPS origins, including any `csp.extraAssetOrigins`.
Do not supply scripts, shell fragments, wildcard hosts, credentials, paths, queries,
fragments, whitespace, or semicolon-separated directives in these fields. There is
no raw-template, arbitrary-header or command field.

## One origin and the existing cookie contract

The reference is one canonical HTTPS origin for both web and API. `release.apiOrigin`,
`release.webOrigin`, `edgePolicy.origin` and both independent origin inputs must agree.
Preserve the versioned API path; `VITE_API_URL` is the origin without `/v1`.

ADR [`0001-web-api-deployment-topology`](../../../docs/adr/0001-web-api-deployment-topology.md)
requires a same-site deployment. The current refresh and CSRF cookies always use
`SameSite=Strict`. Unrelated registrable domains do not support the current session
contract. Same-origin keeps `COOKIE_DOMAIN` unset and narrows exposure. The sibling
host topology described by that ADR is not implemented by this R28 reference and
needs a reviewed variant, cookie-domain decision and browser acceptance.

| Cookie behavior        | Edge requirement                                                               |
| ---------------------- | ------------------------------------------------------------------------------ |
| `hsm_at`               | Preserve API-owned HttpOnly, secure and SameSite attributes                    |
| `hsm_rt`               | Preserve HttpOnly, Secure, `SameSite=Strict`, exact `/v1/auth/refresh` path    |
| `hsm_csrf`             | Preserve Secure and `SameSite=Strict`; keep readable by same-origin JavaScript |
| Every `Set-Cookie`     | Forward intact; do not collapse headers or rewrite domain/path                 |
| Authentication headers | Forward unchanged to the API; never log or cache them                          |

A successful unauthenticated `/v1/auth/me` CORS probe does not establish login, refresh,
CSRF, logout, or browser privacy behavior. R35/R37 must exercise the real deployed
bundle and persisted session. Domain/cookie changes remain the owning security lane's
work.

## Routing and public exposure

More specific entries precede the SPA fallback. Preserve paths without stripping
`/v1`; unknown API paths return API errors, not an HTML 200.

| Incoming path                      | Target                | Response/cache behavior                                                             |
| ---------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `/v1/me/events`                    | API SSE stream        | No buffering, caching or stream compression                                         |
| `/socket.io/`                      | API Socket.IO         | HTTP polling and WebSocket upgrades; no caching                                     |
| `/v1/`                             | API                   | Preserve raw upload/webhook bytes, methods and application headers; no edge caching |
| `/health/live`, `/health/ready`    | API                   | No caching; preserve actual status and source/readiness payload                     |
| `/metrics` and its prefix variants | Denied at public edge | Private authenticated scraper only                                                  |
| `/build-info.json`                 | Static web            | No caching; exact built source/API-origin/V2 metadata                               |
| Remaining web routes               | Existing static web   | Preserve `apps/web/nginx.conf` asset and SPA rules                                  |

The API/web loopback ports and management services must not be publicly reachable.
Network inspection must also deny public DB, Redis, ClamAV, Docker daemon, worker
readiness and monitoring access. Do not add a broad `/health/*` or `/metrics*` public
proxy to make tooling convenient. A public health response is intentionally minimal;
mail/storage/scanner diagnostics remain separate from process liveness/readiness.

The adapter must define non-success behavior for a bare `/v1` and ensure normalized,
encoded or slash variants cannot fall into a cacheable authenticated-media route.
It must preserve the source's byte limits and signature contracts: the API has a
256 KiB raw mail-feedback parser, a 10 MiB raw upload parser and a 1 MiB JSON parser.
Target product limits must permit those legitimate requests and reject excess sizes.
No target-specific request-size configuration has been applied by this policy.

## TLS and proxy trust

Require TLS 1.2 or newer and normal certificate/hostname verification. Certificates,
renewal ownership, chain and selected edge version need actual target evidence.
No `-k`, disabled TLS verification, client-supplied upstream or redirect acceptance
is introduced.

The proposed HSTS rollout is 300 seconds, with no `includeSubDomains` or preload.
Widening HSTS affects other hosts and remains an owner decision. Verify that security
headers also cover error responses; a valid port-443 listener alone is not a TLS or
header acceptance result.

This reference has one controlled host-local edge and `TRUST_PROXY_HOPS=1`. It must
overwrite forwarded client/protocol headers from observed connection facts, rather
than trust an arbitrary client chain. Prevent direct API access; otherwise a client
could bypass the edge's Origin rules or forge the trusted hop. Extra CDNs, ingress
layers or load balancers require a reviewed hop-count/network model before use.

## CSP, CORS and browser capabilities

Both API and web CSP are proposed as **enforced**. API directives remain owned by
`apps/api/src/infrastructure/http/security-headers.ts`; do not apply that JSON-only
API deny-all policy to the SPA.

The web policy permits its own scripts and no unsafe script evaluation. Existing
`fonts.css` loads Google Fonts: the two exact Google stylesheet/font origins are
listed. Inline styles are retained because the frozen web app and startup HTML use
them; this allowance is not permission for inline scripts or `unsafe-eval`.
`connectSources` names the approved HTTPS and corresponding WSS origin as semantic
markers. A future adapter must resolve them into exact CSP sources; emitting those
marker strings verbatim is not a valid implementation. Include the existing necessary
`base-uri`, `object-src`, `frame-ancestors`, worker/media and form directives in the
reviewed adapter. `extraAssetOrigins` starts empty and may contain only reviewed exact
HTTPS origins. Do not replace it with generic `https:` or `wss:` sources.

CSP source inventory and a real AR/EN/mobile browser pass remain R26/coordinator
integration evidence. An empty `integrationEvidenceRef` cannot be turned into a claim
that every map, image, font or worker works under enforcement. Adding an asset origin
changes the reviewed plan hash. Keep private media behind the API regardless of CSP.

The API remains authoritative for REST CORS and CSRF. Forward the actual Origin
unchanged, reject literal `Origin: null` and unexpected nonempty origins, and never
reflect arbitrary origins with credentials. Avoid adding duplicate CORS headers at
the edge. Same-origin polling GET requests may omit Origin, so the policy permits a
missing Origin for non-upgrade requests; browser WebSocket upgrades require the exact
approved origin. This exception does not skip session, cookie or CSRF checks at the API.

## Both realtime transports and current limits

The frozen client and gateway use Socket.IO 4 with both `websocket` and `polling`.
The default path is `/socket.io/`, outside `/v1`. Preserve HTTP/1.1 upstream upgrade
handling and the `Upgrade`/`Connection` headers on that route. A reviewed adapter
must distinguish ordinary polling from upgrade requests and forward credentials to
the unchanged server-owned session/room checks.

The policy proposes a 75-second upstream read timeout, exceeding the Socket.IO
45-second default heartbeat sum. Verify the **actual** server heartbeat settings
when integrating a selected edge version. A shorter load-balancer/CDN timeout
elsewhere in the path can still close connections. Test forced polling as well as
WebSocket upgrade; successful WebSocket delivery does not prove the fallback.

SSE `/v1/me/events` must stream immediately with proxy buffering, caching and
compression disabled. Preserve event data, type, ID and reconnect headers. At G1 the
publisher is an in-process `EventEmitter`; no heartbeat, replay or cross-instance SSE
bus is implemented. Idle connections can close and reconnect, and no durable SSE
replay guarantee is inferred from an `id` field. Edge settings cannot fix this.

`apiReplicas` remains one and `multiInstanceStatus` remains
`R25_INTEGRATION_PENDING`. The fixed Redis channel prefix also requires isolated
instances across environments. Multi-server Socket.IO polling needs session affinity;
that does not make the in-process SSE publisher cross-instance. Consume R25/R26 only
through the coordinator's accepted integration, then repeat revocation, disconnect,
reconnect, polling, SSE and isolation tests on the integrated target.

## Restricted media and cache policy

Reuse the R20 storage authority. Only `requests/` and `avatars/` may be CDN prefixes.
`verification/`, `portfolio-staging/` and moderated `portfolio/` must not be mapped to
a CDN or public bucket read. Approved portfolio bytes still require the API's current
moderation check; otherwise an unpublished image can remain publicly accessible.

Never cache authenticated API or private-media responses, strip authorization/cookies,
expose a signed restricted URL, or make a restricted bucket public to pass a smoke.
Preserve the API's `no-store`, content type, content disposition and authorization
outcomes. Test owner, authorized reviewer, unrelated account, unauthenticated client,
held/unclean evidence and withdrawn portfolio states using synthetic approved data.

## Adapter and hosted acceptance handoff

A future **coordinator-owned** adapter for the selected edge must:

1. Render only validated typed fields and approved exact origins; no raw directives.
2. Pin/record the actual edge product version and configuration hash.
3. Pass that product's syntax test and inspect its effective configuration privately.
4. Prove exact route/byte forwarding, Origin denial, cookies, enforced CSP and TLS.
5. Verify SSE chunk timing, no private caching, WebSocket upgrade and forced polling.
6. Show denied public management/DB/Redis/scanner access and correct trusted proxy IPs.
7. Bind sanitized evidence to plan hash, accepted source SHA and immutable images.

A syntax pass is not hosted acceptance. Missing certificates, account/region/resource
and spending authorization, target rules, R25/R26 integration, real inbox delivery,
storage/scanner/worker tests or browser evidence remain explicit blockers. The
existing `staging.cjs` launcher still owns any separately authorized application
rollout and continues to report `DEPLOYED_NOT_ACCEPTED` until broader acceptance.

## Primary documentation checked 2026-10-17

- [NGINX WebSocket proxying](https://nginx.org/en/docs/http/websocket.html): explicit
  forwarding of hop-by-hop upgrade headers and idle-timeout behavior.
- [NGINX proxy buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering):
  buffering must be disabled for immediate response streaming.
- [Socket.IO 4 reverse proxy configuration](https://socket.io/docs/v4/reverse-proxy/):
  timeout must exceed the heartbeat interval plus timeout.
- [Socket.IO 4 multiple nodes](https://socket.io/docs/v4/using-multiple-nodes/):
  HTTP polling requests belonging to one session must reach the same process.

These are reference semantics, not a selected edge installation or evidence that the
current target uses any particular version.
