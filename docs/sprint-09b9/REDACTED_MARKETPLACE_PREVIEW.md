# Sprint 9B.9 — policy-controlled redacted marketplace preview

Companion to [ADR 0006](../adr/0006-provider-capability-service.md) and
[ADR 0013](../adr/0013-evidence-to-work-access-capability-transition.md).

A provider who has finished onboarding and is waiting on verification currently
sees nothing at all. This is an optional, heavily redacted glimpse of the
marketplace for exactly that population — **off by default**.

---

## 1. The threat model, stated first

The audience for this surface is **unverified by definition**. They may be a
competitor harvesting the marketplace, or someone who wants to turn up at a
stranger's address. So the design question is never "is this field sensitive?"
but **"what can someone rebuild by collecting many of these?"**

Three answers shape everything below.

**Locations are snapped to a grid, never jittered.** Jitter looks more private
and is strictly worse: random offsets around a true point average out, so an
attacker who can re-request a listing converges on the exact location. Snapping
is deterministic — the same input always yields the same cell, so 10,000
samples say exactly what one says, and every point inside a cell is genuinely
indistinguishable from every other. `preview-redaction.spec.ts` asserts the
averaging attack fails by actually running it over 500 observations.

**Times and budgets are banded, never exact.** A precise `createdAt` is close to
a unique key. A preview user who later gained real feed access could join their
harvested set to the real one on it and de-anonymise every listing they ever
saw.

**The reference is a per-viewer pseudonym, not the request id.** Two providers
see different refs for the same request, so colluding preview users cannot align
their harvests, and neither can join a harvest to the real feed later.

## 2. What is on the wire

The item type is an **allowlist written from scratch**, not a `Pick<>` or
`Omit<>` of the real feed summary. An `Omit` silently gains every field later
added to the source type — so the day someone adds a phone number to the real
feed, an `Omit`-based preview would start emitting it.

| Field                                                  | Notes                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `ref`                                                  | HMAC(viewer salt, request id), 16 hex chars. Not the request id. |
| `categorySlug` / `categoryLabelEn` / `categoryLabelAr` | Public taxonomy.                                                 |
| `scheduleType`                                         | `ASAP` / `LATER`.                                                |
| `area.cityKey`                                         | Coarse. Never a line1 or postcode.                               |
| `area.cellLat` / `area.cellLng`                        | The **cell centre**, never the request's own point.              |
| `area.cellKm`                                          | So a client renders honest uncertainty instead of a pin.         |
| `freshness`                                            | `TODAY` / `THIS_WEEK` / `EARLIER`.                               |

**Absent by construction:** exact coordinates, exact timestamps, the real
request id, description, media, seeker identity or label, bid counts, budget,
distance, address snapshot, contact details.

### Two independent defences, not one

The query **names the columns it reads**, and the sensitive ones are not among
them — no `description`, no `mediaUrls`, no `seekerUserId`, no
`addressSnapshot`. A mapping bug therefore cannot leak them because they were
never loaded. Response-shape allowlists are good; not having the data in memory
is better, and together they mean **two independent mistakes** are needed rather
than one.

## 3. The policy

Typed entries in `ADMIN_SETTINGS_SCHEMA`, read from the same `PlatformSetting`
rows the admin screen writes.

| Key                             | Default   | Bounds |
| ------------------------------- | --------- | ------ |
| `marketplace_preview_enabled`   | **false** | —      |
| `marketplace_preview_cell_km`   | 25        | 5–200  |
| `marketplace_preview_page_size` | 10        | 1–25   |
| `marketplace_preview_max_items` | 30        | 1–200  |

### The fallback direction is inverted, deliberately

Every other settings reader in this codebase falls back to its schema default,
because those limits can only ever **refuse** and a settings outage must not
stop the marketplace. This one can only ever **disclose**. So:

- an absent, malformed or unreadable flag resolves to **off**;
- `enabled` must be strictly `true`, not truthy — the string `"false"` is
  truthy, and a row holding it under a truthy check would switch the preview
  **on**;
- a `cellKm` that cannot be trusted resolves to the **largest** cell, not the
  default one: too coarse is a worse product, too fine is a privacy incident,
  and only one of those is recoverable.

### Versioning a mutable table

Settings rows keep no history, so an audit line saying "a preview was served"
is unanswerable a week later — served under what limits? Every enabled policy
carries a **fingerprint**: a 12-hex digest of the limits actually applied,
recorded alongside each disclosure. It carries no secret and identifies nobody.

## 4. Who may see it

A new capability, `PREVIEW_MARKETPLACE`, granted at exactly **two** points in
the rank table — the two states where the whole message is "not yet":

- rank 6, verification required (onboarded, not yet verified);
- rank 7, no live work-access grant (verified, grant missing/revoked/lapsed).

Deliberately **not** granted to: a provider still in onboarding (they have a
task in front of them, and a preview is a distraction from it), a provider who
already has work access (they get the real feed), or anyone suspended,
terminated or restricted.

Holding the capability is **necessary but not sufficient** — the policy must
also be on, and it is off by default.

## 5. Three independent bounds on scraping

None is sufficient alone:

| Bound                | What it stops                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pageSize`           | The size of one response.                                                                                                         |
| `maxItems`           | The total ever reachable. Without it a small page size only **slows** a harvest — 200 pages of 10 is still the whole marketplace. |
| Rate limit (60/hour) | How often the whole reach can be re-walked, which is what turns a bounded snapshot into a live feed.                              |

The cursor is an **offset**, not a keyset: a keyset cursor carries a real row's
sort key, which is a piece of the data the preview exists to withhold.

## 6. A disabled policy answers 200, not 404

The caller is an authenticated, eligible provider, and the honest answer is
"this is switched off" — which the client renders as the notice. A 404 would be
a worse experience **and** a worse secret: toggling between 404 and 200 as an
operator flips the setting tells any observer exactly when the policy changed.

## 7. The copy

Server-owned, both locales, and it has to be **true**. A provider looking at a
deliberately vague map concludes one of two things: the platform is broken, or
it is hiding something from them. Both are worse than being told plainly that
the locations are approximate **on purpose**.

It also does not blame them. "You are not verified" reads as an accusation to
someone who has submitted their documents and is waiting; "while your documents
are being checked" describes the same state without implying fault. And it
promises no timeline nobody can keep — asserted by a test that greps for
"24 hours", "shortly", "soon".

## 8. Audit without PII

The log line records `items`, `offset`, `policyFingerprint` and `cellKm` — the
shape of the disclosure and the policy that governed it. It records **no** user
id, request id, coordinate or city: a log that captured which listings a named
provider was shown would recreate, inside the log store, exactly the correlation
the redaction spends its whole effort preventing.

## 9. A pre-existing test defect this exposed

`geo-fanout.integration.spec.ts`'s anti-drift assertion read **every service
request in the database** and compared each against a `listIds()` result that
_is_ category-filtered — while `matchServiceArea()` knows nothing about
categories. It said "for every fixture" and meant "every row".

It passed only because no suite had ever created an `OPEN_FOR_BIDS` request in
Aleppo under a different category. This sprint created 25, and it went red about
one run in six. Now scoped to its own category.

Proven causal by planting 5 contaminating rows: unscoped fails, scoped passes.
This is the residual risk flagged in Sprint 9B.8 §8 actually biting, and it is
now fixed rather than re-flagged.

## 10. Residual risks

1. `cityKey` is disclosed. In a dense city that is fine; for a request in a
   village whose `cityKey` names it, city plus category is a narrower
   identification than the 25 km cell implies. A future policy may want to
   suppress `cityKey` below a population threshold.
2. The reach cap is global, not per-viewer-per-day. Someone who waits out the
   rate-limit window can re-walk the same 30 items indefinitely — they learn
   nothing new, but the requests are free to them.
3. `freshness` plus repeated polling still reveals _that_ new work appeared,
   even though it reveals nothing about _what_. Bounded by the rate limit.
