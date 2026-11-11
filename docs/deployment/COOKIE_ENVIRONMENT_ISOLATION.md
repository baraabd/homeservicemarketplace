# Cookie namespaces across environments

Set the API `AUTH_COOKIE_PREFIX` and web build `VITE_AUTH_COOKIE_PREFIX` to the
same value. Both default to `hsm`; valid values match
`^[a-z][a-z0-9_]{0,31}$`. Invalid values fail API configuration or the web build.

| Environment | API and web prefix       | Cookie names                                           |
| ----------- | ------------------------ | ------------------------------------------------------ |
| Production  | `hsm` (existing default) | `hsm_at`, `hsm_rt`, `hsm_csrf`                         |
| Staging     | `hsm_staging`            | `hsm_staging_at`, `hsm_staging_rt`, `hsm_staging_csrf` |

The server selects only its configured access, refresh and CSRF cookies for
HTTP, WebSocket and SSE requests. The web app echoes only its configured CSRF
cookie. Logout expires only that namespace. Security flags, refresh cookie
path, bearer transport handling and server session validation are unchanged.
There is no fallback to another environment's cookies.

Deploy matching web and API settings together. Changing a prefix in an
existing environment means its browser users must sign in again; retaining
the production default avoids changing existing production sessions.

Distinct names prevent session selection and CSRF collisions when a browser
sends both parent-domain production cookies and narrower staging cookies.
They do not change domain scope: `.findservice.site` cookies can still be
sent to subdomains such as `api.staging.findservice.site`. A separate
registrable staging domain or a separately reviewed host-only cookie design
is required for a stronger confidentiality boundary.
