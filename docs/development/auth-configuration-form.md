# Authentication form while configuration loads

## Scoped target — 23 November 2026

Mode A integration/bug fix, with a local presentation correction for `/login`
and `/signup` in the Seeker, Provider and Admin experiences. The user's
screenshot is the baseline: a configuration request failure replaces the entire
form with a retry page. This target intentionally changes that behavior; the
earlier full-page failure screenshots remain historical evidence.

| State or journey                                     | Previous friction                                                        | Required behavior                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial login or signup visit                        | The entire form waits for the policy request.                            | Mount the branded WhatsApp form immediately, with the existing country selector and flag. Show connection progress inside the form.                                    |
| Failed or malformed configuration response           | Only a full-page error and retry button remain.                          | Keep the phone field and draft visible and editable. Show an inline error and an accessible retry action.                                                              |
| Unconfirmed policy, including a warm cache           | An old administrator choice might be mistaken for current authority.     | Present the WhatsApp default without authorizing submission. Disable and guard new authentication requests until a fresh valid response confirms the policy.           |
| Fresh saved email choice                             | A presentation fallback could override the administrator.                | Replace the presentation with the server-selected email method. Do not offer a client-side method switch.                                                              |
| Fresh WhatsApp policy without provider configuration | Unknown policy and unavailable delivery can look identical.              | Show the confirmed WhatsApp form and its existing delivery-unavailable notice; do not claim sending is available.                                                      |
| Same-channel retry succeeds                          | Mounting a new form can discard typed input or focus.                    | Keep the existing form, country selection and draft; apply the new availability in place.                                                                              |
| Already-issued OTP and background refresh            | Replacing the form can discard a live challenge.                         | Preserve the issued challenge, partial code and original channel through its server-issued lifetime. Existing server policy enforcement still applies to new requests. |
| Password recovery                                    | An optimistic WhatsApp default could redirect an email user prematurely. | Wait for confirmed policy before deciding whether to show email recovery or return to WhatsApp login.                                                                  |

## Authority and connection boundaries

`GET /v1/auth/config` remains the source of the selected channel and provider
configuration availability. A missing persisted preference already means
WhatsApp; an explicit administrator choice remains authoritative. A failed
database read or invalid saved value is not an absent preference and must not
be silently converted to a successful configuration.

This change does not manufacture provider readiness, reset a saved channel,
send a message while policy is unknown, or remove server checks. WhatsApp
login remains phone followed by a six-digit OTP. The existing signup password
and legal-acceptance requirements remain. There are no schema, migration,
dependency-manifest or feature-flag changes for this presentation fix.

The screenshot alone cannot identify why the user's Windows browser failed to
obtain configuration. The separate read-only connection diagnostic checks the
same development API origin as Vite, readiness, the configuration response and
browser CORS after the API starts. A successful command-line GET alone does not
prove browser CORS or real WhatsApp delivery.

## Acceptance

- Exercise delayed, failed, malformed and successful policy responses, including
  stale cached choices and fresh administrator email selection.
- Assert both disabled UI actions and no authentication callback/POST before a
  fresh valid policy. Retain live-challenge verification and resend behavior.
- Verify all three brands in Arabic/RTL and English/LTR, widths 320, 390, 430,
  768, 1024 and 1440, keyboard retry, readable focus and 200% CSS reflow.
- Inspect screenshots of the changed states; label controlled transport
  failures separately from real API recovery and session evidence.
- Test the real API with disposable database fixtures: default WhatsApp, saved
  email, invalid saved policy, exact credentialed CORS and an unrelated origin.
- Retain every existing CI, security and R27 performance limit. New source
  requires fresh evidence before merge; earlier green heads are historical.

### Findings from the first hosted run

The real offline/reconnect journey exposed the existing notification dismiss
button without an accessible name. The follow-up names it in Arabic and
English, keeps its visible circular icon, and provides a 44px keyboard-focusable
target. It does not suppress the notification or narrow the accessibility scan.

The signup tests must wait for an enabled Next action rather than treat the
newly visible name field as proof of confirmed policy. Browser coverage also
exercises signup's pending/error/retry states and a restored credential-step
draft, without registering an account or sending an OTP during these checks.

## Rollback

Revert this scoped form-presentation commit if needed. Preserve the persisted
administrator preference, server authorization, provider configuration and
existing issued challenges; no data rollback or migration is required.
