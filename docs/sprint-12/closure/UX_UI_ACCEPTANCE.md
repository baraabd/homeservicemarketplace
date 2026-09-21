# Sprint 12F — UX/UI acceptance record (Admin dispute workspace)

Scope: `/admin/disputes/:caseId` only. Governed by
`.claude/rules/ux-ui-design-policy.md`. **Mode B** for this named surface;
everything else in the sprint stays Mode A/C.

Design permission is **not** visual acceptance. This document records the target,
the rationale and the evidence that exists — and states plainly that human
visual acceptance has not happened.

---

## 1. The defect being corrected

The workspace rendered all four sections in one column and placed four
`<a href="#case-…">` links above them.

That row **looked like navigation and behaved like a table of contents.** It
scrolled; it never reduced what was on screen. A reviewer deciding a case had
the proposal, the private evidence, the event timeline and the source facts
competing for the same viewport. Worse, the _verified source records_ — the only
content on the page the server vouches for — sat inside a `<details>` that
defaulted to closed, beneath sections that were all already expanded.

Two named user goals were therefore unsupported: _"read only the section I am
working in"_ and _"see the facts before I decide."_

---

## 2. Target

Six single-visible panels, per the brief's written target:

| #   | Tab                     | Content                | Origin                                  |
| --- | ----------------------- | ---------------------- | --------------------------------------- |
| 1   | Verified source records | source-labelled facts  | promoted out of a collapsed `<details>` |
| 2   | Information and replies | `WorkspaceInformation` | unchanged                               |
| 3   | Private evidence        | `WorkspaceEvidence`    | unchanged                               |
| 4   | Proposals and decisions | `WorkspaceSolutions`   | appeals removed                         |
| 5   | Appeals                 | `WorkspaceAppeals`     | split out of solutions                  |
| 6   | Event timeline          | `WorkspaceTimeline`    | unchanged                               |

Persistent context — next action, assigned reviewer, parties, due date — stays
in the aside **outside** the tabs, so no blocker is hidden behind a tab.

---

## 3. Design decisions and their rationale

- **Radix `Tabs`, already a dependency (1.1.3).** Roving focus, arrow/Home/End
  and the tab↔panel relationships come from the library, not a second hand-rolled
  implementation. Same primitive as the accepted provider review tabs.
- **Tab ids live in the web app, not `contracts`.** A tab is a way of showing a
  case, not a fact about one. Publishing them as a shared contract would invite
  precisely the second client-side authority this sprint exists to prevent.
- **Inactive panels stay mounted, `hidden`.** Retains unsent text and open
  disclosures; `hidden` removes them from layout, the accessibility tree and
  sequential focus. Verified by test #2.
- **Selection in `?caseTab=`, written with `replace`.** Reload and deep links
  work; walking six sections does not bury the inbox six history steps back.
  Every unrelated filter/cursor parameter is preserved (test #3).
- **Legacy `#case-…` anchors still select and focus their panel** (test #4), so
  existing links and notification deep links keep working.
- **Tokens only.** Every colour is an existing `--case-*` token; the selected-tab
  treatment reuses the `.case-steps li[aria-current]` idiom already in the design
  system. No new palette, no one-off hex values.
- **Two-column tab grid at 320px, three from 640px**, `overflow-wrap: anywhere`,
  `min-height: 52px` — so six long Arabic labels wrap instead of forcing a
  horizontal scrollbar, and targets stay above the 44×44 project minimum.
- **Participant workspace deliberately unchanged.** The brief names the Admin
  workspace. Changing the Seeker/Provider dispute journey would be scope the task
  did not authorise; it keeps its stacked layout and its anchor row.

---

## 4. Evidence status — read this before quoting anything

| Check                                       | Status           | Note                                              |
| ------------------------------------------- | ---------------- | ------------------------------------------------- |
| Six real tabs, one visible panel            | **PASS**         | route-level test, real route composition          |
| Hidden-panel accessibility + retained mount | **PASS**         | `tabindex="-1"`, not in a11y tree                 |
| Keyboard-only operation                     | **PASS** (jsdom) | `ArrowRight`, `End`; **not** a real-browser check |
| RTL / Arabic labels                         | **PASS** (jsdom) | `dir="rtl"` at the real route                     |
| Browsing sends no command                   | **PASS**         | 0 POST/PATCH/PUT/DELETE                           |
| **Widths 320/390/430/768/1024/1440**        | **NOT_RUN**      | host memory — see below                           |
| **Light/dark themes**                       | **NOT_RUN**      | same                                              |
| **200% browser zoom**                       | **NOT_RUN**      | same                                              |
| **axe / automated a11y**                    | **NOT_RUN**      | same                                              |
| **before/after screenshots**                | **NOT_RUN**      | none captured; none may be cited                  |
| **Screen-reader + human usability**         | **BLOCKED**      | requires a person; no automated substitute        |
| **Design review of the new target**         | **BLOCKED**      | requires the design owner                         |

The responsive and contrast behaviour above is **designed for and reasoned
about, not measured.** CSS intent is not visual acceptance. Until the matrix in
`HANDOFF.md` §4 runs and the PNGs are inspected by a human, this surface is
**design-complete and visually unaccepted.**

---

## 5. Continuation — Admin dashboard dispute summary

Scope added 2026-09-20 (`6155a14`): the `/admin` dashboard. Mode B, same policy.

### The gap

The dashboard opened with the provider approval centre — four metric tiles and
a live queue — followed by a KPI row whose only dispute signal was a single
`disputesOpen` total. An Admin could tell at a glance how many provider
applications were waiting, but had to leave the dashboard to learn whether any
case was **unassigned**, **past its deadline**, or **waiting on an independent
appeal**. Those three decide whether somebody has to act today.

The result read as two tools sharing a shell rather than one Admin product.

### The change

`DisputeCenterSummary` places the four server-computed counts beside the
approval centre, reusing its `.ac-metric` markup, its `approval-center.css` and
its header/eyebrow/hint rhythm. `overdue` takes the emphasis slot that
`pendingReview` takes on the provider side, because it is the equivalent
"act now" signal.

### Honesty rules applied

- **No fabricated numbers.** All four come from `GET /v1/admin/dispute-workspaces`,
  computed server-side by four `count()` queries over the whole table and scoped
  to exclude cases the reader is a party to. Nothing counts loaded rows.
- **Failure is visible.** A failed request renders `countUnavailable`, never a
  zero, so "no overdue cases" and "we could not ask" cannot be confused. Tested.
- **No invented deep links.** The queue endpoint accepts `state`, `mine` and
  `cursor` only. There is no `unassigned` or `overdue` filter parameter, so the
  tiles link to `/admin/disputes` plainly rather than promising a filter the
  server does not implement. Filtering stays with the inbox's own control.

### Evidence status

| Check                              | Status                        |
| ---------------------------------- | ----------------------------- |
| Four server counts rendered        | **PASS** (route-level test)   |
| Failure shows "unavailable", not 0 | **PASS**                      |
| No internals leaked on error       | **PASS**                      |
| Arabic copy on the dashboard       | **PASS** (jsdom)              |
| Widths / themes / zoom / axe       | **NOT_RUN** — CI on `6155a14` |
| Human visual acceptance            | **NOT_RUN**                   |

The dashboard, like the dispute tabs, is **design-complete and visually
unaccepted.** No screenshot of either surface has been inspected by a person.

---

## 6. Accessibility correction — source facts (`816a68c`)

The Overview panel's fact list failed axe `definition-list` (serious) once it
became visible: the Source and Recorded lines were siblings of `<dd>` inside the
grouping `<div>`, which invalidates the whole `<dl>`. 79 nodes were reported.

Fixed by moving both lines **inside** the `<dd>` — which is also what they mean.
No rule suppressed, no `aria-hidden`, no provenance removed. `cw-facts` was
restored to the section so the existing `dd`/separator rules apply again and the
rendering is unchanged.

Guarded by `workspace-overview-semantics.test.tsx` (5 cases), proven by mutation.

### Corrected status — Admin dashboard dispute summary

| Item                        | IMPL         | AUTO | BROWSER       | VISUAL  | PROD                             |
| --------------------------- | ------------ | ---- | ------------- | ------- | -------------------------------- |
| Dispute summary on `/admin` | **REVERTED** | n/a  | **FAIL (CI)** | NOT_RUN | **BLOCKED BY CAPABILITY DESIGN** |

It is **not** on `/admin` and must not be described as if it were. It needs a
server-provided granular capability (`canReadDisputeQueue` or equivalent) before
the dashboard may ask the dispute queue anything; without it every Admin
dashboard load emits a 403. That is a contract slice, not a UI tweak.

---

## 7. Screenshots actually inspected — CI run `35567531058` (`3bc9ffb`)

Downloaded `dispute-workspace-real-evidence` (24 PNGs) and
`admin-review-real-api-evidence` (672 PNGs) from the final green run and opened
representative frames. This section lists what was **looked at**, not what
exists on disk.

| File                       | Viewport | Lang | Theme | Surface                               | Result                                                                               |
| -------------------------- | -------- | ---- | ----- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| `reviewer-en-390.png`      | 390      | EN   | light | Admin dispute, Information tab        | PASS — 6 tabs, counts 3/1/1/3/1/17, "Section 2 of 6", one visible panel, no overflow |
| `reviewer-ar-320.png`      | 320      | AR   | light | Admin dispute, Information tab        | **DEFECT FOUND** — correct RTL and no overflow, but tab labels broken mid-word       |
| `reviewer-ar-768.png`      | 768      | AR   | light | Admin dispute, Information tab        | PASS — 3 columns, every label on one line, RTL order correct                         |
| `dossier-en-light-390.png` | 390      | EN   | light | Provider review, Submission & consent | PASS — 6 tabs, "Section 6 of 6", one panel                                           |

### The defect, and why it mattered

At 320–639px the tab grid was two columns. Once the icon, gap and count badge
are removed, a column leaves roughly 90px for the label — narrower than the word
"Information" — so `overflow-wrap: anywhere` did exactly what it was told and
split words in half. English degraded to "Informati / on and / replies";
Arabic degraded much worse, rendering "المعلومات والردود" as
"المعا / ومات / والردو / د", breaking a cursive script mid-word.

**No automated gate caught this.** Axe passed, and the overflow assertion passed
because nothing overflowed — the text was legible-ish, just wrong. It was found
by opening the PNG, which is the entire reason the task requires inspection
rather than existence checks.

Fixed by collapsing the tab list to one column below 640px, the same thing
`.ac-metrics` already does on narrow screens. The provider review tabs were left
alone: their labels are short enough to wrap naturally at two columns, and that
surface is out of scope.

### Provider review — what the 390px frame confirms

Account (`Active`), Application (`Awaiting review`), Identity verification
(`Not verified`) and Work access (`Not enabled`) render as four **separate**
states, not one "approved" boolean; the Submitted-application / Current-profile
toggle is present; internal notes are labelled reviewer-only; and every entry in
Current permissions reads `Unavailable` before approval.

### Still NOT_RUN

Dark-theme frames, 430/1024/1440 in both languages, 200% browser zoom and
screen-reader review were not opened or performed. **Human visual acceptance
remains outstanding for every surface.**

### Fix verified — CI run `35569900436` (`ad5f1f9`), all 17 jobs green

Re-downloaded `dispute-workspace-real-evidence` from that run and reopened the
two frames that showed the defect:

| File                  | Viewport | Lang | Result after fix                                                                                                                                                                                                                     |
| --------------------- | -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reviewer-ar-320.png` | 320      | AR   | **PASS** — "وقائع من السجلات", "المعلومات والردود", "الأدلة الخاصة", "الحلول والقرارات", "الاستئنافات", "سجل الأحداث" each on ONE line. No mid-word breaking. RTL order and count placement correct. One visible panel. No overflow. |
| `reviewer-en-390.png` | 390      | EN   | **PASS** — "Verified source records", "Information and replies", "Private evidence", "Proposals and decisions", "Appeals", "Event timeline" each on one line, counts 3/1/1/3/1/17, "Section 2 of 6".                                 |

Both frames come from the real route against a real API, Postgres and ClamAV —
not fixtures.
