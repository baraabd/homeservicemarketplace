# Sprint 9B.12 — Admin verification and policy UX

The reviewer's surface: a queue, the case behind each row, the evidence, the
decision, and — separately — the provider's account.

Everything here sits inside the existing admin console (`AdminDashboard`,
section `verification`). Nothing about the shell, the sidebar, the typography or
the tokens changed.

---

## 1. The two axes, and why they are not merged

A provider has two independent lifecycles, and the brief for this sprint said
plainly not to collapse them:

| Axis                  | Object             | Actions                                                    | Endpoint family                  |
| --------------------- | ------------------ | ---------------------------------------------------------- | -------------------------------- |
| **Verification case** | `VerificationCase` | assign, request changes, approve, reject, reverify, revoke | `/v1/admin/verification/cases/*` |
| **Provider account**  | `ProviderProfile`  | approve, reject, suspend, reactivate                       | `/v1/admin/providers/*`          |

Approving a case is a judgement about **documents**. Suspending an account is a
judgement about **conduct**. A single merged list would have to pick one verb for
two decisions, and a reviewer would eventually make one meaning the other — so
they render as two panels, each carrying its own server-computed action list,
and the case panel says so in as many words (`axisNote`).

They are also different in a way a merged list could not express: a provider can
be VERIFIED and SUSPENDED at once. That is not a contradiction — the documents
are good and the account is not — and the capability resolver already ranks
SUSPENDED above verification for exactly this reason (ADR 0006, and the rank-3
fix in 9B.7).

**There is no transition table in the frontend.** `CaseActionsPanel` renders
exactly `case.availableActions`; `ActionsBlock` in `VerificationSection` renders
exactly `provider.availableActions`. The only client-side lookups are of _names_
— which label, which reason list, which confirmation sentence, which route an
action posts to. None of them decides whether an action is offered.

That absence is load-bearing, and it is asserted directly: a case in `SUBMITTED`
with `availableActions: ['assign', 'requestAction']` renders those two buttons
and no others, even though `approve` is legal from `SUBMITTED` in the abstract.
A component that had quietly grown its own rules would pass a test that only
checked "approve appears for SUBMITTED"; it fails this one.

The failure mode this prevents is on the record. Sprint 9 (`docs/sprint-09/INSPECTION.md`
D-3) found the account panel deriving `canApprove = status === 'DRAFT' || …`,
which contradicted the backend's `from: ['PENDING_REVIEW']` and put an enabled
Approve button on every DRAFT provider. Clicking it 409'd.

---

## 2. What a reviewer sees

### Queue (`VerificationQueuePanel`)

Search by provider name, and filters for state, policy version, and a submitted
date window. **Every filter goes to the server.** A client-side filter over one
page of a cursor-paged list would show "3 results" when the answer is thirty, and
a reviewer working a backlog would believe the smaller number.

- search applies on **Enter**, not per keystroke — a request per character
  produces a dozen queries whose answers arrive out of order;
- an emptied filter is **deleted from the query**, never sent as `""`;
- a 403 shows a permission message with **no retry** (retrying a 403 forever is
  not a recovery); a 500 shows a retry;
- an error is never rendered as an empty queue. "Nothing to review" and "we could
  not ask" are different facts, and a reviewer who confuses them goes home.

The date window is parsed server-side (`parseRange`), which rejects an
unparseable date and an inverted range with distinct codes rather than silently
returning everything.

### Case detail (`AdminVerificationCaseWorkspace`)

State, policy version, work-access status, requirement checklist, restricted
evidence, actions, decision history, audit history.

The policy version is on screen because a reviewer judges under the rules in
force **at submission**, not today's.

### Work access (`WorkAccessPanel`)

Whether the provider can take work **right now** — a different fact from the case
state, and the one a revoke decision turns on.

The panel renders the server's computed `active`, never the grant's `status`
column. A row can read `ACTIVE` while the access has already lapsed: access is a
read-time predicate (`endsAt > now`, ADR 0013) precisely so a failed expiry cron
cannot leave someone working. Showing the column would have a reviewer revoke
something already gone, or decline to revoke believing it live.

`source` stays visible (`VERIFIED_DOCUMENTS` / `MANUAL_OVERRIDE` /
`LEGACY_BACKFILL`) so earned access is distinguishable from granted.

### Restricted evidence

Metadata comes with the case; **bytes never do**. Opening a document is its own
request to `GET /v1/verification/documents/:id/content` — the only route that
serves restricted evidence (ADR 0009 §3), authorized per request under the
dedicated `verification:evidence:view` permission and written to the access
audit.

- `viewable` is computed **server-side**. The client does not decide it from the
  scan state; that would put an authorization rule in React and make every future
  scan state viewable by default.
- The reviewer is told their reads are recorded. Detection only deters people who
  know about it.
- The response is `Content-Disposition: attachment` with `no-store`, so the
  document is saved and inspected in the reviewer's own viewer — not rendered
  inline in a tab inside our origin, where active content would run with our
  cookies.
- A failure says only that the document could not be opened and that the attempt
  was recorded. The server answers a denial and a missing document identically,
  on purpose; claiming to know which happened would be inventing information.
- The object URL is released one task after the click. Holding it open would keep
  someone else's passport alive in the page for the lifetime of the tab, which is
  the lifetime the streaming design exists to avoid.

**This sprint fixed an inert control.** `VerificationEvidencePanel` has exposed
`onView` since 9B, and no caller passed it: the view button on every document did
nothing. Both surfaces now pass `useEvidenceDownload`.

### Decisions

Every decision that needs a reason captures one **before anything is sent**, in a
confirmation that says what the action does:

| Action        | Confirmation says                                          |
| ------------- | ---------------------------------------------------------- |
| approve       | approving opens work access for this provider              |
| reject        | rejecting closes the case; the provider must start again   |
| revoke        | revoking ends the ability to take work immediately         |
| anything else | this is recorded against your account and cannot be undone |

The note is labelled as reviewer-only. A reviewer who believed otherwise would
either write nothing useful or write something they would not want read back to
them.

Each command carries `expectedState` — the state the reviewer was **looking at**.
Without it the server cannot tell that this reviewer is deciding a case someone
else has since moved, which is the whole point: two reviewers with the same case
open must not both decide it.

### Failures a reviewer must tell apart

| Status | Shown as                                    | Actions      |
| ------ | ------------------------------------------- | ------------ |
| 409    | "Someone else got there first" + **Reload** | stay visible |
| 403    | permission message                          | **replaced** |

Offering buttons that will be refused teaches people to click and hope. A
conflict is the opposite case: it is recoverable, so the actions stay and the
reviewer can reload and decide again.

### Policy versions (`VerificationPolicyPanel`)

List with live state and required documents; publish a new version; retire the
live one.

**No edit control exists anywhere** — not disabled, absent. Editing a published
version would change what a provider was judged against _after_ they were judged.
Version format and scope-overlap rules live on the server (ADR 0010); the panel
shows the server's refusal rather than keeping a second copy of those rules that
would disagree the first time either changed.

Retire is offered only on a live version.

---

## 3. Accessibility and bilingual behaviour

- The confirmation is `role="dialog"` + `aria-modal="true"`, takes focus when it
  opens, returns focus to the button that opened it, and closes on **Escape**. A
  modal a keyboard user cannot leave is a trap.
- Errors are `role="alert"`; loading states carry `aria-busy`.
- Every string is in `verification-copy.ts` in both languages, with the existing
  key-parity test. Codes stay on the wire; prose stays in the copy map.
- Direction comes from `LanguageContext` and is stamped on each panel, verified
  in a real browser rather than a DOM shim.

---

## 4. Reused versus newly created

**Reused, unchanged:**

- `AdminDashboard` shell, sidebar, section routing, typography, tokens
- `VerificationSection` — the provider-account axis, its drawer, its audit block
  and its action block
- `VerificationEvidencePanel` — requirement checklist, document rows, scan badges
- `verification-copy.ts` (`UI`, `CASE_STATE_LABELS`, `DOCUMENT_KIND_LABELS`)
- `useVerificationCase`, `useAdminProviders` and `adminProvidersQueryKeys`
- `api` client (cookie session, CSRF echo), `LanguageContext`, TanStack Query
- Playwright `stubApi` / `seedLanguage` / `signedInAdmin` fixtures

**New, and why:**

| File                                                    | Why it did not already exist                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `VerificationQueuePanel`                                | there was no queue at all — cases were reachable only through one provider's drawer |
| `CaseActionsPanel`                                      | the account axis had an action block; the case axis had none                        |
| `WorkAccessPanel`                                       | `workAccess` is new on the contract this sprint                                     |
| `VerificationPolicyPanel`                               | 9B.2 shipped the policy API; no admin surface read it                               |
| `AdminVerificationCaseWorkspace`                        | composition: owns the requests, owns nothing else                                   |
| `queue/verification-queue-api.ts`                       | queue, case, audit and the six commands                                             |
| `evidence/evidence-download.ts` + `useEvidenceDownload` | opening a restricted document, shared by both surfaces                              |

No new UI framework, no second design system, no second query-key factory, no
second i18n mechanism.

---

## 5. Contract and API changes

- `AdminWorkAccessStatus` and `AdminVerificationCase.workAccess` — the read-time
  predicate, computed server-side.
- `AdminVerificationQueueItem` / `AdminVerificationQueuePage` /
  `AdminVerificationQueueQuery`, including `submittedFrom` / `submittedTo`.
- `ListQueueDto` accepts the date window; `parseRange` rejects unparseable and
  inverted ranges with distinct codes.

---

## 6. Tests

**Component (vitest), 77 in `features/admin-verification`:**

- `CaseActionsPanel.test.tsx` — 19, headed by the negative assertion that the
  panel renders nothing the server did not offer
- `VerificationQueuePanel.test.tsx` — 29, mostly assertions about the _request_
- `VerificationPolicyPanel.test.tsx` — 11, headed by "no edit control anywhere"
- `AdminVerificationCaseWorkspace.test.tsx` — 7, the wiring the panels cannot see
- `evidence-download.test.ts` — 11, the audited route and the released object URL

**Browser (Playwright), 17 at the desktop project:** queue, evidence review,
request changes, rejection, approval, suspension, reactivation, revocation, stale
conflict, unauthorized reviewer, the axes as separate blocks, the dialog's focus
and Escape, policy append-only, and the whole surface in Arabic RTL.

The admin console is a declared desktop surface (a 256px sidebar beside a data
table); the existing admin suite documents the same policy, and these flows are
gated to the desktop viewport rather than asserting a surface the console was
never designed for.

**Causal proof, not just green:** removing `onView={evidence.open}` from the
workspace turns exactly the two evidence tests red and leaves the other five
green.

---

## 7. Found while building this

`apps/web`'s `typecheck` script ran `tsc --noEmit` against a `tsconfig.json`
whose `files` is `[]` and which delegates everything to project references. With
project references, `tsc --noEmit` checks **nothing** and exits 0 — so the web
typecheck gate had been vacuous, and a genuine error (a required `lang` prop
missing on `VerificationEvidencePanel`) passed it. Only `pnpm build`, which runs
`tsc -b`, would have caught it.

The script is now `tsc -b`, which reports that error. Fixed here rather than
noted, because a gate that cannot fail is worse than no gate: it produces green
reports that mean nothing.

---

## 8. Remaining risks

- `VerificationSection` (the account axis) still has no `data-testid` hooks; its
  Playwright coverage targets visible labels, so a copy change there would need
  the spec updated with it.
- The reason shortlists in `CaseActionsPanel` are a convenience, not a
  restriction — the server owns the reason enum. If a reason code is added
  server-side it will not appear in the dropdown until it is added here too.
- Policy publishing is exposed to any admin holding the policy permission; the
  split between a reviewer role and a policy-owner role remains a
  Product/Security decision, recorded rather than guessed (same note as 9B.7).
