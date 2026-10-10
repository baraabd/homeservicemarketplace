# R17-E — Provider authority matrix

Base `develop@2710d25`. Policy sources: `R17_E_PROVIDER_POLICY.md`. The
server decides every row; the web routes only hide what the server would
refuse. All provider routes also require an authenticated session with the
`provider` role; mutations also require the CSRF token.

## Capabilities by provider state

Decided by `ProviderCapabilityService` (one precedence table), with both
production flags armed (`WORK_ACCESS_ENFORCED`, `VERIFICATION_ENFORCED`).

| State                                         | `VIEW_MARKETPLACE` | `SUBMIT_BID` | `MANAGE_BOOKINGS` | `VIEW_EARNINGS` | Web home                                             |
| --------------------------------------------- | ------------------ | ------------ | ----------------- | --------------- | ---------------------------------------------------- |
| Working (good standing, verified, live grant) | yes                | yes          | yes               | yes             | `/provider/jobs`                                     |
| `RESTRICTED`                                  | no                 | no           | **yes**           | yes             | `/provider/bookings` (R17-E; was `/provider/status`) |
| `SUSPENDED` (standing or legacy status)       | no                 | no           | no                | no              | `/provider/status`                                   |
| `TERMINATED`                                  | no                 | no           | no                | no              | `/provider/status`                                   |
| Verification lapsed or missing                | no                 | no           | no                | no              | `/provider/status`                                   |
| Grant revoked, expired or missing             | no                 | no           | no                | no              | `/provider/status`                                   |
| Onboarding incomplete / under review          | no                 | no           | no                | no              | onboarding / status                                  |
| Account suspended, locked, deleted            | no                 | no           | no                | no              | (signed out)                                         |

## Routes

| Web route                                    | Required role       | Server capability (endpoint)                                     | Historical read when work is withdrawn      | Mutations on the surface                                    |
| -------------------------------------------- | ------------------- | ---------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `/provider/jobs` (+ detail overlay)          | provider            | `VIEW_MARKETPLACE` (`GET /v1/provider/available-requests[/:id]`) | n/a (new work only)                         | submit bid — `SUBMIT_BID`                                   |
| `/provider/bids`, `/provider/bids/:bidId`    | provider            | `VIEW_MARKETPLACE` (`GET /v1/provider/bids`)                     | no                                          | withdraw bid — `SUBMIT_BID`; booking actions as below       |
| `/provider/bookings` (new)                   | provider            | `MANAGE_BOOKINGS` (`GET /v1/provider/bookings`)                  | yes when `RESTRICTED`; no at ranks 2–3, 6–7 | none                                                        |
| `/provider/bookings/:bookingId` (new)        | provider            | `MANAGE_BOOKINGS` (`GET …/:id`, `GET …/:id/timeline`)            | as above                                    | start, complete, cancel — `MANAGE_BOOKINGS` + owner + state |
| `/provider/messages[/:threadId]`             | provider            | `MANAGE_BOOKINGS` (`/v1/provider/conversations*`)                | as above                                    | send, mark read — `MANAGE_BOOKINGS` + participant           |
| `/provider/wallet`                           | provider            | `VIEW_EARNINGS` (`GET /v1/provider/earnings/*`)                  | yes when `RESTRICTED`                       | none — withdrawal CTA disabled, no route (R16)              |
| `/provider/profile`                          | provider            | `VIEW_OWN_PROFILE` (read), `EDIT_OWN_PROFILE` (PATCH)            | own profile always                          | profile PATCH; category removal only                        |
| `/provider/status`                           | provider            | `GET /v1/me/provider/capabilities` (own account only)            | always                                      | none                                                        |
| `/provider/onboarding`, `/provider/activate` | provider / customer | onboarding capabilities (unchanged)                              | n/a                                         | onboarding writes (unchanged)                               |

A working provider has no Bookings tab (five destinations fit 320 px); they
reach `/provider/bookings` from My Bids. A provider with `MANAGE_BOOKINGS`
but not `VIEW_MARKETPLACE` sees Bookings in place of Jobs and Bids.

## Mutation authority

| Mutation                                 | Identity          | Ownership                   | Current capability                                                            | State check (inside the write)                                                   | Concurrency                                                                  |
| ---------------------------------------- | ----------------- | --------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /v1/provider/bids`                 | session → profile | none (new row)              | guard `SUBMIT_BID` (fresh read)                                               | request locked `FOR UPDATE`; P1 predicate re-run on the locked row               | one active bid per provider and request; cancel/accept serialise on the lock |
| `POST /v1/provider/bids/:id/withdraw`    | session → profile | `providerId` = own profile  | guard `SUBMIT_BID`                                                            | `PENDING → WITHDRAWN` conditional update                                         | concurrent withdraw: one 200, one 409                                        |
| `POST /v1/me/requests/:r/bids/:b/accept` | seeker session    | request owned by the seeker | guard: seeker. **R17-E: bidder's `SUBMIT_BID` re-decided in the transaction** | request lifecycle lock; bid `PENDING`; request `OPEN_FOR_BIDS`; both conditional | bidder's account and profile rows `FOR SHARE`: suspension waits or is seen   |
| `POST /v1/provider/bookings/:id/start`   | session → profile | `providerId` = own profile  | guard `MANAGE_BOOKINGS` (fresh read)                                          | `SCHEDULED → IN_PROGRESS` conditional update                                     | one 200, one 409; one booking event                                          |
| `…/complete`                             | as above          | as above                    | as above                                                                      | `IN_PROGRESS → COMPLETED`; reputation count in the same transaction              | as above                                                                     |
| `…/cancel`                               | as above          | as above                    | as above                                                                      | `SCHEDULED → CANCELLED`                                                          | as above                                                                     |

## Post-merge closure (#148)

| Path                                             | Authority                                                                                                                                                                                                                | Evidence                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `GET /v1/provider/bookings?cursor=`              | guard `MANAGE_BOOKINGS`; the cursor must be one of the caller's own bookings (deleted or not), else 400; pages owner-scoped, `status` filter on every page                                                               | closure H C01–C05; browser |
| `request.available` dispatcher                   | candidates: geo superset + category + `marketplaceCandidateWhere`; each decided by the feed's geo function and `holdersAmong(VIEW_MARKETPLACE)`; own request excluded; live category, `OPEN_FOR_BIDS`                    | closure H C10              |
| `request.available.batch` (writes notifications) | request lifecycle lock → slice accounts → slice profiles `FOR SHARE`; the same candidate query and decision limited to the slice, live category; providers with an active bid dropped; realtime only to the rows written | closure H C11–C14, C16     |

Provider-initiated writes check capability in the guard, then decide state in
the transaction. A suspension that commits between the two is ordered after
the write (serialisable); unlike acceptance, no stale offer can be turned into
a new obligation that way. The R17-E real-HTTP spec covers both orders for
acceptance (P30: the accept is observed waiting on an in-flight suspension).
