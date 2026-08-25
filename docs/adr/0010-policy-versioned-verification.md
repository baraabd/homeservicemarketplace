# ADR 0010 — Verification requirements are versioned data, not code

- **Status:** Accepted
- **Date:** 2026-08-24
- **Sprint:** 09
- **Related:** [0008](0008-category-hierarchy-and-onboarding-draft.md) (the onboarding policy this mirrors), [0009](0009-restricted-identity-media.md) (what the evidence is), [0013](0013-evidence-to-work-access-capability-transition.md) (what a decision unlocks)

## Context

What a provider must prove differs along three independent dimensions:

- **Country** — a Syrian national ID, a Saudi Iqama, and a UAE Emirates ID are
  different documents with different rules.
- **Provider type** — an `INDIVIDUAL` proves who they are. A `BUSINESS` proves
  the company exists _and_ that the person submitting is authorised to act for
  it: two documents plus a link between them.
- **Service category** — electrical and gas work are licensed trades in most
  jurisdictions; furniture assembly is not.

These rules change, and they change on a legal timetable nobody in the codebase
controls. Two failure modes follow directly:

1. **Hardcoding them** makes a legal change a code deploy, and makes the
   production rule set invisible to the people who own it.
2. **Reading them live** means a rule published on Tuesday retroactively
   invalidates every case submitted on Monday. A provider is then rejected for
   failing a requirement that did not exist when they applied.

The repository already solved the second problem once, for onboarding:
`ProviderOnboardingSubmission` stamps `policyVersion` and snapshots what the
policy evaluated, precisely so "a later rule change cannot retroactively fail a
queued application". Verification needs the same guarantee for a higher-stakes
decision.

## Decision

### 1. Requirements live in `VerificationRequirementPolicy`, keyed by version

A row is a **published, immutable** requirement set:

```
version        "2026.08-sy-v1"   -- opaque, sortable, human-readable
country        "SY"
providerType   INDIVIDUAL | BUSINESS | null  (null = both)
categoryId     null = applies to every category
requirements   Json   -- the document kinds required, and their rules
publishedAt / retiredAt
```

`requirements` is JSON because its shape is versioned by `version`, not by the
schema — the same reasoning that put `snapshot` in JSON on
`ProviderOnboardingSubmission`. A new document kind must not require a migration.

**Nothing is seeded as production rule.** The repository ships a _development_
policy fixture and an explicitly non-authoritative example. Real country rules
are a product and legal decision, recorded as outstanding in the sprint report.
Hardcoding a guess about Syrian licensing law into a migration would be inventing
law, and it would be invisible to whoever is accountable for it.

### 2. Resolution is most-specific-wins, and is a pure function

```
resolve(country, providerType, categoryIds, at) → ResolvedRequirements
```

Specificity order: `(country, type, category)` beats `(country, type)` beats
`(country)` beats the global default. Category requirements **union** — a
provider offering two licensed trades must produce both licences, because
holding an electrician's licence says nothing about gas.

The function takes `at` and reads only policies live at that instant, so it can
be replayed for a historic case. It performs no I/O; the caller supplies the
candidate policies. That keeps it exhaustively testable without a database, in
the same spirit as `ProviderCapabilityService`'s two-read discipline.

### 3. A case is stamped at submission and judged under that stamp

`VerificationCase.policyVersion` is written once, when the provider submits. The
reviewer's checklist, the completeness computation, and any later re-evaluation
all resolve against **that** version. A policy published afterwards has no effect
on an open case.

Re-verification (expiry, or a rule change ops decides to apply) creates a **new
case** under the current version. It never rewrites the old one — the old case is
the truthful record of what was asked and what was shown.

### 4. Four evidence kinds, one extensible enum

`INDIVIDUAL_IDENTITY`, `BUSINESS_REGISTRATION`, `AUTHORIZED_REPRESENTATIVE_IDENTITY`,
`CATEGORY_LICENSE`. The fourth carries the `serviceCategoryId` it satisfies, so
one case can hold several licences and the checklist can say which trade is still
missing.

`AUTHORIZED_REPRESENTATIVE_IDENTITY` is deliberately distinct from
`INDIVIDUAL_IDENTITY`. For a business, the person uploading is not the subject of
the verification — the company is — and conflating them loses the question
"is this human allowed to speak for this company?", which is the one that matters
for fraud.

### 5. Requirements are computed, never trusted from the client

The provider's UI renders a checklist from the server's resolution. The server
recomputes completeness at submission and again at decision time. A client that
posts "I have satisfied everything" is ignored.

## Alternatives rejected

**A TypeScript rules module.** Readable and testable, but every legal change is a
deploy, historic replay needs the old commit, and the people accountable for the
rules cannot see them.

**A rules engine (JSON Logic, OPA).** Real power for rules genuinely more complex
than "which documents". These are a set-membership question; an engine adds a
second language for a lookup.

**Live evaluation with no versioning.** One migration simpler, and it breaks the
guarantee this ADR exists to provide.

**Reusing `ProviderOnboardingSubmission.policyVersion`.** Same mechanism, but
onboarding completeness and identity requirements change on different timetables
for different reasons. Sharing a version string couples two unrelated policies.

## Consequences

**Good** — a legal change is a published row, not a deploy; pending cases are
immune to rule changes; historic decisions are replayable and defensible;
country/type/category rules compose without a combinatorial explosion of code
paths.

**Costs / risks**

- **An unpublished or missing policy must fail closed.** Resolution returning
  "no requirements" would mean "verified with no evidence". Resolving to nothing
  is an error, not an empty set — asserted by test.
- **JSON `requirements` is schema-less.** Mitigated by validating it against a
  zod schema at publish time, so a malformed policy cannot be published.
- **Operators can publish a bad policy.** Publication is audited and retirement
  is non-destructive, so a bad version can be retired without erasing what cases
  were judged under it.
- **Most-specific-wins needs a tie-break.** Two policies at equal specificity are
  a publication error; the resolver throws rather than picking one.

## Revisit

- An admin UI for publishing policies, once product owns real country rules.
- Per-document expiry rules (a licence valid to a date on its face), which
  interact with the re-verification trigger in [0013](0013-evidence-to-work-access-capability-transition.md).
