# R18 — First-release scope

Base: `develop@fabeb0765689131025208f8dca2e7a4fae924118` (R18_BASE_SHA). This file
classifies what version 1 contains. It approves no policy: where a
capability waits on a decision, the decision is named (`BLOCKERS.md`).

Classes: `IN_RELEASE_SCOPE`, `INTENTIONALLY_ABSENT`, `POLICY_BLOCKED`,
`ENVIRONMENT_DEPENDENT`, `FUTURE_V2`, `DEPRECATED`, `UNKNOWN_DECISION`.

## In release scope

| Experience | Capability                                                                             | Authority (server)                                         |
| ---------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Seeker     | Register, OTP verification, login, refresh, logout, password reset                     | `iam/authentication`                                       |
| Seeker     | Profile and saved addresses                                                            | `/v1/me`, `/v1/me/addresses` (R05)                         |
| Seeker     | Active catalog                                                                         | service categories (R05)                                   |
| Seeker     | Create a request, with verified media                                                  | `/v1/me/requests`, request media authority (R06, R07)      |
| Seeker     | Request lifecycle (cancel, timeline)                                                   | R07                                                        |
| Seeker     | Compare bids; accept one; exactly one booking                                          | bid acceptance (R07, PLATFORM-TX-1)                        |
| Seeker     | Bookings list and detail, cancel where allowed                                         | `/v1/me/bookings` (R12)                                    |
| Seeker     | Review a completed booking once                                                        | R11                                                        |
| Seeker     | Booking messaging                                                                      | R12, R17-A                                                 |
| Seeker     | Notifications (in-app)                                                                 | R17-B                                                      |
| Seeker     | Disputes (pilot-gated; see D-3)                                                        | R17-C                                                      |
| Seeker     | Help & support tickets                                                                 | R13                                                        |
| Provider   | Upgrade, onboarding V2, work area, working hours                                       | R08, R09, R10                                              |
| Provider   | Identity verification, correction and resubmission, portfolio                          | Sprint 9, R08, admin review                                |
| Provider   | Capabilities and status centre                                                         | `ProviderCapabilityService` (R17-E)                        |
| Provider   | Feed, request detail, submit and withdraw a bid                                        | R07, R09, R17-E                                            |
| Provider   | My Bids (every page; E-18, #149 merged) and bookings (every page)                      | R17-E, closure #148                                        |
| Provider   | Booking detail, timeline, start, complete, cancel                                      | R12, R17-E, PLATFORM-TX-1                                  |
| Provider   | Messaging, notifications                                                               | R12, R17-A, R17-B                                          |
| Provider   | Own reviews and rating                                                                 | R11                                                        |
| Provider   | Earnings **read model** (booking values; no balance, no payout)                        | `provider/wallet` read model; wording fixed in #152 (open) |
| Admin      | Provider review, evidence review, correction, approval/activation                      | admin review (Sprint 9)                                    |
| Admin      | Users and user status, settings and history, analytics, audit, notifications, disputes | R17-D, R17-C                                               |

## Not in release scope

| Capability                                                                 | Class                        | Policy source                                                                  | UI today                                                                                        | API today                                                   | Writes | Wording truthful                 | Blocks first release |
| -------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ | -------------------------------- | -------------------- |
| Provider payout / withdrawal                                               | POLICY_BLOCKED               | `r16/PAYOUT_POLICY.md` (`R16_POLICY_BLOCKED`, `R16_FUNDING_AUTHORITY_BLOCKED`) | wallet control disabled; "coming soon" → "Withdrawals are not available" in #152                | no endpoint                                                 | none   | yes after #152                   | no                   |
| Customer payment execution                                                 | POLICY_BLOCKED               | `docs/money/README.md`, R15 matrix (NO_PERSISTENCE)                            | no payment step; help copy points to booking details (EVIDENCE_MISSING, see matrix)             | no endpoint                                                 | none   | see matrix row S-PAY             | no                   |
| Refund execution                                                           | POLICY_BLOCKED               | R16, R17-C P11                                                                 | dispute outcomes say "refund intent (not executed)"; admin "Refunds $0" → "not tracked" in #152 | no endpoint                                                 | none   | yes after #152                   | no                   |
| Escrow                                                                     | POLICY_BLOCKED               | R16 P1                                                                         | none                                                                                            | none                                                        | none   | n/a                              | no                   |
| Live calling                                                               | INTENTIONALLY_ABSENT         | roadmap "Chat calling"                                                         | booking Call disabled, `PhoneOff` with a note                                                   | none                                                        | none   | yes                              | no                   |
| Live GPS / tracking                                                        | INTENTIONALLY_ABSENT         | roadmap; R18 boundary                                                          | no Track control; launcher "Track Pro" removed in #151                                          | none                                                        | none   | yes after #151                   | no                   |
| Public Provider profile                                                    | FUTURE_V2                    | R17-E (`public-profile` module not exposed to seekers)                         | seekers see provider name, rating, verified on bids/bookings only                               | `modules/provider/public-profile` (owner preview)           | none   | yes                              | no                   |
| Realtime production cutover                                                | ENVIRONMENT_DEPENDENT        | R17-B (`REALTIME_SOCKET_IO`)                                                   | polling by default; socket path accepted in CI                                                  | outbox + socket.io behind the flag                          | none   | yes                              | no                   |
| "Top Pro" / bid badges                                                     | UNKNOWN_DECISION (D-16)      | R17-E P16                                                                      | rendered only when the server sends them; the server sends `false` / `null`                     | not written by product code                                 | none   | yes                              | no                   |
| Custom-text (uncategorised) requests                                       | UNKNOWN_DECISION (D-13)      | R17-E P5                                                                       | a seeker can post one; no provider can see it                                                   | accepted; feed matches no provider                          | yes    | **no**: nothing tells the seeker | **yes**              |
| Money unit and currency                                                    | UNKNOWN_DECISION (D-2)       | R16 P8, R17-D N3, R17-E P18                                                    | bids and bookings show whole units; wallet and admin divide the same integer by 100             | `Int` with `@default("USD")`; no product code sets currency | n/a    | **no**: two scales for one value | **yes**              |
| Speech search, offline sync, usage-data and location settings, app version | DEPRECATED (removed in #151) | R18 inventory                                                                  | were decorative or no-op                                                                        | none                                                        | none   | removed                          | no                   |
| Provider analytics                                                         | FUTURE_V2                    | none                                                                           | dead "My Analytics" row removed in #152                                                         | none                                                        | none   | removed                          | no                   |

Mixed currencies: the wallet and admin financials sum amounts across
currencies and label the total with the most frequent one. No product code
can create a non-USD bid or booking today (the column default is the only
writer), so this is latent; it becomes a defect the moment D-2 allows a second
currency.

## Hosted boundary (inventory only; nothing provisioned)

| Item                                         | Class                   |
| -------------------------------------------- | ----------------------- |
| TLS ingress, DNS                             | NOT_AUTHORIZED          |
| Secret manager                               | HOSTED_EVIDENCE_MISSING |
| Managed PostgreSQL, backup and restore       | HOSTED_EVIDENCE_MISSING |
| TLS/authenticated Redis                      | HOSTED_EVIDENCE_MISSING |
| Object storage policies (public, restricted) | HOSTED_EVIDENCE_MISSING |
| Real SMTP                                    | HOSTED_EVIDENCE_MISSING |
| ClamAV service                               | HOSTED_EVIDENCE_MISSING |
| Outbox, evidence-scan and expiry workers     | HOSTED_EVIDENCE_MISSING |
| Observability, alerts, on-call               | HOSTED_EVIDENCE_MISSING |
| Capacity / load                              | HOSTED_EVIDENCE_MISSING |

No item is `HOSTED_ACCEPTED`. CI uses disposable service containers, and the
Docker and Compose jobs prove a production-like boot, not hosted operation.
