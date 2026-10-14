# Sender domain: SPF, DKIM and DMARC preparation

Status: **PREPARED, NOT PUBLISHED.** No delivery service has been selected
(`infra/production/STAGING.md`: the repository does not choose a provider, a
domain or DNS records). Nothing here has been published, and publishing needs
explicit account and domain authorization from the owner.

This file is the provider-neutral checklist. When the owner selects a
service, copy the exact values from **that service's current official
documentation** into the "Selected service" table. Do not invent include
hosts, selectors or key material.

## What the application sends

| Property               | Value                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Envelope / header From | `SMTP_FROM` (one verified sender; e.g. `Marketplace <no-reply@mail.example>`)                                               |
| Message-ID             | `<EmailDelivery.id@domain of SMTP_FROM>`: stable across retries                                                             |
| Transport              | SMTP, implicit TLS (465) or mandatory STARTTLS (587) in production                                                          |
| Timeouts               | connect 15 s, greeting 30 s, socket 30 s (`SMTP_*_TIMEOUT_MS`)                                                              |
| Mail kinds             | AUTH (OTP, verification link, password reset) and NOTIFICATION (provider verification outcome / correction, payment status) |
| Content                | bilingual English + Arabic, text + HTML; no documents, images, reviewer notes, document numbers or amounts                  |

Use a dedicated sending subdomain (for example `mail.<product-domain>`), so
its reputation and DMARC policy do not affect the organisation's own mail.

## Records to prepare

| Record               | Name                                     | Type         | Value template                                                                   | Source of truth             |
| -------------------- | ---------------------------------------- | ------------ | -------------------------------------------------------------------------------- | --------------------------- |
| SPF                  | `<sending-domain>`                       | TXT          | `v=spf1 include:<provider SPF host> -all`                                        | provider docs (RFC 7208)    |
| DKIM                 | `<selector>._domainkey.<sending-domain>` | TXT or CNAME | provider-generated public key or delegation target                               | provider console (RFC 6376) |
| DMARC                | `_dmarc.<sending-domain>`                | TXT          | stage 1: `v=DMARC1; p=none; adkim=s; aspf=r; rua=mailto:<owned reports mailbox>` | RFC 7489                    |
| Return-Path / bounce | provider-specific (custom MAIL FROM)     | MX/TXT/CNAME | provider docs                                                                    | provider docs               |

Notes:

- **One SPF record per name.** Merge with any existing `v=spf1` record; two
  records are a permanent SPF error. Stay under 10 DNS lookups.
- **DKIM alignment** is what makes DMARC pass for a third-party sender: the
  DKIM `d=` domain must be the sending domain, not the provider's shared domain.
- **DMARC rollout.** Begin at `p=none` with aggregate reports to a mailbox the
  owner controls; move to `p=quarantine`, then `p=reject`, only after reports
  show every legitimate source aligned. Each step is an owner decision.
- `rua` reports contain sender IPs and volumes and nothing else. They are
  still operational data: do not route them to a personal mailbox.

## Selected service (fill in after owner selection)

| Item                         | Value | Doc URL and retrieval date |
| ---------------------------- | ----- | -------------------------- |
| Service                      |       |                            |
| SMTP host / port / TLS mode  |       |                            |
| SPF include                  |       |                            |
| DKIM selector(s) and type    |       |                            |
| Custom bounce domain         |       |                            |
| Feedback channel             |       |                            |
| Feedback signature mechanism |       |                            |

The feedback channel must be translated into the application's
provider-neutral `generic-hmac-v1` contract (see
`apps/api/src/infrastructure/mail/feedback/feedback-signature.ts`) by an
adapter that verifies the vendor's own signature first. Building that adapter
is follow-up work once the vendor is known; R21 does not implement one.

## Verification

`scripts/production/email/check-sender-dns.cjs <sending-domain> [--dkim-selector s]`
reads the three records and reports their presence and shape. It only
queries DNS; it changes nothing. A published record is not acceptance: a real
message must also show `spf=pass`, `dkim=pass` and `dmarc=pass` in an
independent inbox's `Authentication-Results` header. See
`docs/production-readiness/r21/ACCEPTANCE.md`.
