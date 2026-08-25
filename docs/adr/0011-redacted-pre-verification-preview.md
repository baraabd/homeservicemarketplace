# ADR 0011 — The pre-verification preview is a separate query, not a filtered feed

- **Status:** Accepted
- **Date:** 2026-08-24
- **Sprint:** 09
- **Related:** [0013](0013-evidence-to-work-access-capability-transition.md) (what "submitted evidence" grants), [0003](0003-service-area-geo-strategy.md) (the feed rule that drifted three ways), `docs/sprint-09/THREAT-MODEL.md`

## Context

A provider who has submitted evidence and is waiting for review has nothing to
look at. The product wants them to see _something_ — enough to believe the
marketplace has work worth waiting for — without granting access to work they
are not yet cleared for.

The tempting implementation is to serve the existing available-requests
response and hide fields in the client. The current response is:

```ts
{
  id, category, customServiceText, description, media,
  scheduleType, scheduledAt,
  location: { city, country, lat, lng },   // ← exact coordinates
  distanceKm, budget,
  seeker,                                   // ← first name + last initial
  bidsCount, createdAt,
}
```

`lat`/`lng` are the seeker's **exact address coordinates**, taken from
`addressSnapshot`. `seeker` identifies a person. `description` is free text a
customer wrote about their own home, and `media` are photographs of it.

Hiding those in React means the bytes are on the wire. They are in the network
tab, in the browser cache, in any logging proxy, and in the response of a `curl`
by anyone holding a submitted-but-unverified provider's session. "Redacted" would
be a rendering convention, and the only thing standing between an unverified
applicant and every customer's home address would be a JSX conditional.

[ADR 0003](0003-service-area-geo-strategy.md) already records what happens when
one rule has several homes: the feed rule was written three times and drifted for
a sprint.

## Decision

### 1. A separate query, a separate DTO, a separate route

`GET /v1/me/provider/preview/requests` is its own repository query with its own
`select`, returning its own `RedactedRequestPreview` type. It does not call the
available-requests service, does not share its mapper, and does not accept its
row type.

The redaction is therefore **structural**: the sensitive columns are never read
from PostgreSQL, so there is no code path — however buggy — in which they reach
a serializer. A field cannot leak from a query that does not select it.

### 2. An explicit allowlist, and the DTO is the boundary

| Exposed                                                    | Why it is safe                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `id` (opaque)                                              | Needed for nothing but list keys; grants no action.               |
| `category`                                                 | The trade. The whole point of the preview.                        |
| `approximateArea` (city / district label)                  | Coarse, product-approved. **Never** a coordinate pair.            |
| `scheduleBand` (`WITHIN_24H` \| `THIS_WEEK` \| `FLEXIBLE`) | Broad enough to convey urgency, too coarse to identify a booking. |
| `budgetBand`                                               | A band, not the number.                                           |
| `createdAtBand` (`TODAY` \| `THIS_WEEK` \| `OLDER`)        | Freshness without a timestamp to correlate on.                    |

Everything else is absent. Named explicitly because a denylist is a list someone
must remember to extend: `lat`, `lng`, `addressLine`, `description`, `media`,
`seeker`, `seekerUserId`, `phone`, `email`, `distanceKm`, `bidsCount`,
`conversationId`.

`distanceKm` is excluded despite looking harmless: it is a distance from a
provider-controlled point to the customer's exact location. A provider who can
move their own service-area centre and re-read the feed trilaterates the address
in three requests. This is the single least obvious redaction in the sprint and
the one most likely to be re-added by someone who thinks it is only a number.

### 3. A privacy snapshot test, not a field-by-field assertion

The DTO is asserted with a **full-object snapshot** plus a recursive scan that
fails if any forbidden key appears at any depth. A test that checks
`expect(res.lat).toBeUndefined()` passes forever and says nothing about the field
added next sprint. The recursive scan fails on the new field automatically.

### 4. Preview is read-only, and every mutation stays forbidden

Holding the preview capability grants exactly one thing: reading this list. Bid,
accept, booking mutation, provider conversation, wallet and earnings all remain
denied by [ADR 0006](0006-provider-capability-service.md)'s precedence table.
Enforcement is server-side per mutation, not by hiding buttons.

### 5. Rate limiting and anti-scraping

The preview is the only marketplace surface an unverified account can reach, so
it is the surface an attacker rents an account to scrape.

- A dedicated, tighter throttle than the authenticated default.
- **Page-depth cap.** Deep pagination is the scraping access pattern; a legitimate
  "is there work here?" glance never reaches page 20.
- **Coarse, non-correlatable ordering.** No stable cursor that walks the whole
  table, and no exact `createdAt` to page on.
- Telemetry counts **events, not subjects**: request counts, denial counts,
  throttle hits. No request ids, no seeker ids, no coordinates. Privacy-safe
  telemetry means the metric itself cannot become the leak.

## Alternatives rejected

**Filter the existing response in the API mapper.** Better than filtering in
React, and still one `select` away from disaster: the sensitive fields are loaded
into memory and one future `...row` spread re-exposes them.

**Filter in React.** The data is already on the wire. Rejected outright, and
named in the sprint brief as a non-option.

**Show nothing until verified.** Safest, and the product asked for a preview. This
ADR exists to make the preview safe rather than to argue against it.

**Fuzz the coordinates (add jitter).** Repeated reads average the jitter out, and
it invites treating a fuzzed coordinate as safe to expose. A city label has no
such failure mode.

## Consequences

**Good** — sensitive columns are never read, so leakage is structurally
impossible rather than conditionally prevented; the snapshot test fails on new
fields by default; the preview cannot become a scraping endpoint quietly.

**Costs / risks**

- **A second query to maintain.** Accepted deliberately: shared code here means
  shared blast radius, and [ADR 0003](0003-service-area-geo-strategy.md) shows
  the sharing does not stay safe.
- **Band granularity is a product decision.** `approximateArea` resolution and
  the budget bands are recorded as outstanding product/legal decisions; the code
  reads them from configuration rather than assuming.
- **Aggregate correlation remains possible in principle** — enough coarse
  observations over time still carry signal. Bounded by rate limits and page
  depth, not eliminated. Recorded as a residual risk in the threat model.

## Revisit

- If the product later wants a "distance band" for utility, it must be computed
  from the provider's **declared service area** (already known to them), never
  from the customer's point.
