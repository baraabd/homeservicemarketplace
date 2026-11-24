# Login connection and country selection

Operator notes for the 24 November 2026 login change. This document explains
the implemented boundaries and the checks to run on the affected environment;
it does not certify a user's Windows installation, a hosted deployment, or
delivery to a real WhatsApp recipient.

Scope: Mode A, a local usability correction to the shared authentication phone
field and an operator explanation of the existing API connection contract.
Login, signup, recovery and contact enrollment inherit the field change. The
written target is to remove the separate coordinate-sharing card, automatically
suggest the country for empty fields, and preserve manual correction and typed
numbers. Existing role branding, layout outside this card, and server-owned
authentication policy remain the baseline. No schema, migration, endpoint,
provider setting or feature-flag change is required.

## Country suggestion

For a new, empty phone field, the suggestion uses this order:

1. A supported country associated with the device's reported time zone.
2. An explicit country region in a supported browser locale, such as `sv-SE`.
3. Saudi Arabia (`SA`) when neither hint identifies a supported country.

Language alone, such as `ar` or `en`, does not identify a country. The time-zone
mapping is a limited heuristic: device settings can differ from the user's
location or phone subscription. The country and calling code remain a
reversible suggestion, not verified location or proof of phone ownership.

The suggestion needs no location permission, GPS coordinates, IP lookup, or
third-party coordinate request. The phone field's former "Use my location"
GPS/OpenStreetMap card is removed; the manual country dropdown remains available.
Existing drafts and complete international numbers retain their meaning;
shared international prefixes must not acquire an invented country from the
device hint. Changing the interface language does not replace a manual choice.

Sources: [country suggestion](../../apps/web/src/lib/phone-country.ts),
[phone field](../../apps/web/src/app/components/auth/PhoneIdentityField.tsx),
[phone normalization](../../apps/web/src/lib/phone-identity.ts).

## Identify which service is unavailable

The browser reads `GET /v1/auth/config` before authorizing a new sign-in
request. It keeps the default phone form visible while that policy is unknown.

| Displayed state                                                     | Meaning                                                                                                                                                                     | Next check                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `خدمة تسجيل الدخول غير متاحة مؤقتًا. يرجى إعادة المحاولة بعد قليل.` | No fresh, valid authentication policy was obtained. Possible causes include an unreachable API, the wrong origin, CORS, timeout, HTTP failure, or an incompatible response. | Run the connection doctor and inspect the actual request in the browser Network panel. |
| `التحقق عبر واتساب غير متاح مؤقتًا. يرجى المحاولة لاحقًا.`          | The policy is confirmed, WhatsApp is selected, and the API reports `whatsappAvailable: false`.                                                                              | Check the selected provider's backend settings.                                        |

Missing provider configuration alone does not make the public policy fail.
The API can correctly return HTTP 200 with this body:

```json
{ "otpChannel": "whatsapp", "whatsappAvailable": false }
```

`whatsappAvailable` describes local provider configuration, not live provider
authorization or a delivery receipt. An unavailable settings database or an
invalid saved channel is not silently treated as an absent preference.

The send action is disabled and guarded while policy is unconfirmed, and when
WhatsApp is selected but unavailable. A screenshot of that state cannot identify
the underlying network failure.

Sources: [configuration gate](../../apps/web/src/app/components/auth/AuthConfigurationGate.tsx),
[notice text](../../apps/web/src/app/components/auth/AuthChannelNotice.tsx),
[public policy](../../apps/api/src/infrastructure/auth-channel/auth-channel.service.ts).

## Check the affected local environment

Start the API using the supported workspace command in its terminal:

```powershell
pnpm --filter @homeservicemarketplace/api dev
```

Use [workspace recovery](workspace-recovery.md) if preparation or startup fails.
Dependency preparation does not provision a database or apply migrations.
After the API reports its listener, run the following from the repository root
with the same process environment as the Vite web terminal:

```powershell
node scripts/dev/auth-connection-doctor.cjs --web-origin http://localhost:5173
```

Replace the web origin with the browser's actual scheme, host and port. This
read-only command resolves the API origin through Vite and checks readiness,
public authentication policy, and the applicable credentialed CORS preflight.
It sends no cookies, login requests, OTPs or provider requests, and prints no
provider secrets or response bodies.

| Diagnostic result                                    | Interpretation                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Network failure or timeout                           | Check the running API listener and the resolved origin.                                                                   |
| Readiness failure                                    | Check PostgreSQL and Redis; MongoDB is included only when enabled.                                                        |
| Configuration 404 or HTML                            | Check the API address, running version and routing.                                                                       |
| Configuration 500/503 or invalid JSON shape          | Inspect API logs and the settings schema/value. A successful database ping does not prove the settings table is readable. |
| CORS failure                                         | Allow the browser's exact origin in API `FRONTEND_URL` / `CORS_ORIGINS`.                                                  |
| Policy passes, with a WhatsApp configuration warning | API policy connectivity is working; provider configuration remains a separate check.                                      |

Exit code 0 means the checked readiness, policy and CORS conditions passed. It
does not prove a completed login or real delivery. A successful standalone
PowerShell GET also does not prove that the browser's CORS checks pass.

### Address and environment pitfalls

- An explicit web `VITE_API_URL` wins. Use an absolute API origin, for example
  `http://localhost:4010`, without `/v1`, credentials, a query or a fragment.
- When it is blank during local development, Vite follows the API's `PORT`:
  process environment, then `apps/api/.env.local`, `apps/api/.env`, root
  `.env.local`, root `.env`, then default `4000`.
- `$env:PORT = "4010"` in the API terminal does not propagate to another
  terminal. Compare the doctor's resolved origin with the actual API listener.
- Vite also loads its mode-specific web environment files and process
  overrides. Restart Vite after changing them; restart the API after changing
  its configuration. Production bundles require an explicit API origin at
  build time.
- `http://localhost:5173` and `http://127.0.0.1:5173` are different origins.
  Match the origin actually in use; do not replace the credentialed CORS
  allowlist with `*`. Keep the local web/API hostnames consistent for cookies.
- Preserve existing environment files. Put provider credentials only in
  backend configuration, never in a `VITE_*` variable or a shared diagnostic.

Sources: [API-origin resolver](../../scripts/dev/api-endpoint.cjs),
[connection doctor](../../scripts/dev/auth-connection-doctor.cjs),
[Vite configuration](../../apps/web/vite.config.ts),
[API configuration loader](../../apps/api/src/config/config.module.ts).

## Select the channel and configure its provider separately

The persisted `auth.otpChannel` selects `whatsapp` or `email`. An absent
preference defaults to WhatsApp; an administrator's explicit selection remains
authoritative. `WHATSAPP_PROVIDER` chooses the transport for the WhatsApp
channel and does not override a saved email choice.

The API guards administrator changes: selecting WhatsApp requires configured
transport and the administrator's own verified phone; selecting email requires
their verified email. Do not bypass these guards to make the button appear
enabled. See [passwordless login](whatsapp-passwordless-login.md).

Run the provider configuration diagnostic from the root:

```powershell
node scripts/dev/whatsapp-doctor.cjs
```

It checks local presence and formats using the backend environment precedence
above. It does not verify credentials, approval, the saved channel or delivery.

### Meta WhatsApp Cloud API

Set `WHATSAPP_PROVIDER=meta` (the default). All six values below are required by
the transport's configuration check:

| Backend variable                  | Required value                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `WHATSAPP_ACCESS_TOKEN`           | The sender's access token.                                                      |
| `WHATSAPP_PHONE_NUMBER_ID`        | The Meta sender phone-number ID.                                                |
| `WHATSAPP_GRAPH_API_VERSION`      | A supported Graph API version, in `v<number>.<number>` format.                  |
| `WHATSAPP_AUTH_TEMPLATE_NAME`     | The approved authentication template's exact name.                              |
| `WHATSAPP_AUTH_TEMPLATE_LANGUAGE` | The approved language code, for example `ar`.                                   |
| `WHATSAPP_AUTH_TEMPLATE_APPROVED` | `true` only after the AUTHENTICATION / COPY_CODE template is actually approved. |

Setting the approval flag does not obtain provider approval. The doctor checks
these values locally; its connection option does not make a Meta request.

### GREEN-API

Set `WHATSAPP_PROVIDER=greenapi` and use values from the same instance:

| Backend variable             | Required value                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GREEN_API_URL`              | The instance's HTTPS API origin, without a method, token, path or query. The code permits `api.greenapi.com` / `api.green-api.com` and their numeric instance subdomains. |
| `GREEN_API_ID_INSTANCE`      | The instance ID.                                                                                                                                                          |
| `GREEN_API_TOKEN`            | That instance's access token.                                                                                                                                             |
| `GREEN_API_AUTH_TEMPLATE_ID` | For WABA: the approved one-code authentication template ID. Omit for a regular linked-device instance; this is not a Meta template name.                                  |

The optional connection check reads instance state without sending a message:

```powershell
node scripts/dev/whatsapp-doctor.cjs --check-connection
```

It must report `authorized`. A complete local configuration can still belong
to an unauthorized instance. The transport uses `sendMessage` without a
template ID and `sendTemplate` with one; a returned message ID acknowledges
provider acceptance, not receipt by the user.

For either provider, `WHATSAPP_REQUEST_TIMEOUT_MS` defaults to `10000` and must
be between `1000` and `30000`. Populated provider settings are schema-validated
even when that provider is inactive.

Sources: [provider schema](../../apps/api/src/config/env.schema.ts),
[provider doctor](../../scripts/dev/whatsapp-doctor.cjs),
[Meta transport](../../apps/api/src/infrastructure/auth-channel/meta-whatsapp-auth.transport.ts),
[GREEN-API transport](../../apps/api/src/infrastructure/auth-channel/green-api-whatsapp-auth.transport.ts).

## Evidence required before claiming the connection is complete

Record each layer independently on the intended environment:

1. API listening; readiness confirms its required data services.
2. The actual browser receives a valid policy from the intended API with the
   required CORS behavior, and the selected channel matches the saved choice.
3. The selected provider is configured; provider authorization is checked
   where supported. Neither `whatsappAvailable: true` nor a local doctor pass
   is a delivery test.
4. In an explicitly authorized test, request an OTP for an account/number the
   tester controls and confirm that it reaches the real recipient. A captured
   or simulated sender does not satisfy this layer.
5. Verify the received OTP, confirm the expected identity and role through
   `/v1/auth/me`, reload to check session restoration, then log out and confirm
   that the session no longer authorizes access. Check expiry/resend without
   recording codes, tokens or credentials in the evidence.

Attach current test/run evidence separately. Historical green runs do not
certify this environment or this source revision, and a development result
does not certify staging or production.

## Validation of this change

Local validation used Node `24.21.0` and pnpm `10.32.1` with the frozen lockfile:

- The focused Vitest run passed 128 tests across `phone-country`,
  `phone-identity`, `PhoneIdentityField` and `auth-channel`.
- `node --test scripts/dev/auth-connection-doctor.test.cjs
scripts/dev/whatsapp-doctor.test.cjs scripts/dev/api-endpoint.test.cjs` passed
  37 tests with no failures or skips, using controlled diagnostic fixtures.
- Scoped ESLint and Prettier, `git diff --check`, and the standalone browser
  helper's syntax check passed.
- `pnpm --filter @homeservicemarketplace/web build` passed, including the
  application typecheck, with `VITE_API_URL=http://127.0.0.1:4010` and the existing
  provider-onboarding flag unset. The existing large-chunk advisory remains.
- `pnpm --filter @homeservicemarketplace/web typecheck:e2e` passed.
- Local browser execution is blocked: the browser download endpoint returned
  403, and the installed Chromium was denied its process-singleton socket by
  the execution environment. All 14 attempted desktop cases stopped during
  browser launch; no page or browser assertion ran. This is not browser
  acceptance. The PR records hosted results for its exact final source.

The existing browser presentation matrix covers both authentication methods,
all three roles, both languages, six viewport widths and 200% CSS reflow. Its
new Stockholm-timezone cases exercise automatic Sweden selection, manual
correction and the absence of coordinate requests. These API fixtures prove
presentation only; real-service authentication acceptance remains a separately
labeled CI workflow. Neither workflow sends to a real WhatsApp recipient.

Rollback is a normal revert of this scoped change; no database action is
needed. User-environment connectivity and live provider delivery still require
the checks above.
