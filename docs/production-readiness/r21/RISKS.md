# R21 — risks, owner decisions and known deviations

## Owner decisions (proposed defaults are implemented; each needs confirmation)

| ID  | Decision                                                                       | Implemented default                                                                                          | Status                  |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------- |
| P-1 | Which email service (and therefore feedback format, DNS values, sender domain) | provider-neutral SMTP + `generic-hmac-v1` feedback contract                                                  | POLICY_BLOCKED          |
| P-2 | Suppression policy                                                             | hard bounce and complaint suppress NOTIFICATION mail only; AUTH mail never suppressed; account never touched | proposed                |
| P-3 | DMARC enforcement path                                                         | start `p=none`, owner moves to quarantine/reject                                                             | proposed, not published |
| P-4 | Dedicated envelope key mandatory in deployments                                | optional; HKDF subkey of `JWT_ACCESS_SECRET` when absent (CR-R21-03 A)                                       | proposed                |
| P-5 | Retention                                                                      | feedback 30 d, closed deliveries 90 d, envelopes cleared at terminal/expiry                                  | proposed                |
| P-6 | Anonymous-trigger throttle                                                     | 6 per address per 15 min for reset and verification-link mail                                                | proposed                |

## Residual risks

1. **No hosted delivery evidence.** No sender credentials, domain or test
   inbox were provided. Mailpit proves local transport and composition only.
   HOSTED_ENVIRONMENT_BLOCKED (owner: operator/owner, see ACCEPTANCE.md H-1…H-6).
2. **Feedback not reachable in the running app** until CR-R21-01 lands (the
   route returns 400 for every request; fail-closed by design).
3. **No vendor feedback adapter.** A real provider's callbacks (e.g. signed
   SNS notifications or a signed event webhook) must be verified with the
   vendor's own mechanism and translated to `generic-hmac-v1`. Until then no
   bounce/complaint reaches the system.
4. **Provider-status email not wired** until CR-R21-02 lands.
5. **Payment-status email has no producer.** The `account.payment_status`
   template exists and is tested; no payment notification is emitted
   anywhere at base, and none was invented (R15/R16/R18 money policy is
   unchanged). INTEGRATION_PENDING on the payment lane.
6. **At-least-once duplicates.** A crash between relay acceptance and the
   ACCEPTED write re-sends after the lease (same Message-ID). A user may
   then hold two copies of the same code/link; both are the same secret.
7. **Superseded codes.** If an OTP is resent while an earlier mail for the
   same challenge is still queued for retry, the earlier (now invalid) code
   may arrive late. It cannot authenticate; it can confuse. Bounded by the
   5-minute OTP lifetime.
8. **Synchronous first attempt latency.** A hung relay can hold an auth
   request for up to the timeout sum (15 + 30 + 30 s). Before R21 the bound
   was Nodemailer's defaults (minutes).
9. **Derived-key coupling.** With no dedicated key, rotating
   `JWT_ACCESS_SECRET` makes in-flight queued envelopes undecryptable (they
   close as FAILED/undecryptable; the user re-requests). Compromise of the
   JWT secret already implies account takeover, so the marginal exposure is
   small, but P-4 is the clean fix.
10. **Recipient hash is pseudonymous, not anonymous.** Unsalted SHA-256 of a
    normalised address can be confirmed by anyone who already knows the
    address. It is never exposed outside the database.
11. **Clock skew.** Retry backoff uses the app clock; the first-attempt claim
    deliberately ignores it (`attempts = 0`), so skew cannot delay first
    delivery (observed ~0.3 s app-ahead-of-DB on the Docker VM).
12. **Template wording** (EN/AR) has not been reviewed by a native Arabic
    copy owner or legal; it is functional, generic and deliberately
    detail-free.
13. **Local full-suite run was contention-limited** on a host shared with
    other lanes; see ACCEPTANCE.md for which suites were re-run in isolation.

## Not done (out of scope or not authorized)

- DNS publication, sender verification, provider account creation, spend.
- Any change to authentication eligibility, OTP lifetimes or security checks.
- UI changes (Mode A; no surface changed).
