# R17-E — Post-merge closure

Follow-up to PR #147. Branch `fix/r17-e-postmerge-closure`, PR #148. Base
`develop@489541ad6bf4c001091ecdf8be07f6871ac7af45`.

Delivery mode: Integration and Bug-Fix. The provider bookings list gains the
pagination control its API already supported; no other screen changed.

State: R17-E is `R17_E_POSTMERGE_ACCEPTED_WITH_OPEN_FOLLOW_UPS`; this repair
is `R17_E_FOLLOW_UP_IN_REVIEW`. Neither becomes final until #148 is merged
and the post-merge develop gate on its merge SHA is green.

## PR #147 source identity (historical, unchanged)

| Fact                     | Value                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Head                     | `6a371991c593cd2093b1feae8cf6c25cfec24397`                                                                          |
| Merge                    | `489541ad6bf4c001091ecdf8be07f6871ac7af45` (merge commit; tree `affcd139c716` identical to the head's)              |
| PR-head acceptance       | CI 37982043985 (17/17, attempt 2 after the recorded MinIO-fixture flake), CodeQL 37982043581; R17-E 31/31 executed  |
| Post-merge push runs     | CI 37986992524 (17/17), CodeQL 37986992340, Production governance 37986992342, Web development startup 37986992295, |
|                          | Authentication lifecycle 37986992315, Staging release boundary 37986992353 — all success                            |
| Post-merge executed      | R17-E 31 passed / 0 failed / 0 pending; R17-C 23; R17-D 14; Integration & E2E 5550 passed, 36 skipped               |
| Open CodeQL on `develop` | 5: #3 critical, #2 high, #13 #16 #20 medium. None on a path this repair touches. #4 (R17-E) no longer open          |

Two findings were open when #147 merged:

- **Pagination review** (Codex, inline comment 4234163493 on
  `ProviderBookingsScreen.tsx:71`, P2): the list consumes only `data.items`
  and never `nextCursor`, so bookings after the API's 50-row page are
  unreachable — notably for RESTRICTED providers, who are routed to this
  screen to manage existing obligations. The finding was valid and is not
  rewritten out of the R17-E report.
- **E-13** (recorded OPEN in #147): the request-available fan-out picks
  recipients by the legacy `ProviderProfile.status = 'ACTIVE'`, not by the
  capability decision the provider feed enforces.

## Reproduction on `489541a` (before any fix)

Commit `0fa3b35` adds the tests alone; they were run against the untouched
merged source.

| Spec                                      | Result on `489541a`                  | What failed                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProviderBookingsScreen.test.tsx` (web U) | 6 of 7 failed                        | no Load more control at all; later-page error, overlap guard, in-flight guard, sign-out and Arabic cases had nothing to act on. The single-page case passed, as it should                                                                                                                                                                                                                      |
| `r17-e-closure.integration.spec.ts` (H)   | 6 of 11 failed (C16 was added later) | **C10**: dispatcher selected `account` (SUSPENDED account), `restricted`, `unverified`, `nogrant` and `late` (no live grant) besides the two real holders. **C11/C13/C15** the same stale audience; **C12** a slice wrote to the old audience after a category change; **C14** the slice never waited for an in-flight suspension; **C03** a foreign booking id was accepted as a cursor (200) |
| same, C01/C02/C04/C05                     | passed                               | the **server** cursor is sound: every walk matched the database order across ties and `NULL` scheduled times; restricted, suspended and revoked sessions already behaved                                                                                                                                                                                                                       |

So CLOSURE-1 was a client defect (plus a cursor-ownership hardening found on
the way), and CLOSURE-2 was a server authority defect.

## CLOSURE-1 — provider bookings pagination

API facts: `GET /v1/provider/bookings`, default and maximum page 50/100,
`nextCursor` = last id served or `null`, order `scheduledAt DESC NULLS LAST,
createdAt DESC, id DESC`, owner = the caller's live profile, optional
`status` filter. `MANAGE_BOOKINGS` guard (fresh read per request).

Fix (`8e26414`):

- `useProviderBookingPages` (`useInfiniteQuery`): no cursor on page one, then
  each `nextCursor`; filters in the key (`['provider','bookings','pages',
filters]`, under the existing root, so every booking transition's
  invalidation refetches it); the request `signal` is passed, so the existing
  `clearAuthSession` cancels a page in flight on sign-out, expiry or account
  switch and a late page is never written; a refetch re-walks loaded pages
  from fresh cursors (asserted). Polling and focus refetch are unchanged.
- `ProviderBookingsScreen`: **Load more** / **عرض المزيد** only while the
  server reports another page; disabled and `aria-busy` with
  "Loading more bookings…" while fetching, and no second request while one
  is in flight; a failed later page keeps every loaded row usable and offers
  **Try again** for that same cursor; focus moves to the first booking that
  arrived; a polite live count; "All bookings shown" once more than one page
  was read. No virtual scrolling, no redesign.
- `flattenBookingPages` shows a repeated id once **and reports it**
  (`console.error`); the web test proves the report, and C01 proves the
  server never overlaps.
- Server: a cursor must be one of the caller's own bookings (deleted or not).
  Prisma resolves a cursor by id alone, so a foreign or invented id was
  accepted and positioned the caller's page relative to a booking they cannot
  read. It is now 400 `VALIDATION_ERROR`. No row of another provider was ever
  returned (C03 held that on the baseline).

My Bids still links accepted bids to bookings from the first bookings page
and lists only the first page of bids. That is recorded below as an open
follow-up, not changed here.

## CLOSURE-2 — E-13 request-available fan-out authority

Canonical authority of the feed and detail routes
(`/v1/provider/available-requests[/:id]`): `JwtAuthGuard`, `RolesGuard`
(`provider`), `ProviderActiveGuard` = `ProviderCapabilityGuard` defaulting to
**`VIEW_MARKETPLACE`**, then `feedCategoryScope` (own categories), the
service-area rule, own request excluded, `OPEN_FOR_BIDS`, and — on detail —
404 once the provider holds a non-withdrawn bid.

Invariant: a provider is notified only if, at that boundary, the canonical
surface would let them open the request. The notification may be narrower
than the feed, never broader.

Fix (`86d5d07`, `4218bfa`):

- `ProviderCapabilityService.holdersAmong(userIds, capability, db)`: the same
  precedence table as `for()`, for a page of users in **three** reads
  (accounts, profiles, live grants). Single and bulk reads now share
  `contextFrom` and `liveGrantWhere`, so they cannot assemble a context
  differently.
- `marketplaceCandidateRule` / `marketplaceCandidateWhere`: the conditions
  without which the table never grants `VIEW_MARKETPLACE` (eligible account;
  legacy status not SUSPENDED, or ACTIVE when work access is not enforced;
  standing not TERMINATED/SUSPENDED/RESTRICTED; VERIFIED when verification is
  enforced; a live grant when work access is enforced), as data, rendered
  into the SQL that narrows candidates. `provider-capability.bulk.spec.ts`
  enumerates every context under all four flag combinations and fails if
  the rule ever drops a provider `decide()` admits; it caught one such gap
  while being written (a `NULL` legacy status, which the schema forbids —
  the enumeration now uses only real column values).
- `RequestAvailableAudience`: one candidate query and one exact decision
  (the feed's geo function, then `holdersAmong`) used by **both** stages.
  `listEligibleRecipientsPage` no longer reads `status = 'ACTIVE'`; its
  caller passes the authority predicate.
- Batch stage, at write time: locks the slice's account rows, then profile
  rows, `FOR SHARE` in id order (two statements; the request → account →
  profile order `canInTransaction` uses), re-reads the candidates limited to
  the slice with the **live** category, decides them exactly, drops providers
  who already bid, writes notifications for exactly that list and announces
  realtime to exactly that list after commit. A request whose category
  changed since creation is announced to nobody, in either stage, rather
  than under the wrong label.
- Stats carry counts only (`recipients`, `written`, `excluded`); no provider
  identifier is logged. Payload unchanged: request id, category id, city.

Two-stage behaviour, all proven over real PostgreSQL through the real
handlers and the real once-per-handler marker:

| Change                                                                   | Result                                                       | Case     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ | -------- |
| legacy ACTIVE but account suspended / restricted / unverified / no grant | not selected                                                 | C10      |
| capability holder in area and category                                   | selected and notified once                                   | C10, C13 |
| wrong category / outside area / own dual-role request                    | not selected                                                 | C10      |
| capability lost between dispatcher and slice                             | not notified; realtime not sent                              | C11      |
| capability gained after the dispatcher                                   | not notified (narrower than the feed; the feed shows it)     | C11      |
| request closed / category changed before the slice                       | nothing written                                              | C12      |
| suspension in flight while the slice runs                                | slice waits (`pg_blocking_pids`), then excludes the provider | C14      |
| provider bid before the slice                                            | not notified (detail now 404s for them)                      | C16      |
| dispatcher replay, slice replay, two workers on one slice                | one slice, one durable notification each                     | C13      |
| deep link                                                                | opens (200) for the recipient; 403/404 for a guess           | C15      |

C14 is mutation-checked: with the slice's `FOR SHARE` locks removed it fails
("the slice never waited on the in-flight suspension").

Retry and idempotency are the existing outbox guarantees: one handler-run
marker per (event, handler) inside the delivery transaction, deterministic
slice dedupe keys. The durable notification row is authoritative; realtime
is an accelerator. Exactly-once network delivery is not claimed.

### Query plan and cost

`EXPLAIN (ANALYZE, BUFFERS)` of the exact SQL Prisma generates, on the
throwaway database with 20,000 synthetic providers across 200 cities
(prefix removed afterwards):

| Flags                  | Plan head                                                                                                             | Execution | Candidates / holders | Statements per scan page |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- | -------------------- | ------------------------ |
| work + verification on | Bitmap Index Scan `ProviderProfile_status_deletedAt_serviceAreaCityKey_idx` (`status = ANY`), grant and user by index | 1.49 ms   | 57 / 57              | 5                        |
| both off (legacy rule) | same index (`status = 'ACTIVE'`)                                                                                      | 0.93 ms   | 71 / 71              | 5                        |

Keyset paging (500 per scan page) and the fan-out slice size are unchanged;
no whole-table read, no per-provider query, no new index.

## Tests

| Spec                                          | Level | Cases        | Before (`489541a`)       | After            |
| --------------------------------------------- | ----- | ------------ | ------------------------ | ---------------- |
| `r17-e-closure.integration.spec.ts`           | H     | 12           | 6 of the first 11 failed | 12/12            |
| `r17-e-closure-browser.integration.spec.ts`   | B     | 1 (10 steps) | —                        | 1/1, 10/10 steps |
| `ProviderBookingsScreen.test.tsx`             | U     | 7            | 6 failed                 | 7/7              |
| `useProviderBookingPages.test.tsx`            | U     | 2            | —                        | 2/2              |
| `provider-capability.bulk.spec.ts`            | U     | 8            | —                        | 8/8              |
| `provider-bookings.service.spec.ts` (3 added) | U     | 3 new        | —                        | pass             |

Levels: U unit, H real HTTP and real handlers on the real AppModule with
PostgreSQL 16 and Redis 7, B real browser on real Vite against the same.

Browser journey steps (real password/OTP, both work-access axes armed): first
page and control; pages 2 and 3 by mouse and by keyboard, focus on the first
new booking, ids equal to the database order with none repeated; hard
reload; **labelled fault step** — one real page-2 request failed at the
network layer, loaded rows stay usable, retry sends the same cursor and gets
the real page (no response is ever substituted); RESTRICTED reaches all 105
and a page-3 booking's detail; suspension mid-list — page 2 refused 403 and
the loaded rows dropped; Arabic RTL at 320/390/768/1440 — no horizontal
overflow, no axe violations (WCAG 2.2 AA tags), the control 44 px tall and
not covered by the bottom navigation; a session revoked elsewhere between
pages — page 2 refused 401 and signed out with no rows left; a fresh login
reaching every booking again. Screenshots were inspected; the first run's
evidence showed the failure notice cut off at the viewport edge, which is
why the journey now scrolls each control into view and asserts nothing
covers it.

Suites that construct the fan-out by hand now pass the new collaborators:
R07 races 23/23, R07 lifecycle 6/6, R09 geo 26/26 (fixture accounts set
ACTIVE — a PENDING_VERIFICATION account holds no provider capability and the
feed refuses it), geo fan-out 14/14, R17-E 30/30.

## Local preflight (Windows host, Docker Desktop; sequential)

Recorded in the PR #148 evidence comment with exact counts once complete.
Executed so far on the repair source: closure H 12/12; closure B 1/1; R17-E
H 30/30; R07/R09/geo fan-out as above; outbox 21/21, provider journey 15/15,
R12 40/40, PLATFORM-TX-1 10/10, route-capability matrix 153/153; capability,
bookings and requests unit suites 249/249; web pagination 9/9; API and web
typecheck, web `typecheck:e2e`, lint of every changed file.
`r17-notifications.integration.spec.ts` failed 2 of 14 in one of two runs on
this branch and in one of three runs on the untouched `489541a` tree: the
known local Docker-clock flake (it is green in hosted CI).

## Open items and policy decisions (unchanged by this repair)

| Item                                                        | Current safe behaviour                                                | Class                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| Uncategorised custom-text requests                          | on no provider surface; fan-out notifies nobody                       | `OWNER_DECISION_REQUIRED`                      |
| Pending bids after capability loss; restricted withdraw     | bid stays PENDING, acceptance 409; restricted cannot withdraw         | `OWNER_DECISION_REQUIRED`                      |
| Booking obligations after lapsed access or suspension       | `MANAGE_BOOKINGS` withheld at ranks 2–3, 6–7 (C04 and browser step 7) | `OWNER_DECISION_REQUIRED`                      |
| Recognition (`topPro`, bid `badge`)                         | not projected to seekers                                              | `OWNER_DECISION_REQUIRED`                      |
| Money unit and currency                                     | stored amount + currency code shown unformatted                       | `POLICY_BLOCKED`                               |
| Deactivated categories                                      | still match on every surface                                          | `OWNER_DECISION_REQUIRED`                      |
| A request's category changed after creation                 | not announced (new; narrower than the feed)                           | `OWNER_DECISION_REQUIRED` (re-announce or not) |
| Payouts, wallet withdrawal                                  | disabled                                                              | `INTENTIONALLY_DISABLED` (R16)                 |
| My Bids: first page of bids; bid→booking link from page one | older accepted bids show "Waiting for booking…" beyond 50 bookings    | open engineering follow-up                     |
| Provider bell button 36 px target                           | recorded in R17-E                                                     | open engineering follow-up                     |

None of these is decided by this repair; each fail-closed rule is temporary,
not final policy.

## Rollback

Revert the #148 commits. No migration, no data rewrite, no contract shape
change. A rollback restores the first-page-only list and the legacy-status
fan-out (E-13 reopens) and accepts foreign cursors again. Notifications
written while the repair was live remain valid rows.
