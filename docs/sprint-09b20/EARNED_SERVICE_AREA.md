# Sprint 9B.20 — earned service-area expansion

An optional, auditable system that lets a provider's **allowed maximum** service
radius grow with their record on the platform.

**Default off.** `provider_service_area_expansion_enabled` ships `false`, and
with it false nothing about a provider — no ladder, no override, no signal —
changes a single number they see.

---

## 1. The inventory came first, and it changed the design

The brief allows a new versioned policy framework "unless an equivalent policy
framework already exists". One does: `VerificationRequirementPolicy` and the
module beside it (`provider/verification/policy/policy-lifecycle.ts`), which
already answers version format, back-dating, retire-once, and
one-live-policy-per-scope, and is already proven by a partial unique index.

So the decision split two ways:

- **The lifecycle rules are reused, not copied.** `assertVersionFormat`,
  `assertPublishable`, `assertRetirable`, `assertNoLiveOverlap` and `isLiveAt`
  are imported from the verification module and called with the two axes this
  policy does not have (`providerType`, `categoryId`) set to null — at which
  point `sameScope` reduces to comparing countries, which is exactly the scope
  rule wanted here. A second implementation of "what is a valid version string"
  would have drifted.
- **The TABLE is new.** `VerificationRequirementPolicy` is a foreign-key target
  for `VerificationCase` and its `requirements` JSON is validated against the
  document schema. A service-area ladder stored there would be a row a
  verification case could legally point at and no reviewer could read.

Also inventoried and used as-is: `PlatformSetting` + `PlatformSettingHistory`
for the two operator switches, `AuditService` for the five new event types, and
`ProviderProfile`'s Sprint 7 lifecycle axes for the standing and verification
signals.

---

## 2. Shape: it raises a ceiling, and only a ceiling

This is the load-bearing property of the whole feature.

|                        |                                                                    |
| ---------------------- | ------------------------------------------------------------------ |
| What expansion changes | `radiusPolicy.maxKm` — the largest radius the provider **may** set |
| What it never changes  | `serviceAreaRadiusKm` — the radius they actually travel            |
| What it never changes  | `radiusPolicy.suggestedKm` — still derived from transport alone    |

A provider who earns a 200 km ceiling and has 8 km set still travels 8 km.
Moving the suggestion would widen someone's travel obligations because a metric
moved, which is precisely the harm the brief names. `expansion-resolver.spec.ts`
asserts `currentRadiusKm` is echoed unchanged across every branch.

The earned ceiling is folded back into `radiusPolicy.maxKm` rather than served
beside it. The write path already enforces `radiusPolicy` through
`checkRadius()`; a second ceiling checked somewhere else is a rule that can
disagree with the one the slider was drawn from. **One number, one enforcement
point.**

---

## 3. Never rating alone — enforced, not promised

"Do not base access on ratings alone" is easy to agree with and easy to drift
away from one policy edit at a time. So it is a **publish-time refusal**:

```
Tier "stars" is decided by rating alone. Add a criterion that measures
conduct or completed work — ratings are a small, biased sample and must
never be the only gate.                                    [RATING_ONLY]
```

A tier whose criteria are all rating-shaped (`RATING`, `RATING_SAMPLE`) cannot
be published, by any operator, ever. The guarantee survives the person who read
the brief. It is asserted twice: as a unit test on the validator, and again
through the admin service against a real database.

Eight signals are available, all **server-observed**:

| Signal            | Source                                               | Notes                               |
| ----------------- | ---------------------------------------------------- | ----------------------------------- |
| Verification      | `ProviderProfile.verificationState`                  | Boolean gate                        |
| Completed jobs    | `ProviderProfile.completedJobs`                      |                                     |
| Rating            | `ratingAvg`                                          | Never usable without a sample floor |
| Rating sample     | `reviewCount`                                        |                                     |
| Cancellation rate | `BookingEvent` where the **actor is the provider**   | See §4                              |
| Complaints        | Open `Dispute` rows on their bookings                |                                     |
| Response time     | `Bid.submittedAt − ServiceRequest.createdAt`, median | See §4                              |
| Availability      | `ProviderProfile.availability`                       | Supported, not recommended — §5     |

Safety standing (`standingState ≠ GOOD`) is not a criterion; it is a **veto**
that outranks every tier and the manual override too.

---

## 4. Two signals we deliberately did not take at face value

**`Bid.responseTimeMinutes` is not used.** It looks like a response-reliability
signal and it is the provider's own ETA, submitted with the bid. Using it would
mean typing `5` to earn a wider service area. What is used instead is the gap
between two timestamps neither party can write.

**Cancellations are attributed by actor, not by status.** `Booking.status =
CANCELLED` says a booking ended cancelled, not who ended it. Counting a seeker's
change of mind against the provider would build a metric that penalises taking
work at all, so the count comes from `BookingEvent.actorUserId`.

**There is no response _rate_, and we did not invent one.** A rate needs a
roster of the requests each provider was shown, and this platform records no
fan-out. Deriving one from bids alone would punish providers for requests they
were never offered. The policy measures how fast they answer the ones they did
answer, over a bounded window of the 50 most recent bids, and the sample floor
guards the rest.

---

## 5. The fairness analysis the brief asked for

### Cold start

A brand-new provider has no jobs, no reviews, no bookings, no bids. Two rules
keep that from being a denial:

1. **The asymmetry.** Criteria that ask a provider to have _done_ something need
   evidence they did — no jobs, no tier. Criteria that ask them _not_ to have
   done something need evidence they **did**, and an empty history is not that
   evidence. So the anti-abuse ceilings **pass** below their sample floor.

   Read the other way round, a `minTerminalBookings: 10` would block a provider
   with five clean jobs on a metric they have never once failed — a cold-start
   trap that falls hardest on exactly the people this feature is meant to bring
   in. The sample floors are false-positive guards, not gates.

2. **Rating always needs a sample.** `minRatingAvg` without `minReviewCount` is
   refused at publish. Below the floor, the provider is told the **sample** is
   short (a disclosed, actionable criterion) rather than that their rating is.

The card at tier zero is a to-do list, not a rejection: it shows what to do next
and what is already clear.

### Bias

Ratings measure a small, self-selected slice of a provider's customers and carry
every bias those customers have — accent, name, neighbourhood, gender, the
weather on the day. That is why rating can never be the only gate, why it always
needs a sample size, and why the two signals that cannot be gamed by a
customer's prejudice (completed work, conduct) are the ones a ladder must rest
on.

This does **not** make the system unbiased. Completed-job counts inherit the
biases of the matching that produced them. The honest claim is narrower: no
provider can be denied on a rating alone, and every denial names which criteria
were unmet.

### Gaming

| Attack                                                 | Why it does not work                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Self-report a fast response                            | The self-reported field is not read; the measurement is two server timestamps                                                  |
| Aim just under a threshold                             | Anti-abuse targets are **not disclosed** — `current` and `target` come back null                                               |
| Bid instantly on everything to clear a response target | Same: the target is withheld, so there is nothing to aim at                                                                    |
| Cancel as the seeker to dodge attribution              | Attribution is by actor, and the seeker cancelling is the seeker's row                                                         |
| Publish a generous ladder for one market               | Publishing is admin-only, audited, and bounded by `provider_service_area_expansion_max_km` at publish **and** again at resolve |
| Collect a few 5-star reviews from friends              | Sample floors, plus the rating-only refusal                                                                                    |

Disclosure is split deliberately: **verification, completed jobs, rating, review
count and availability publish their targets** — those are things we want more
of, and stating them is the feature working. **Cancellation rate, complaints and
response time do not.** "Stay under 12%" reads as a budget where eleven percent
is fine.

### Sparse markets

A market with no published ladder gets `NO_POLICY_FOR_MARKET`, the standard
bounds, and no card. Nothing is inferred from a neighbouring country's policy —
25 km by car is a suburb in one city and three cities in another, and guessing
would be worse than declining. The route for a market too small to justify a
ladder is the manual override, which works **with no policy at all**.

### Appeal and manual override

Per-provider, admin-only, and the escape hatch for everything the ladder gets
wrong: a sparse market, a provider the signals describe badly, a denial that was
correct by the rules and wrong in fact.

- A **reason is required** — in the DTO, in the service, and in a `CHECK`
  constraint, so a future writer cannot bypass it. An override with no stated
  reason is an unattributable change to someone's reach, and the person who has
  to explain it later is never the person who made it.
- It is still bounded by the absolute ceiling.
- It **never lowers** what was earned.
- It may expire, or stand until revoked.
- A **safety hold outranks it**. Otherwise an override granted before a hold
  would quietly survive it.
- Every set and clear writes an audit event; clearing an absent override writes
  nothing and claims nothing.

---

## 6. Determinism

"Root-cause non-deterministic eligibility results" is cheapest to satisfy by
having none:

- The resolver is **pure**. No clock, no database, no settings lookup, no
  randomness — `now` is a parameter. An eligibility decision that cannot be
  re-run cannot be appealed.
- **Rates are compared by integer cross-multiplication**
  (`cancelled × 100 ≤ pct × terminal`), never by dividing. A boundary decided by
  floating-point rounding is the kind of result nobody can reproduce when it is
  disputed. 2/10 against a 20% ceiling passes, exactly.
- **Ratings are compared at the precision they are displayed at** (tenths). A
  provider whose profile shows 4.5 and who is refused a tier asking for 4.5 has
  been told two different things by one system.
- **Tier order does not matter.** The ladder is sorted on read; the spec asserts
  a reversed ladder gives an identical decision.
- **Exactly one live ladder per market**, guaranteed by a partial unique index
  with `NULLS NOT DISTINCT`, not by a service check. A read-then-write pre-check
  loses the race; two live ladders would mean the answer depended on which row a
  query returned first.

---

## 7. What is stored, and what it is for

`ProviderServiceAreaExpansion` — one row per provider, holding the last observed
tier **and** the manual override.

The row is a **record, not the source of truth**. The resolver is. A row that
has gone stale — because a provider completed a job somewhere this code does not
run — changes nothing about what they are granted; it only means the audit trail
names the last change we observed. (The override is the exception: it is an
input, because it is not derived from anything.)

Reads do not write. `describe()` resolves and returns; a GET that quietly
rewrote the row would make the read non-idempotent and put a write on the
provider's page-load path. `record()` runs on the two step writes that can
change the answer — `LOCATION` (which market's ladder applies) and `EXPERIENCE`
(which transport the base ceiling comes from) — and writes only when something
actually changed.

Five audit events: `SERVICE_AREA_POLICY_PUBLISHED`, `..._RETIRED`,
`SERVICE_AREA_EXPANSION_TIER_CHANGED`, `..._OVERRIDE_SET`,
`..._OVERRIDE_CLEARED`. The audit metadata allowlist was extended with the
identifiers and the two distances — deliberately **not** the ladder payload or
the signal values, since the policy version already points at the exact ladder
immutably, and re-recording provider metrics into audit rows would put a
performance history somewhere nobody expects to find one.

---

## 8. The client computes nothing

`ServiceAreaRewardCard` decides nothing: not whether to show itself, not what
tier is held, not whether a criterion is met. Every one of those arrives
resolved. A formula in React would be a second copy of the rules that nobody
could audit, that every provider could read out of the bundle, and that would
disagree with the server the first time an operator published a different
ladder.

The withheld thresholds are dropped by the **resolver**, not by the mapping to
the view and not by the component — so the numbers never enter the response at
all, let alone the bundle. A test asserts a withheld row contains no digit.

Copy is qualified throughout: _"May help you appear to more nearby customers."_
Never "will increase your requests". A test forbids the unqualified phrasings in
both English and Arabic.

The card tolerates a missing `serviceAreaExpansion` block — a cached draft or a
rolling deploy — by rendering nothing, rather than taking down the screen the
provider is trying to finish.

---

## 9. Operating it

1. Set `provider_service_area_expansion_max_km` (default 250; must stay ≤ 500).
2. `POST /v1/admin/service-area/policies` with a ladder:

   ```json
   {
     "version": "2026.09-sy-v1",
     "country": "SY",
     "tiers": [
       {
         "key": "established",
         "maxKm": 150,
         "criteria": {
           "requireVerified": true,
           "minCompletedJobs": 10,
           "maxOpenComplaints": 0,
           "maxCancellationRatePct": 20,
           "minTerminalBookings": 10
         }
       }
     ]
   }
   ```

3. Only then set `provider_service_area_expansion_enabled` to `true`.

Publishing a ladder does **not** enrol anyone — the switch and the ladder are
separate decisions on purpose, so a policy can be published and reviewed without
changing anyone's reach, and the feature can be switched off without retiring a
policy that is still the correct record of what was in force.

Correcting a ladder means publishing a new version and retiring the old. There
is no update route: editing a version would change what a provider was judged
against after they were judged.

---

## 10. Evidence

| Gate                                   | Result                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| api lint / typecheck / build           | pass                                                                                                                |
| api unit (hermetic)                    | 2872 passed, 501 DB-gated skipped                                                                                   |
| **api with DB + Redis gates ENABLED**  | **3373 passed, 0 skipped / 183 suites**                                                                             |
| web lint / typecheck                   | 0 errors                                                                                                            |
| web unit                               | 1175 passed / 89 files                                                                                              |
| web e2e (Playwright ×3 viewports)      | 535 passed, 0 failed (44 skipped by pre-existing viewport / real-API gates)                                         |
| **migration drift**                    | no difference detected                                                                                              |
| **constraint proofs on real Postgres** | one-live-per-market under an 8-way race; `NULLS NOT DISTINCT`; retire-and-republish; 3 override `CHECK` constraints |
| `pnpm audit --prod --audit-level high` | no known vulnerabilities                                                                                            |
| lockfile                               | unchanged (no new dependency)                                                                                       |

### Note for review

The API changes are **additive and gated**. The one shape change on an existing
endpoint is the new `serviceAreaExpansion` block on the onboarding draft, which
is present for every client — with the feature off it always reads
`show: false`, `allowedMaxKm === radiusPolicy.maxKm`, and
`reasonCodes: ['FEATURE_DISABLED']`.

No radius that saves today is refused after this change with the feature off.

### Not in scope

A background re-evaluation job. Tiers are resolved on read and are always
current; the stored row's freshness affects only the audit trail's completeness,
not any grant. A scheduled evaluator that emits `TIER_CHANGED` at the moment a
tier actually moves is the natural follow-up.
