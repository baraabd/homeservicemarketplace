# Sprint 9B.8 — provider route / capability matrix

Companion to [ADR 0006](../adr/0006-provider-capability-service.md) and
[ADR 0013](../adr/0013-evidence-to-work-access-capability-transition.md).

Every provider-facing route, the capability it requires, and why. Generated from
the controllers and then annotated, so the table cannot quietly drift from the
code it describes.

---

## 1. What changed, and the bug that motivated it

Before this sprint, eight provider controllers mounted `ProviderActiveGuard`,
and that guard asked for exactly one capability — `VIEW_MARKETPLACE` — whatever
the route did. Bidding, managing an accepted booking, reading earnings and
messaging a seeker were all gated on the same answer.

That was not merely coarse. It **inverted a rule the capability service states
deliberately**. Rank 4 (`RESTRICTED`) grants `MANAGE_BOOKINGS` and
`VIEW_EARNINGS` while withholding `VIEW_MARKETPLACE`, with the comment:

> Bookings already accepted are obligations to a seeker. Cutting them off
> punishes the customer for the provider's restriction.

The route asked the wrong question, so the customer was punished anyway. A
restricted provider could not open a booking they were still contractually on
the hook for.

Routes now declare their own capability with `@RequireCapability`, read by
`ProviderCapabilityGuard`.

## 2. Three families were not gated at all

| Family                                | Before                         | Now                  |
| ------------------------------------- | ------------------------------ | -------------------- |
| `me/provider/categories/applications` | `JwtAuthGuard`, `RolesGuard`   | `EditOwnProfile`     |
| `me/provider/onboarding/*` (wizard)   | `JwtAuthGuard`, `RolesGuard`   | `EditOwnProfile`     |
| `me/provider/verification/*`          | `JwtAuthGuard` (+ `CsrfGuard`) | `ManageVerification` |

A **suspended** provider could apply for new categories, keep editing and
re-submitting an application nobody would act on, and push files into the
restricted, malware-scanned evidence pipeline indefinitely. Rank 3 exists to
prevent exactly that; nothing was asking it.

## 3. One new capability

`MANAGE_VERIFICATION`, because none of the existing ones fit:

- not `COMPLETE_ONBOARDING` — withheld once onboarding reaches `ACCEPTED`, and
  re-verification is precisely something an `ACCEPTED` provider does;
- not `EDIT_OWN_PROFILE` — evidence goes to restricted storage and is scanned,
  a different blast radius from changing a headline.

Held from rank 4 downward (a `RESTRICTED` provider may keep their verification
current — otherwise a temporary restriction becomes permanent the moment their
verification lapses) and withheld from `SUSPENDED` and `TERMINATED`.

## 4. The matrix

| Method | Endpoint                                                  | Capability required         |
| ------ | --------------------------------------------------------- | --------------------------- |
| PATCH  | `/v1/me/provider/availability`                            | `EditOwnProfile`            |
| GET    | `/v1/me/provider/bids`                                    | `ViewMarketplace`           |
| POST   | `/v1/me/provider/bids`                                    | `SubmitBid`                 |
| POST   | `/v1/me/provider/bids/:bidId/withdraw`                    | `SubmitBid`                 |
| GET    | `/v1/me/provider/bookings`                                | `ManageBookings`            |
| GET    | `/v1/me/provider/bookings/:bookingId`                     | `ManageBookings`            |
| POST   | `/v1/me/provider/bookings/:bookingId/cancel`              | `ManageBookings`            |
| POST   | `/v1/me/provider/bookings/:bookingId/complete`            | `ManageBookings`            |
| POST   | `/v1/me/provider/bookings/:bookingId/start`               | `ManageBookings`            |
| GET    | `/v1/me/provider/bookings/:bookingId/timeline`            | `ManageBookings`            |
| GET    | `/v1/me/provider/capabilities`                            | _none_                      |
| GET    | `/v1/me/provider/categories/applications`                 | `EditOwnProfile`            |
| POST   | `/v1/me/provider/categories/applications`                 | `EditOwnProfile`            |
| GET    | `/v1/me/provider/earnings`                                | `ViewEarnings`              |
| GET    | `/v1/me/provider/earnings/transactions`                   | `ViewEarnings`              |
| GET    | `/v1/me/provider/jobs/available`                          | `ViewMarketplace (default)` |
| GET    | `/v1/me/provider/onboarding`                              | `ViewOwnProfile`            |
| GET    | `/v1/me/provider/onboarding/draft`                        | `EditOwnProfile`            |
| PATCH  | `/v1/me/provider/onboarding/steps/:step`                  | `EditOwnProfile`            |
| POST   | `/v1/me/provider/onboarding/submit`                       | `EditOwnProfile`            |
| POST   | `/v1/me/provider/onboarding/withdraw`                     | `EditOwnProfile`            |
| GET    | `/v1/me/provider/profile`                                 | `ViewOwnProfile`            |
| PATCH  | `/v1/me/provider/profile`                                 | `EditOwnProfile`            |
| POST   | `/v1/me/provider/submit-for-review`                       | `SubmitForReview`           |
| POST   | `/v1/me/provider/upgrade`                                 | _none_                      |
| GET    | `/v1/me/provider/verification/case`                       | `ManageVerification`        |
| POST   | `/v1/me/provider/verification/case`                       | `ManageVerification`        |
| POST   | `/v1/me/provider/verification/case/submit`                | `ManageVerification`        |
| PUT    | `/v1/me/provider/verification/evidence/:assetId/content`  | `ManageVerification`        |
| POST   | `/v1/me/provider/verification/evidence/:assetId/finalize` | `ManageVerification`        |
| POST   | `/v1/me/provider/verification/evidence/prepare`           | `ManageVerification`        |
| POST   | `/v1/me/provider/withdraw-review`                         | `SubmitForReview`           |
| GET    | `/v1/provider/available-requests`                         | `ViewMarketplace (default)` |
| GET    | `/v1/provider/available-requests/:requestId`              | `ViewMarketplace (default)` |
| GET    | `/v1/provider/bids`                                       | `ViewMarketplace`           |
| POST   | `/v1/provider/bids`                                       | `SubmitBid`                 |
| POST   | `/v1/provider/bids/:bidId/withdraw`                       | `SubmitBid`                 |
| GET    | `/v1/provider/bookings`                                   | `ManageBookings`            |
| GET    | `/v1/provider/bookings/:bookingId`                        | `ManageBookings`            |
| POST   | `/v1/provider/bookings/:bookingId/cancel`                 | `ManageBookings`            |
| POST   | `/v1/provider/bookings/:bookingId/complete`               | `ManageBookings`            |
| POST   | `/v1/provider/bookings/:bookingId/start`                  | `ManageBookings`            |
| GET    | `/v1/provider/bookings/:bookingId/timeline`               | `ManageBookings`            |
| GET    | `/v1/provider/conversations`                              | `ManageBookings`            |
| POST   | `/v1/provider/conversations`                              | `ManageBookings`            |
| GET    | `/v1/provider/conversations/:conversationId/messages`     | `ManageBookings`            |
| POST   | `/v1/provider/conversations/:conversationId/messages`     | `ManageBookings`            |
| POST   | `/v1/provider/conversations/:conversationId/read`         | `ManageBookings`            |
| GET    | `/v1/provider/earnings/chart`                             | `ViewEarnings`              |
| GET    | `/v1/provider/earnings/summary`                           | `ViewEarnings`              |
| GET    | `/v1/provider/earnings/transactions`                      | `ViewEarnings`              |
| GET    | `/v1/verification/documents/:documentId/content`          | _none_                      |

**52 routes audited. 49 gated. 3 deliberately not** — each for a reason that
would be a bug if it were gated:

| Route                                        | Why it must stay ungated                                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/me/provider/capabilities`           | This is the endpoint that answers _"why am I denied?"_. Gating it on a capability makes the explanation unreachable to exactly the people who need it, and a denial nobody can inspect is a dead end.             |
| `POST /v1/me/provider/upgrade`               | How a seeker **becomes** a provider. At that moment no provider profile exists, so rank 1 denies every provider capability there is. Gating it is a door locked from inside the room it opens onto.               |
| `GET /v1/verification/documents/:id/content` | Serves restricted evidence to **either** its owner **or** an authorised reviewer. A provider capability guard would lock reviewers out. Its own owner/reviewer authorisation was built and tested in Sprint 9B.3. |

`ViewMarketplace (default)` marks the two routes that mount
`ProviderActiveGuard` — which _is_ `ProviderCapabilityGuard` specialised to
`VIEW_MARKETPLACE` — rather than declaring the capability explicitly. The job
feed and the available-requests list are the two surfaces where
`VIEW_MARKETPLACE` genuinely is the right question.

## 5. Required behaviour, and where it is proven

| Requirement                                                           | Where                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| incomplete onboarding → onboarding only                               | matrix row `onboarding DRAFT` / `RETURNED`             |
| submitted / pending review → status and evidence only                 | row `onboarding SUBMITTED`                             |
| unverified → no bid, booking mutation, wallet or earnings             | row `accepted but UNVERIFIED`                          |
| verified + valid grant → permitted working actions                    | row `VERIFIED with a live grant`                       |
| expired / revoked grant → working operations denied                   | row `VERIFIED but no live grant`                       |
| suspended / locked / inactive / deleted → protected operations denied | rank-0 rows and both `SUSPENDED` rows                  |
| VIP / Featured → no bypass                                            | `VIP, Featured and paid tiers cannot bypass any of it` |

Two suites, deliberately at different levels:

- `provider-capability.matrix.spec.ts` — every state's **complete** capability
  set, plus `can()` cross-checked against the set for every capability in every
  state. Per-rule tests never notice a capability that leaked into a set nobody
  was looking at; a full table does.
- `route-capability-matrix.integration.spec.ts` — the same states at the **HTTP
  boundary**, with a real guard, real capability service and real database.
  _"The resolver says no"_ and _"the route returns 403"_ are different claims,
  and only the second one protects anything.

Both run with `WORK_ACCESS_ENFORCED` and `VERIFICATION_ENFORCED` **ON**. The
flags remain `default(false)` in configuration.

## 6. Legacy twins

`/v1/me/provider/bids` and `/v1/provider/bids`; `/v1/me/provider/bookings` and
`/v1/provider/bookings`; `/v1/me/provider/earnings` and
`/v1/provider/earnings`.

A compatibility shim that gates more weakly than its canonical partner is not a
shim, it is a bypass, and it is the one an attacker finds first. The
declarations are duplicated deliberately rather than inherited, and a
parity test walks each pair across **every** provider state asserting identical
allow/deny — not asserted once, per state.

## 7. A boot crash this caught

`ProviderVerificationModule` mounted the new guard without importing
`ProviderCapabilityModule`, which owns it. That is a failure at **boot**, not at
request time. `app-module-di.e2e.spec.ts` failed immediately, which is what it
was written for after the identical Sprint 7 crash.

## 8. Residual risks

1. `ProviderActiveGuard` and `ProviderCapabilityGuard` are two names for one
   mechanism. Justified today — the subclass documents the two genuinely
   marketplace-only surfaces — but a third name would not be.
2. `@RequireCapability` is not enforced by the type system: a new provider
   controller that mounts the guard and declares nothing silently gets
   `VIEW_MARKETPLACE`. That default is the strict one, so the failure mode is a
   route that is too strict rather than too open, but nothing yet fails when the
   declaration is simply forgotten.
