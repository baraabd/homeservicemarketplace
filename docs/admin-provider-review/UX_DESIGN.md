# Admin provider review workspace

Delivery mode: B for the approved Admin provider-review journey. Backend policy remains server-owned. The existing provider onboarding design is outside this change.

## Reviewer journey

Open a provider from the directory or review queue, inspect the submitted application in six familiar sections, review identity evidence and specialty/portfolio decisions, then approve the application or send specific changes back. A single dossier keeps the relevant facts together while explicitly separating account standing, application review, identity verification, and actual work eligibility.

The canonical page is `/admin/providers/:providerProfileId`. Selection survives refresh and can be linked from the users directory. The submitted application is the initial source. Current data is a separately labelled view; missing historical fields never silently fall back to live values. An older partial snapshot carries an explicit explanation.

## Layout and Admin identity

Retain the slate navigation, warm amber accent, Inter/Cairo typography, rounded surfaces, and light/dark modes. Feature-local semantic tokens own all new colors and geometry. No provider-blue tokens or onboarding form dependencies are introduced.

At desktop widths the dossier and a compact sticky review panel share the page. The six sections have persistent in-page navigation. At smaller widths the review panel follows the dossier in document order; all fields wrap and controls remain at least 44 pixels. Evidence and gallery details use accessible modal primitives with focus containment, Escape dismissal, focus return, and readable scrolling at zoom.

## Information and decisions

1. Basics: name, provider type, contact proof and business details.
2. Services: requested and approved specialties, experience, equipment and transport.
3. Work area: named areas, locality, radius and workshop information permitted by the API.
4. Working hours: actual weekly intervals and their stored timezone.
5. Public profile: headline, biography, optional gallery and moderation outcomes.
6. Submission: consent and submission identity/version, review provenance and history.

Identity evidence is metadata-only until the existing authenticated audited download is explicitly requested. No restricted storage keys, raw public-media links, or evidence bytes enter the query cache. An empty optional gallery is explained without creating a client-side eligibility rule.

Only server-returned actions are offered. The approval dialog explains the actual application decision and carries the submission identity and review revision the reviewer inspected. Structured correction requests have a selected task/field, reason and provider-facing explanation. Internal notes are separately labelled. A conflict retains unsent explanations and asks the reviewer to refresh and inspect the changed application before retrying.

## Acceptance evidence

Component tests cover source selection, missing historical facts, server action gating, exact decision payload, retained input on conflict and Arabic direction. Integration/browser acceptance covers real submission to review to updated provider capabilities, restricted evidence denial, category/portfolio decisions, keyboard/focus, both languages/themes and representative mobile/tablet/desktop sizes. Test success alone is not visual acceptance.

## Gap matrix and implementation

| Surface               | Previous gap                                                                     | Implemented behavior                                                                                                     | Server dependency                                           |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Provider detail       | Summary without the six submitted tasks                                          | Six-section dossier with a separate current-profile view and explicit historical gaps                                    | Immutable `reviewSnapshot` and current snapshot             |
| Final approval        | Separate application and evidence decisions could leave inconsistent work access | Confirmation echoes the exact submission and opaque revision; updated capabilities come from the response                | Atomic review command and effective capabilities            |
| Return for correction | Unstructured review notes                                                        | Task-specific provider instructions, including a document target that opens verification; internal notes remain separate | Structured feedback contract                                |
| Service requests      | Implicit approval risk                                                           | Explicit review per requested specialty                                                                                  | Per-application available actions                           |
| Identity evidence     | Restricted media needs its own read boundary                                     | Metadata checklist, explicit audited download, safe case action dialogs                                                  | Fresh evidence permission and protected reader              |
| Portfolio             | No integrated item review                                                        | Explicit authenticated inspection, per-item revision decisions, provider-facing rejection reason and history             | Portfolio permission, private media and moderation endpoint |
| Concurrent editing    | Stale tabs can overwrite decisions                                               | Conflict freezes confirmation; refresh preserves drafts, including transient refresh failure                             | Revision conflict and idempotency                           |

The normal Admin provider route mounts this workspace without a new frontend feature flag. Server policy and evidence/work-access flags continue to govern eligibility. Final approval confirms the combined submitted application; rejecting identity evidence and requesting a fresh case remain explicitly named case actions. Category review has no internal-note field because the existing category endpoint does not persist that field.

Component ownership is split between route orchestration, dossier projection, identity actions, category decisions, portfolio inspection, decision form, shared review dialogs and visual primitives. TanStack Query reuses the Admin provider query-key factory. No new client state store or API client is introduced. Unsent review prose stays in mounted component state and is never written to browser storage.

Dialogs reuse Radix focus containment, Escape dismissal and focus return. A narrow-screen link jumps directly to the review decision panel; no fixed action bar covers long forms. Restricted images use authenticated blob reads only after explicit inspection, never query-cached credentials or direct authenticated image URLs. Object URLs are revoked on close and cannot be reused on reopen. Revoked dossier read permission removes the protected content; transient refresh failures retain the reviewer's input and expose retry.

## Verification recorded during implementation

- `pnpm --filter @homeservicemarketplace/web exec tsc -b`: passed.
- `pnpm --filter @homeservicemarketplace/web exec eslint src/app/features/admin-provider-review`: passed with no warnings.
- `pnpm --filter @homeservicemarketplace/web exec vitest run src/app/features/admin-provider-review/tests`: 10 tests passed in two files. The checks cover source separation, historical gaps, revoked read permission, Arabic direction, exact approval command, refresh failure during conflict, preserved instructions/private notes, idempotent retry, focus return, private preview lifetime and item revision moderation.
- Browser route, screenshots, accessibility matrix and real API/database acceptance are tracked in `TEST_PLAN.md` and the final CI report. Local component assertions are not visual acceptance or proof of persistence.
