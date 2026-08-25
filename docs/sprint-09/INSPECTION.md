# Sprint 9 — pre-implementation inspection

Read-only audit performed before any edit, per CLAUDE.md ("inspect current
codebase, plan before coding"). Every claim below cites the file it came from.

## What already exists (and must be reused, not rebuilt)

| Area                      | Location                                             | State                                                                                                            |
| ------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Lifecycle axes            | ADR 0005                                             | Accepted. Six axes + 9-rank precedence table.                                                                    |
| Capability decision point | `provider/capability/provider-capability.service.ts` | One service, deny-by-default, first-deny-wins. **Ranks 6 and 7 are written but inert.**                          |
| Work-access grant table   | `ProviderWorkAccessGrant`                            | Table + read path exist. Not consulted for authz.                                                                |
| Verification enum         | `ProviderVerificationState`                          | `UNVERIFIED/PENDING/VERIFIED/REJECTED/EXPIRED`. No document flow.                                                |
| Onboarding state          | `ProviderOnboardingState`                            | Sprint 8 added `DOCUMENTS_REQUIRED` — the state this sprint consumes.                                            |
| Submission snapshot       | `ProviderOnboardingSubmission`                       | Immutable, `policyVersion`-stamped. The pattern verification policy should copy.                                 |
| Outbox                    | `infrastructure/outbox`                              | `enqueue(input, tx)` is transaction-aware with `dedupeKey` producer idempotency.                                 |
| Admin transition helper   | `admin-verification.service.ts#transition`           | Already does conditional state writes (`decideIfInStatus` scoped to `from`), audit + notification inside the tx. |
| Storage port              | `infrastructure/storage/storage.port.ts`             | `presignUpload` only. Server-generated keys.                                                                     |

## Confirmed gaps and defects

### D-1 — Public media read is unauthenticated (blocks reuse for identity evidence)

`media.controller.ts` — `GET /v1/media/files/*` is `@Public()`, resolves any key
from the URL path, and sets `Cache-Control: public, max-age=31536000, immutable`.
There is no ownership check and no visibility concept. Storing identity documents
anywhere reachable by this route would make them world-readable and CDN-cached.
**Consequence:** identity evidence needs a separate private namespace and its own
authorized-read route. Confirms the sprint's "do not reuse public request-media URLs".

### D-2 — No file-signature (magic byte) validation

`local-disk-storage.adapter.ts` validates the HMAC signature, declared
content-type and declared size, but never inspects the leading bytes of the body.
A caller may declare `image/png` and upload an arbitrary payload. There is no
`MediaAsset` row, so no detected MIME, hash, size, or scan state is persisted.

### D-3 — Admin UI offers a transition the backend forbids ← **confirmed**

`VerificationSection.tsx:501`

```ts
const canApprove = status === 'DRAFT' || status === 'PENDING_REVIEW';
```

`admin-verification.service.ts#approve` declares `from: ['PENDING_REVIEW']` and
comments that "DRAFT is NO LONGER an approvable source state". The UI therefore
renders an enabled Approve button for DRAFT providers which the backend answers
with 409. Client and server hold different copies of the same rule — the exact
class of drift ADR 0006 exists to prevent.

### D-4 — Approval grants marketplace access with no evidence

`approve()` writes legacy `status = ACTIVE`, which is the only marketplace gate
in force (capability service, rank 7 comment). No document is seen, no
`VerificationCase` exists, no `ProviderWorkAccessGrant` is issued, and
`ProviderVerificationState` is untouched. A provider can hold full work
capabilities while `verificationState = UNVERIFIED`.

### D-5 — No self-review prevention, no reason codes

`transition()` never compares `adminUserId` to the target profile's `userId`.
`AdminProviderRejectDto.reason` and `AdminProviderSuspendDto.reason` are
`@IsOptional()` (relaxed in Sprint 5.1.4 for a one-click UI), so a decision can
be recorded with no justification at all.

### D-6 — Decisions do not emit outbox events

`transition()` publishes `securityEvents.emitProviderStatusChanged` post-commit
(in-process, fire-and-forget). Nothing is enqueued to the transactional outbox,
so a decision has no at-least-once downstream record.

## Models that do not exist yet

`MediaAsset`, `VerificationCase`, `VerificationDocument`, `VerificationDecision`,
`ProviderPortfolioItem`, and any verification-requirement policy table.

## MongoDB

ADR 0002 governs. No current production consumer for portfolio drafts was found;
portfolio metadata therefore stays in PostgreSQL per the sprint instruction, and
no new Mongo collection is introduced.
