# Admin review experience completion

## Baseline and delivery mode

Baseline: merged `develop` commit `9a5a44b5c5f6a3fd2523d8cfb4db7fc8077dad5b` (PR #77).
Mode B applies to Admin navigation, directories, review tools and policy settings;
Mode A applies to the associated contracts, authorization and persisted data.
The approved Arabic brief supplied on 14 September remains the design target.

The user's screenshot showed the old sidebar and a mixed verification page.
The running build on the user's machine is unknown. Independently, the merged
source still mounted policy administration below two review lists. That source
defect is corrected here; updating a browser alone could not have corrected it.

## Screen inventory and acceptance target

| Entry            | User goal                                  | Target composition                                                                                         | Data and acceptance                                                                                 |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Users            | Find any registered account                | Search and paginated account table; independent role/account/admin-request labels                          | Preserve canonical filter values in both languages; link to provider                                |
| Providers        | Follow the professional lifecycle          | Header, filtered counts, search, lifecycle filters and responsive profile rows                             | Server submission dates, identity, portfolio and effective capabilities                             |
| Review requests  | Work through submitted applications        | Queue header, pending/returned views, oldest-first sorting, attention facts, identity reviewer and filters | Counts cover all matching pages; current identity assignment is explicitly identified               |
| Provider dossier | Inspect the six submitted tasks and decide | Existing wide dossier + decision sidebar; identity viewer; history; separate account controls              | Exact submitted revision, field-targeted corrections, private notes, final approval and work result |
| Identity cases   | Handle the document lifecycle              | Specialist queue, then URL-selected case with back action and full-profile link                            | Filters/cursor/selection survive refresh; no provider table or policy form below                    |
| Policy settings  | Configure global verification requirements | Separate settings destination, scope and effective-state overview, publish/retire confirmations            | Fresh dedicated permission, real country/category options and audit                                 |

`/admin/verification` redirects to `/admin/reviews` and preserves query state.
`/admin/settings/verification-policies` is an explicit route; unknown settings
descendants do not silently mount a settings editor. Dossier return targets are
limited to known Admin list routes. No new UI feature flag hides these entries.

## Visual system

- Keep the Admin slate navigation, amber actions, Cairo/Inter fonts and existing
  language/theme context. Use the existing `admin-review` semantic tokens.
- Directory pages use a clear title/description, filtered count tiles, one main
  search, a compact primary filter row and a disclosure for secondary filters.
- Rows keep identity, application state, document state and work eligibility
  separate. A live grant never substitutes for the canonical work decision.
- At 1440px use the available content width; at 768px reflow controls and summary
  columns; at 390px stack rows/cards and maintain full-width, readable fields.
  Existing responsive primitives also support narrow 320px content.
- Mobile filters occupy full rows so native selected values remain readable in
  both languages. Route focus does not scroll headings under the sticky header;
  section links share its measured height, and query-only filters keep position.
- Use visible focus, labelled regions, 44px controls, RTL logical spacing and
  complete Arabic labels. Technical enum values remain API values, never labels.
- Loading, empty, unavailable, forbidden, pending-save, stale-data and conflict
  states have distinct text and recovery. Failed mutation forms retain input.
- Application status, identity-case progress and work eligibility remain distinct.
  A null verification state means unverified, not absent documents. Undecided
  submissions say they await a decision. Policy identifiers use explicit LTR
  isolation inside Arabic content; free text determines its own direction.

## Data corrections

The list serializer now returns `submittedForReviewAt` and `reviewedAt` from
persisted fields, not invented fixture dates. A pending historical record with
no saved submission date displays “Submission date unavailable”. Stable cursor
ordering includes an ID tie-breaker and exact scoped counts exclude pagination.
Date-only filters cover complete UTC days; impossible dates are rejected.

Provider capability computation reuses the canonical service using eagerly
loaded facts. No per-row HTTP request or duplicated eligibility state machine
is introduced. Current identity-case assignee is labelled as an identity reviewer,
not presented as a new application-wide assignment feature.

The history endpoint allowlists persisted events and projects named actors,
decision kinds and actual submission/image revision references. Independent
legacy events are not attributed to today's submission. Private notes require
decision permission; portfolio events respect portfolio-read permission.

Correction targets are a shared catalog of fields that the current Provider
editors can actually change. The API validates task/field pairs and item
ownership. Provider feedback displays the target field and links to its real
editor using validated `reviewField`/`reviewItem` query context, preserving
the existing experience, gallery and consent sub-screen fragments. Focus is
scoped to the current task, runs once per explicit navigation, and waits for a
rendered target. Only owned gallery items or selected specialties register item
anchors; foreign ids and unknown fields are ignored. User interaction cancels
delayed focus, readonly tasks do not focus, and draft values are never changed
by navigation. Evidence instructions retain the existing verification route.
History hides cached content after session, permission or availability denials
(401/403/404), including previously loaded private notes.

## Verification and evidence boundaries

The dedicated `admin-review-workflow.real-api.spec.ts` runs in the required
`admin-review-real-api` CI job with its own disposable API, PostgreSQL, Redis and
Mailpit services. Both enforcement flags are ON from API startup; the Provider
acceptance job retains its separate configuration and service lifecycle.
It registers and submits through public APIs, signs in through the Admin UI,
opens the queue through navigation, checks a real submission date, follows the
six sections, submits corrections and final approval, and reloads persisted
results. Policy publication and retirement are verified through UI and API.

The independent job prevents the preceding Provider suite's login traffic from
consuming the Admin suite's rate budget. Restarting only the API left those
counters in shared Redis and caused CI #171 to refuse the first Admin flow with 429. The login limit remains 10 requests per IP per minute, and no rate buckets
are reset. The nine-test, single-worker suite makes eight fresh Admin UI logins,
one memoized Admin API login and one Provider UI login. Login responses are
asserted before waiting for OTP mail, so an upstream refusal is reported at its
source rather than as a missing message.

The real runtime suite also captures queue, dossier and policy settings in
English/Arabic, light/dark and 390/768/1440 widths. Screenshots must be inspected;
their generation and an accessibility scan are not design approval by themselves.
The protected image viewer also records desktop English/light, mobile Arabic/dark
and tablet Arabic/light states, with dialog accessibility and restored-focus
checks. Correction navigation checks focus on the actual editable city control,
including after reload.
Arabic mobile policy captures also cover a filled form with real catalog choices
and a maximum-length version, plus its confirmation dialog before cancellation.
An Arabic mobile portfolio dialog uses an image uploaded through the real public
media flow; approval checks its exact revision, both Admin and Provider persisted
views, and the audit timeline while work access remains denied.
Existing deterministic browser tests remain useful for rare conflict and denied
states, but are not the sole integration evidence.

Local static/unit checks and CI/runtime results are recorded in the PR on the
tested SHA. Do not interpret this document as a claim that the user's running
instance, production deployment or database migration has been verified.

## Rollout and rollback

1. Apply the additive policy-management permission migration. It provisions the
   permission for the existing Admin role; an existing environment does not need
   development fixture seeding. Fresh environments use the normal documented
   role provisioning. Policy access can be narrowed by role configuration.
   See `POLICY_SETTINGS.md`.
2. Build and deploy the frontend and backend from the reviewed commit together.
   Reusing an older running Vite process or Docker image does not update it.
3. Verify normal navigation and the redirected old bookmark, then test one
   genuine submitted application in the intended environment.
4. Admin destinations have no new UI flag. Field-focused Provider correction
   links use the existing V2 task editors: build with
   `VITE_PROVIDER_ONBOARDING_V2=true` and restart Vite after changing local env.
   A nonempty `localStorage['hsm.ff.providerOnboardingV2']` override wins over
   the build value in either direction; an unset/unrecognized build value is OFF.
   Remove only that override when evaluating the deployment default. CI tests
   the real V2 route ON; the user's running build and production flag are unknown.
5. Existing `VERIFICATION_ENFORCED` and `WORK_ACCESS_ENFORCED` server flags still
   govern eligibility. Admin runtime acceptance runs both ON; this UI update
   neither changes their deployment values nor bypasses their policy.
6. Roll back frontend/backend builds together if required. The additive grant
   migration can remain; do not erase policy versions or historical decisions.
   Turning the existing V2 build flag OFF returns the Provider wizard after a
   rebuild, subject to the same browser override; persisted corrections remain.

Do not remove the development/test policies visible in the original screenshot
without checking references and environment ownership. This change does not
delete or mutate those user-environment records.
