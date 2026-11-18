# WhatsApp authentication operations

Delivery mode: Product Feature Mode for backend policy and transport. Authentication UI changes use scoped UX/UI Redesign Mode.

## Provider setup

Email remains the default. Configure these values in the API deployment secret manager:

- `WHATSAPP_ACCESS_TOKEN`: a Meta system-user token with `whatsapp_business_messaging` permission.
- `WHATSAPP_PHONE_NUMBER_ID`: the sending number's Meta ID, not its displayed telephone number.
- `WHATSAPP_GRAPH_API_VERSION`: an explicit supported version, for example `v27.0`; no moving latest default.
- `WHATSAPP_AUTH_TEMPLATE_NAME` and `WHATSAPP_AUTH_TEMPLATE_LANGUAGE`: the exact approved template name and language.
- `WHATSAPP_AUTH_TEMPLATE_APPROVED=true`: set only after Meta approves an AUTHENTICATION template with a COPY_CODE button and a five-minute expiry. This is an operator assertion, not an automated Meta approval check.
- `WHATSAPP_REQUEST_TIMEOUT_MS`: default 10000, maximum 30000.

Use separate sender credentials for staging where possible. No token, sender ID, or template configuration is written through the admin API or exposed by public configuration. Restart the API after environment changes.

A real end-to-end acceptance must send a code to an explicitly designated test recipient, verify that it arrives, consume it exactly once, and confirm an incorrect code, resend, expiration, password reset, and channel switch. Mocked HTTP acceptance is not evidence of actual WhatsApp delivery. This implementation does not claim a recipient read or delivery receipt: the durable outbox records only provider acceptance.

## Switch and rollback

1. While signed into an administrator account, verify its WhatsApp number through the protected phone enrollment flow; the existing password is required.
2. In Settings select WhatsApp and save. The bulk and keyed admin APIs both check provider configuration and the administrator's verified destination inside the write transaction.
3. All three authentication experiences read `GET /v1/auth/config` before rendering. The response is `no-store` and contains only `otpChannel` and `whatsappAvailable`.
4. Existing email accounts retain sign-in through their original verified email. Phone-only accounts retain WhatsApp sign-in after an email rollback. The selected global channel governs new registration and the default experience, not deletion of existing credentials.
5. A phone-only administrator first links and verifies an email in Settings using the current password and the code delivered to that email. Switch back to email through Settings using an administrator with a verified email. Deleting `auth.otpChannel` also restores email and applies the same guard.

An absent setting defaults to email; an invalid stored policy fails closed. Removing provider credentials while WhatsApp is selected reports `whatsappAvailable: false` without hiding the selected channel. It does not silently reroute OTPs to email: explicit existing-email sign-in and authenticated administrator rollback remain available. Restore provider configuration or select a usable channel.

## Delivery integrity

- OTP channel and recipient are pinned to the challenge; resends use that identity even if the default changes.
- Deploying the v4 Argon2id OTP codec requires resending any pre-v4 numeric code still pending within its normal five-minute lifetime. If verification has already shown the expired-code state, use the UI’s start-again recovery. The live resend API also preserves owner, channel, recipient and attempt/resend limits; no data migration expires challenges. Expired or exhausted challenges require a fresh sign-in/recovery request. Account passwords were already Argon2id and are unchanged; opaque email verification/recovery links are unchanged.
- The existing `EmailDelivery` table and leased dispatcher carry both channels. The historical table name is retained to avoid duplicating queue/state-machine code.
- Channel, recipient, and variables are sealed together with AES-256-GCM and message-key associated data. Old envelopes lacking a channel remain email.
- WhatsApp uses only authentication templates. No SMTP fallback is attempted for a WhatsApp envelope.
- Immediate delivery occurs after the producer transaction commits. Failure leaves a durable bounded retry; expiry and terminal states erase the sealed envelope.
- Meta's response body is discarded on errors. Only low-cardinality error classes enter logs or retry metadata. Authorization headers, OTPs, and recipient numbers are never logged by the adapter.
- Endpoint origin is fixed to `graph.facebook.com`; redirects are rejected and request duration is bounded.
- Provider acceptance followed by a process crash may lead to a retry; this is at-least-once delivery, not an exactly-once guarantee.

## References

- [Meta WhatsApp message-template reference](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-hsm/)
- [Meta authentication templates](https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates/)
- [Meta Cloud API template object](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/TemplateObject/)

No live WhatsApp recipient journey has been executed by the code-change task unless separate acceptance evidence explicitly records it.
