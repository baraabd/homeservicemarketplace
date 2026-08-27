# Sprint 9B.11 — provider verification experience

The provider-facing side of everything Sprints 9B.2–9B.8 built on the server.

---

## 1. Reuse inventory

Taken as found, unchanged:

| Reused                                      | From                                              |
| ------------------------------------------- | ------------------------------------------------- |
| `ds/Button`, `ds/IconButton`                | provider design system                            |
| `ui/{badge,progress,skeleton}`              | shared primitives                                 |
| `useLang` (locale + `dir`)                  | `i18n/LanguageContext`                            |
| `useProviderProfile`                        | existing provider hooks                           |
| `DOCUMENT_KIND_LABELS`, `SCAN_STATE_LABELS` | the **reviewer** surface's `verification-copy.ts` |
| gradient card, halo icon, Cairo-for-Arabic  | `ProviderStatusState`                             |
| `*-copy.ts` + key-parity test               | onboarding wizard                                 |
| presign→PUT→finalize evidence pipeline      | Sprint 9B.3                                       |
| `getCsrfToken`                              | `lib/api.ts` (newly exported, not re-implemented) |

**One new shared component: `VerificationAxisBadges`.** Nothing existing renders
five independent facts as five separate things — `ProviderStatusState` renders
one status, and a badge row is not a status.

**Not reused, deliberately: the reviewer's case-state labels.** A reviewer reads
"Awaiting review" as a queue position; a provider reads the same code as "we
have your documents and you need do nothing". Same code, different audience,
different sentence.

## 2. A backend gap this sprint had to close first

`GET /v1/me/provider/verification/case` could say **what was required** and
never what had become of what was **supplied**. A provider whose passport was
being scanned, was quarantined, or was rejected saw the same screen as one who
had uploaded nothing.

The case now carries:

- `documents[]` — kind, category, `scanState`, `uploadedAt`, `superseded`;
- `latestDecision` — outcome, **reason code**, timestamp.

`PROVIDER_CASE_SELECT` names its columns rather than spreading the row, because
`reviewerNotes` sits on that same row. A wholesale select would leak it the
first time someone added a field. A test plants a note verbatim and greps the
response body for it.

**The code, never the prose.** A reason code is a stable, translatable fact the
provider can act on. The reviewer's note is internal writing about a person —
Sprint 9B.5 already keeps it off the notification for the same reason.

## 3. One place decides the screen

`deriveVerificationView` is pure and owns the precedence. Fourteen states, and
they are **not mutually exclusive** in the raw data: a suspended provider can
also have a case in review and a quarantined file. Rendering from raw fields
means every branch re-decides precedence, and two branches eventually
disagree — which is how a suspended provider gets shown an upload button.

The order mirrors the **server's** ranks (ADR 0006): account → standing →
onboarding → evidence → work access. A UI ordering these differently from the
capability service would show someone a screen the API refuses.

| State                   | Shown when                                        |
| ----------------------- | ------------------------------------------------- |
| `ACCOUNT_LOCKED`        | account ineligible or terminated                  |
| `SUSPENDED`             | standing suspended                                |
| `ONBOARDING_INCOMPLETE` | still filling in the form                         |
| `NOT_REQUIRED`          | policy asks for nothing                           |
| `NOT_STARTED`           | no case yet                                       |
| `EVIDENCE_REQUIRED`     | requirements outstanding                          |
| `SCANNING`              | everything supplied, something still `PENDING`    |
| `EVIDENCE_UNUSABLE`     | a `QUARANTINED` / `SCAN_FAILED` / `REJECTED` file |
| `READY_TO_SUBMIT`       | every requirement has a clean document            |
| `PENDING_REVIEW`        | `SUBMITTED` or `IN_REVIEW`                        |
| `CHANGES_REQUESTED`     | `ACTION_REQUIRED`                                 |
| `REJECTED`              | `REJECTED`                                        |
| `VERIFIED_ACTIVE`       | verified **and** a live grant                     |
| `VERIFIED_NO_ACCESS`    | verified, grant expired or revoked                |

Three distinctions it exists to keep:

**Verified is about the DOCUMENTS; work access is about the GRANT.** A provider
whose grant lapsed is verified _and_ cannot work. Telling them they are
unverified sends them to re-upload documents that are perfectly good.

**`PENDING` is a wait; `QUARANTINED` / `SCAN_FAILED` / `REJECTED` are an act.**
Unusable files sort above "3 documents required", because burying the one
actionable fact under a list hides it.

**A trade licence is per category.** One category's licence satisfying
another's reads fine in code and is wrong in the world.

## 4. Five axes, five badges

ADR 0005 keeps these separate because they answer different questions:

| Axis              | Source                                    | Grants access? |
| ----------------- | ----------------------------------------- | -------------- |
| Profile complete  | `primaryReason !== ONBOARDING_INCOMPLETE` | —              |
| Identity verified | `profile.verified`                        | —              |
| Can take work     | capability `SUBMIT_BID` (the **grant**)   | **yes**        |
| VIP               | _no server source — see below_            | **never**      |
| Featured          | `profile.topPro`                          | **never**      |

A single "status" pill would have to pick one, and every choice is wrong for
someone. The most damaging conflation is the last, so the note under the badges
says it in words: a provider who believed VIP unlocked work would be paying for
something it does not do.

The value is in the **text**, not only the colour — a badge whose sole signal is
hue says nothing to a screen reader. The recognition row is hidden entirely when
neither is held: "VIP — Not yet" reads as something withheld, which is a sales
message on a compliance screen.

### VIP has no server source, and is not faked

`subscriptionTier` exists in the schema (ADR 0005 axis 5, inert by design) but is
exposed by **no contract**. `ProviderProfileSummary` is documented as public, so
a commercial field does not belong there.

The badge is therefore threaded as an input that the screen currently passes
`false`. The distinction is structural and tested — VIP and Featured are
separate labels, and neither moves the access axis — and the badge becomes real
the day a source exists, without touching the component. This is the same gap
recorded in Sprint 9B.7 §"What is NOT here".

## 5. Accessibility, language and direction

- `aria-live="polite"` on the headline, so a state **change** after an upload or
  submit is announced, not only the initial load.
- `role="alert"` on failures, `role="status"` on offline.
- Every badge states its value in text.
- `dir` on the document **and** the section, so Arabic genuinely mirrors rather
  than merely right-aligning.
- Keyboard reachability and a visible focus ring on the primary action, asserted
  in a real browser — a provider who cannot use a mouse still has to be able to
  send their documents.
- Offline is first-class: this screen is used on a phone in a customer's home,
  and a failed upload that looks like a rejection is the worst misreading
  available.

Reason codes render as **instructions**, not classifications. `SUSPECTED_FORGERY`
is never shown as an accusation — a test greps for it. Being told we think you
forged a document is something to say carefully, in a letter, by a person, and
it is sometimes wrong: a scanned copy of a real passport looks odd.

## 6. Two defects the tests found

1. **The file input is exposed as a `button`** to assistive technology, so
   leaving it mounted put a "choose a file" control in the tab order of screens
   where uploading does nothing. It now renders only where an upload is
   possible. (The same mapping caused a strict-mode failure in Sprint 9B.10.)
2. **The CSRF cookie was read under the wrong name.** This file first shipped
   reading `csrf_token`; the cookie is `hsm_csrf`, so **every evidence upload
   would have been refused**. It now calls the same exported helper the axios
   interceptor uses — a second copy of "which cookie holds the token" is a rule
   that drifts, and had.

## 7. Test counts

| Suite                                                               | Tests |
| ------------------------------------------------------------------- | ----- |
| `verification-view-state.test.ts`                                   | 29    |
| `provider-verification-copy.test.ts`                                | 31    |
| `ProviderVerificationScreen.test.tsx`                               | 41    |
| `verification-case-workflow.integration.spec.ts` (new cases)        | 9     |
| `provider-verification.spec.ts` (Playwright, 2 langs × 3 viewports) | 60    |

## 8. Residual risks

1. **VIP is unwired**, as above. Structural, tested, and honest — but a reviewer
   should know the badge cannot currently light up.
2. **The upload error is deliberately generic.** The evidence routes refuse with
   codes about file shape; the screen says "try again" and lets the specific,
   actionable refusals arrive as scan states on the document list. A provider
   who uploads a 40 MB TIFF is told less than the server knows.
3. **Replace-and-resubmit relies on the server superseding** the old document.
   The UI renders `superseded` and excludes those files from the outstanding
   calculation, but nothing here forces the supersede — a server that stopped
   setting it would leave a provider stuck on a problem they had already fixed.
4. **Scan state is polled only on refetch.** There is no push, so a provider
   watching the `SCANNING` screen must reload to see it clear.
