# Sprint 9B.22 — Task 5: public profile, portfolio, preview, consent

V2 Task 5 behind `VITE_PROVIDER_ONBOARDING_V2`, still **default off**.

**No schema change and no migration.** Everything this task needed already
existed; the work was composition, one new read-only projection, and versioning
a consent record that was previously stamped with a constant.

---

## 1. The inventory, and the two things it found that are not built

| Question                                      | Answer                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is there a public provider-profile route?     | **No.** Every route is `me/*`, `admin/*`, an authenticated `provider/*`, or `services`.                                                                 |
| What does a customer see of a provider today? | `ProviderBidSummary` on a bid: name, initials, avatar, rating, review count, completed jobs, verified, topPro. **No headline, bio, city or portfolio.** |
| Does anything approve a portfolio image?      | **No.** `moderationState` defaults `PENDING`; nothing in the codebase ever writes `APPROVED`.                                                           |
| Is the portfolio pipeline reusable?           | Yes, entirely — policy, service, controller, contracts, hooks, and a props-free `PortfolioSection`.                                                     |
| Is publication consent recorded?              | Yes, server-side with a timestamp — but the text was a fixed sentinel, so _which wording_ was agreed to could not be answered.                          |

The brief says not to invent an approval workflow the backend lacks. The same
discipline applies to the public profile: there is no page for a customer to
land on, so this sprint does not pretend there is one. Both facts travel to the
client as flags on the preview response and both are said out loud on screen.

---

## 2. The preview is generated from the public contract

`ProviderPublicProfile` (contracts) and `buildPublicProfile` (api) are the whole
design: **two narrow types with a pure function between them.**

- The **output** type has nowhere to put a phone number, a coordinate, a storage
  key, an internal id or a moderation state.
- The **input** type, `PublicProfileSource`, has nowhere to put them either — so
  a caller cannot leak something by accident; they have to edit the file, and a
  reviewer only has to read it.
- The function copies **every field explicitly**. No spread anywhere: a spread
  is how a column added three months from now publishes itself. A test asserts
  the spread is absent.

`GET /v1/me/provider/public-profile/preview` serves that projection for the
caller's own profile. It is deliberately **not** a field on the onboarding
draft: the draft is the private working copy, and a preview rendered from it
would be a preview of the wrong object — agreeing with reality only until
somebody edited either side.

When a customer-facing route ships, it must call `buildPublicProfile`. That is
the point of building it now rather than shaping the preview by hand.

### What the preview refuses to publish

Asserted three ways: on the contract's declared fields, on the projection's
input type, and over the **serialised response** against a fixture whose private
columns are populated on purpose.

`phoneNumber` · `email` · `userId` · `providerProfileId` · `serviceAreaLat/Lng` ·
`serviceAreaRadiusKm` · `workshopAddressLine` · `storageKey` · `mediaAssetId` ·
`moderationState` · `reviewNotes` · `rejectionReason` · `additionalInformation`

The rating is **rounded to one decimal**. An un-rounded float is a fingerprint:
`4.833333333333333` identifies a provider far more precisely than `4.8`, and
nothing public needs the extra digits.

---

## 3. Restricted evidence and public portfolio media

The existing separation is on the **storage key**, checked at write time
(`assertPublishableKey`), because a key is fixed at upload and cannot be changed
by any later route — whereas a visibility column is a field, and fields get
updated by code nobody re-reads.

The preview adds the other half: the **read** filters on
`mediaAsset.visibility === 'PUBLIC'` as well. An item should never reference a
restricted asset, but this is the query that would publish one if it did, so it
checks rather than trusting a column written elsewhere.

Proven against a real Postgres by forcing the forbidden row into the database —
an `APPROVED` portfolio item pointing at a `RESTRICTED` evidence asset — and
asserting the response contains neither the image nor its key.

---

## 4. Moderation, told honestly

Nothing on this platform reviews a portfolio photo. So:

- the public projection contains **only `APPROVED`** items — today, none;
- the preview reports `awaitingReviewCount` and `moderationReviewAvailable:
false`;
- the screen says _"Photo review is not available yet, so nothing has been
  reviewed. Your photos are saved and stay private until it is."_

An auto-approve would have made the screen look finished and would publish
unreviewed photographs of customers' homes. The dependency is recorded here
instead:

> **Blocked on:** an admin moderation route that can move a
> `ProviderPortfolioItem` from `PENDING` to `APPROVED`/`REJECTED`, with an audit
> event, and a public route that serves `buildPublicProfile`. Until both exist,
> a provider's portfolio is stored and private.

---

## 5. Publication consent, now versioned

Sprint 9B.10 already did the important half — the acknowledgement is recorded
server-side with a timestamp, so it was never the untraceable client-only
checkbox the brief warns about. What it could not answer is **what the provider
agreed to**: the text column held one fixed sentinel.

Now:

- the wording lives in `PUBLICATION_ACK_WORDINGS`, keyed by version, **in both
  languages**, and the table is **append-only** and frozen;
- the client displays the wording for the current version and sends that
  version;
- the server refuses anything that is not current with a **409** carrying the
  current version — the same rule the CONSENT step already applies to the terms
  document, because accepting a stale document is not consent to the live one;
- an **absent** version is still accepted and recorded under the original
  sentinel, so clients predating the table acknowledge honestly rather than
  being back-dated onto wording they never saw;
- the server never stores wording a client sent — only a version.

The wording is a constant, not a platform setting: an operator who could point
it at a version whose text is not in the table would produce records nobody can
read back. Publishing new wording is a code change, which is the right weight
for a legal assertion.

The web copy is a **mirror** with a drift test, because the browser cannot
import runtime values from the contracts package (Sprint 9B.17's CJS/Rollup
trap). The drift test imports both and compares character for character —
showing one sentence while recording another is exactly the failure versioning
was added to prevent.

---

## 6. Composition, not construction

`PortfolioSection` is the Sprint 9B.10 component, mounted unmodified: same
upload pipeline, same ownership rules, same limits, same refusal codes, same
idempotency on the storage key. The only change to it is that it now displays
and submits the **versioned** wording instead of a local string — one component,
so V1 and V2 both record versioned consent.

The dead `consentLabel` copy was removed rather than left behind: a string that
reads like the consent text but is not what gets recorded is exactly the
confusion the versioning is meant to end.

Every portfolio mutation now also invalidates the preview, by key prefix so both
languages refresh. A preview that disagrees with the gallery beside it is worse
than no preview.

---

## 7. The title and the bio

**Title.** Task 2 (9B.18) suggests one and deliberately does not save it — its
own comment says "the profile task is where a title is written". This is that
task. The suggestion fills the box; it never writes itself. The value is
validated with the _same_ `validateProfessionalTitle` Task 2 previewed it under,
and a refused title is **not sent** — trading a clear inline message for a 422
the provider has to decode would be a worse experience, not a safer one.

Worth recording: the 16 shipped suggestions were checked against the validator
and **none is refused**, so the suggestion can never be a trap.

**Bio.** Prompts rather than a template — a pre-filled paragraph gets sent
unedited and every provider then sounds the same. The counter is:

- **truthful**: counted on the **trimmed** value, because the DTO trims before
  its length check, so a counter including trailing spaces would promise a save
  the server refuses;
- **localised**: `Intl.NumberFormat`, so Arabic gets Arabic-Indic digits — a
  Latin `2,000` inside Arabic copy is what "a correct localised counter" is
  asking about;
- **announced politely** via `aria-live`, and wired through `aria-describedby`
  so the field carries it.

An over-long bio is refused client-side and the field is marked `aria-invalid`.

---

## 8. Evidence

| Gate                                    | Result                                                 |
| --------------------------------------- | ------------------------------------------------------ |
| api lint / typecheck / build            | pass                                                   |
| api unit (hermetic)                     | 2911 passed, 543 DB-gated skipped                      |
| **api with DB + Redis gates ENABLED**   | **3454 passed, 0 skipped / 186 suites**                |
| web lint                                | 0 errors (32 pre-existing warnings, none in new files) |
| web typecheck / production Rollup build | pass                                                   |
| web unit                                | 1288 passed / 93 files                                 |
| web e2e (Playwright ×3 viewports)       | see the PR — full sharded run                          |
| **migration drift**                     | no difference detected (no schema change)              |
| `pnpm audit --prod --audit-level high`  | no known vulnerabilities                               |
| lockfile                                | unchanged (no new dependency)                          |

Postgres and Redis for the gated run were throwaway containers on 15433 / 16380,
never the developer's Compose volumes.

### Not in scope

- **A public profile route.** Naming the shape is this sprint's job; serving it
  to customers is a product decision with its own privacy review.
- **A moderation queue.** See §4 — deliberately not invented.
- **topPro** in the public projection. It is in `ProviderBidSummary` and is not
  a provider-authored field; adding it here would be widening the public surface
  under cover of a UI sprint.
