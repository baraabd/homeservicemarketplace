# Sprint 09B.29 — Baseline, reference hashes, and the 18-screen implementation matrix

Phases 0 and 1. Read-only discovery plus reference normalization. **No implementation
code was modified to produce this document.**

---

## 1. Git and worktree state

| Fact                    | Value                                                     |
| ----------------------- | --------------------------------------------------------- |
| Repository root         | `C:/Users/mohab/Documents/GitHub/Homeservicesmarketplace` |
| Branch at session start | `fix/sprint-09b28-provider-v2-persistence-mobile-first`   |
| `HEAD` at session start | `98b8858` (as reported by the harness snapshot)           |
| `HEAD` at Phase 0       | `b4c6e25e412e5e26421f2848efee4c0739801044`                |
| Sprint branch created   | `fix/sprint-09b29-provider-onboarding-v2-parity`          |
| Base of sprint branch   | `b4c6e25`                                                 |
| `origin/develop`        | `563cfe73e2098b7b502969f218a49e41f827ffdd`                |
| Worktrees               | 1 (the primary checkout). No linked worktrees.            |
| Stashes                 | 4, **untouched** (see below)                              |

### 1.1 HEAD moved during the session — explained, not rewritten

The harness snapshot taken at session start recorded `HEAD` as `98b8858` with eight
untracked files under `docs/provider-experience-v2/`. By the time Phase 0 ran, `HEAD`
was `b4c6e25` and the tree was clean.

`git merge-base --is-ancestor 98b8858 HEAD` → **true**. History was appended, not
rewritten. The new commit is the user's own:

```
b4c6e25 feat(onboarding): complete provider onboarding v2
  8 files changed, 2514 insertions(+)   — documentation and reference assets only
```

It contains no implementation code. This matters for the mandate's "no implementation
work has been completed yet" premise: that premise holds.

### 1.2 Integration base — verified, not assumed

The sprint prompt requires determining the correct integration base rather than
assuming a branch name. `origin/develop` initially appeared to be 5 commits ahead:

```
563cfe7 Feat/provider experience v2 ux redesign (#71)
ec1d211 fix(onboarding): Sprint 9B.28 — V2 persistence, session recovery, mobile-first shell (#70)
4df3845 Mode B slice 1 — the provider workspace is addressable (#68)
006926a Sprint 9B.27 — Provider Onboarding V2: the hub endpoint and the real browser-to-API journey (#67)
93c150e Sprint 9B.26 — Provider Onboarding V2 release gate (#66)
```

Those are merge commits whose content is already present in this branch's linear
history. Proof:

```
git diff --stat HEAD origin/develop
  8 files changed, 2514 deletions(-)   — only the reference docs this branch adds
```

`git diff HEAD origin/develop -- apps/web/src/app/features/provider-onboarding-v2/` and
the same for `apps/api/src/modules/provider/onboarding/` are both **empty**.

**Conclusion: `HEAD` and `origin/develop` are code-identical.** The sprint branch is
correctly based and no rebase or merge is required. All discovery performed against
this tree is valid for `develop`.

### 1.3 Stashes — preserved, untouched

```
stash@{0}  On debug/location-flow-trace: debug-location-flow-trace-instrumentation
stash@{1}  On debug/location-matching-runtime: debug-location-instrumentation
stash@{2}  On fix/routing-test-stability: WIP: user IDE edit — DEFEULT_FALLBACK typo + Aleppo coords in ProviderApp.tsx
stash@{3}  On feat/provider-interactive-map: WIP: user IDE edit — DEFAULT_CENTER fallback in ProviderApp.tsx
```

No stash was created, applied, dropped, or modified. Count before = count after = 4.

---

## 2. Reference file hashes

Immutable acceptance evidence. Hashed before the move, moved with `git mv`, hashed
again.

| File (canonical path under `docs/provider-experience-v2/reference/`) | SHA-256                                                            | Bytes   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| `provider-onboarding-prototype.html`                                 | `c5ceb93a1283da2e29904b50d4c8d11745d2ac2e866b9dca6b559235260725b9` | 98,601  |
| `provider-onboarding-user-flow.svg`                                  | `694af15da8d5e06614d7afc83d1e513ade162cbde802746e933331b02cb87aa7` | 11,992  |
| `provider-onboarding-user-flow.png`                                  | `fbbcaabb01a4d79c4157258a433251e7bf7068e366032be0e3516fab4a96f663` | 172,713 |
| `provider-onboarding-delivery-readme.md`                             | `f765e326083b780ad1bba47ad2d6ba7272642211a30b3b8ab268b8a43c234790` | 2,628   |

**Pre-move and post-move hashes are identical for all four files.** `git status`
reports all four as `R` (rename) with `0 insertions(+), 0 deletions(-)`; the PNG shows
`Bin` with no byte-count change.

The rule file was renamed with plain `mv` because `.claude/` is gitignored
(`.gitignore:19`):

| File                                                                                              | SHA-256 before                                                     | SHA-256 after           |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------- |
| `.claude/rules/provider-onboarding-v2-claude-rule.md` → `.claude/rules/provider-onboarding-v2.md` | `a1185140d002ced0e63473ee9eeafe22d5c253b02a8cc85c59fb5856d2b30baa` | `a1185140…` (unchanged) |

`CLAUDE.md` at the repository root was **not** modified.

---

## 3. Baseline gate results

Measured on the sprint branch before any implementation change.

| Gate                                   | Command                                               | Result                                                                                   |
| -------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Web lint                               | `pnpm --filter @homeservicemarketplace/web lint`      | **pass** — 0 errors, 35 warnings                                                         |
| Web typecheck                          | `pnpm --filter @homeservicemarketplace/web typecheck` | **pass**                                                                                 |
| Web unit                               | `pnpm --filter @homeservicemarketplace/web test`      | **pass** — 102 files, 1500 passed, 0 failed, 0 skipped (85.3 s)                          |
| API lint                               | `pnpm --filter @homeservicemarketplace/api lint`      | **pass** — 0 problems                                                                    |
| API typecheck                          | `pnpm --filter @homeservicemarketplace/api typecheck` | **pass**                                                                                 |
| API unit                               | `pnpm --filter @homeservicemarketplace/api test`      | **pass** — 163 suites passed / 26 skipped; 2975 passed, 602 skipped, 3577 total (33.1 s) |
| Formatting                             | `pnpm format:check`                                   | **fails: 715 files** — pre-existing environment artefact, see 3.1                        |
| Remote CI (`98b8858`, last pushed SHA) | GitHub Actions API                                    | **CI: success**, **CodeQL: success**                                                     |

Not yet run at Phase 1 (scheduled for Phase 7): DB-gated integration suites, Playwright,
Docker cold build, compose smoke, security scans, production build.

### 3.1 The 715-file formatting failure is not a repository defect

`.gitattributes` declares `* text=auto eol=lf`, but this machine has
`core.autocrlf=true` and the working tree was checked out before that attribute
landed, so files are CRLF on disk while the blobs in git are LF. Prettier's
`endOfLine` default is `lf`, so it reports every such file.

`.gitattributes` documents this exact failure mode in its own header comment ("On this
Windows machine `pnpm format:check` reported 800 of 1050 tracked files as
unformatted, every one of them a false positive").

`git status` is clean, which confirms the stored blobs are correct. **No CI workflow
runs `format:check`** — `grep -rn "format\|prettier" .github/workflows/` returns only
unrelated `--format` flags. Classification: **environment defect, not a repository
defect.** It will not be "fixed" by rewriting 715 unrelated files.

---

## 4. Environment

| Fact   | Value                   |
| ------ | ----------------------- |
| Node   | v20.18.1                |
| pnpm   | 10.32.1                 |
| Docker | 29.1.3 (engine 29.1.3)  |
| OS     | Windows 11 (10.0.26200) |

Running containers (all healthy, up ~22 h):

| Container      | Image                | Published port |
| -------------- | -------------------- | -------------- |
| `docker-api-1` | `hsm-api:dev`        | 4000           |
| `hsm-postgres` | `postgres:16-alpine` | 5432           |
| `hsm-redis`    | `redis:7-alpine`     | 6379           |
| `hsm-mailpit`  | `axllent/mailpit`    | 1025 / 8025    |
| `hsm-mongo`    | `mongo:7`            | 27017          |

**Port ownership is unambiguous.** The only API on this host is the Docker one on
4000, and `apps/web/.env` sets `VITE_API_URL=http://localhost:4000`. There is no
competing local API process, so the CLAUDE.md hazard of "local and Docker API on the
same host port" does not apply here.

### 4.1 Two stale Vite processes — must be killed before any screenshot

| PID   | Process                                     | Port             |
| ----- | ------------------------------------------- | ---------------- |
| 27376 | `vite` (dev server)                         | `[::1]:5173`     |
| 29668 | `vite preview --host 127.0.0.1 --port 4173` | `127.0.0.1:4173` |

Both predate this session. `VITE_PROVIDER_ONBOARDING_V2` is **baked in at build time**,
so neither process can be trusted to reflect `apps/web/.env`. Per the product-owner
decision, both are killed and restarted before any visual evidence is captured, and
`localStorage['hsm.ff.providerOnboardingV2']` is asserted explicitly in both directions.

### 4.2 Feature flag — exact environment status

| Environment                     | `VITE_PROVIDER_ONBOARDING_V2`                | Source                                                           |
| ------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| This developer machine          | **on** (`true`)                              | `apps/web/.env:8` (gitignored)                                   |
| `.env.example`                  | `true`                                       | `apps/web/.env.example:47`                                       |
| Vitest                          | **off** (`''`)                               | `apps/web/vitest.config.ts:38`                                   |
| Playwright default web server   | **off** (`''`)                               | `apps/web/playwright.config.ts:159`                              |
| Playwright V2 specs             | **on**, per-spec via `localStorage` override | `addInitScript` seeding                                          |
| **Committed deployment config** | **unset → off**                              | no `env` block in `apps/web/vercel.json`                         |
| Production                      | **off**                                      | unset; `vercel.json` has `"git": { "deploymentEnabled": false }` |

`apps/web/vercel.json` carries build/rewrite/header configuration only. It declares no
environment variables, so Vercel environment values are held in the Vercel project
dashboard, outside this repository. **No production environment file exists and none
will be invented.** Enabling V2 in the target deployment is therefore either a
`vercel.json` `build.env` addition or a dashboard change; that choice is recorded for
Phase 8 and is not made here.

---

## 5. Approved sources read in full

| #   | Source                                                                                     | Status                                                  |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 1   | `.claude/rules/provider-onboarding-v2.md`                                                  | read, complete (73 lines)                               |
| 2   | `docs/provider-experience-v2/SPRINT_09B29_PROVIDER_ONBOARDING_V2_IMPLEMENTATION_PROMPT.md` | read, complete (467 lines)                              |
| 3   | `docs/provider-experience-v2/UX_UI_DESIGN_SYSTEM.md`                                       | read, complete                                          |
| 4   | `docs/provider-experience-v2/reference/provider-onboarding-prototype.html`                 | read, complete — see 5.1                                |
| 5   | `docs/provider-experience-v2/reference/provider-onboarding-user-flow.svg`                  | read, complete (103 lines)                              |
| 6   | `docs/provider-experience-v2/reference/provider-onboarding-delivery-readme.md`             | read, complete                                          |
| 7   | Shared contracts + backend onboarding policy                                               | read, complete (all 19 API sources, all V2 web sources) |

### 5.1 The prototype is a nested document

`provider-onboarding-prototype.html` is a 98 KB wrapper whose entire product content is
an HTML-entity-escaped `srcdoc` on a single `<iframe sandbox="allow-scripts">`. The
real markup is 78,309 bytes / 1,709 lines. It was decoded to a scratchpad copy for
reading; **the reference file itself was not opened for writing and its hash is
unchanged.**

Two facts from the decode that affect Phase 7:

- The prototype uses **no** `localStorage`/`sessionStorage`, so the missing
  `allow-same-origin` in its sandbox does not break it.
- It loads **`unpkg.com`** at runtime for `lucide` icons and `floating-ui`. Every icon
  in every screen comes from that CDN. A baseline captured with the network available
  and one captured without it differ on every screen. Deterministic baselines therefore
  require pinning/vendoring those assets in the capture harness — recorded as a Phase 7
  work item, not a reference-file change.

### 5.2 Prototype design tokens match the approved table exactly

The prototype's `#hsm-provider-journey` custom properties are the same values as the
sprint prompt's token table and `UX_UI_DESIGN_SYSTEM.md` §4.1: `#f8fafc`, `#ffffff`,
`#f1f5f9`, `#e2e8f0`, `#cbd5e1`, `#0f172a`, `#475569`, `#2563eb`, `#1d4ed8`, `#eff6ff`,
`#15803d`, `#b45309`, `#b91c1c`, `#4338ca`. There is **no** token conflict between the
three sources. The `--pv-*` migration in decision 4 is therefore a pure refactor with
no colour change.

---

## 6. The 18-screen implementation matrix

Screen numbers are the prototype's own `#hsm-screen-picker` indices (0–17). "Task N of
6" reflects the hub model; several prototype screens are two halves of one task.

### 6.A Identity, routing, and data

| #   | Screen / state                           | Route or triggering state                             | Required backend data                                                                                                                  | Mutation endpoint                                                                                |
| --- | ---------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 0   | `activate` — Provider account activation | `/provider` (seeker with no provider profile)         | none (static)                                                                                                                          | `POST /v1/me/provider/upgrade`                                                                   |
| 1   | `sync` — Role/session synchronization    | transient, post-upgrade                               | authoritative session/`auth/me` role claim                                                                                             | session refresh (token rotation)                                                                 |
| 2   | `hub` — Hub, partial progress            | `/provider/onboarding` · `status=DRAFT`               | `GET …/onboarding/hub` → `tasks[]`, `progress{complete,total}`, `nextAction`, `status`                                                 | none (read-only)                                                                                 |
| 3   | `basics` — Basic details                 | `/provider/onboarding/BASICS_IDENTITY`                | `GET …/onboarding/draft` → `displayName`, `phoneNumber`, `profileImageUrl`, `providerType`, `legalBusinessName`                        | `PATCH …/steps/PROVIDER_TYPE`, `PATCH …/steps/IDENTITY`, `POST …/avatar`, `POST …/avatar/remove` |
| 4   | `services` — Choose services             | `/provider/onboarding/SERVICES_EXPERIENCE` (part 1)   | draft `specialties[]`, `primarySpecialtyId`, `maxSpecialties`; `GET /v1/service-categories`                                            | `PATCH …/steps/SPECIALTIES`                                                                      |
| 5   | `experience` — Experience & transport    | same route (part 2)                                   | draft `professionSince`, `yearsOfExperience`, `transportModes`, `transportMode`, `equipmentCodes`, `suggestedTitle`                    | `PATCH …/steps/EXPERIENCE`                                                                       |
| 6   | `area` — Work area                       | `/provider/onboarding/WORK_AREA`                      | draft `serviceAreaCity`, `serviceAreaCountry(Code)`, `serviceAreaRadiusKm`, `radiusPolicy`, `serviceAreaExpansion`, `resolvedTimezone` | `PATCH …/steps/LOCATION`                                                                         |
| 7   | `hours` — Working hours                  | `/provider/onboarding/WORKING_HOURS`                  | draft `availability[]`, `timezone`, `resolvedTimezone`                                                                                 | `PATCH …/steps/AVAILABILITY`                                                                     |
| 8   | `profile` — Public profile               | `/provider/onboarding/PORTFOLIO` (part 1)             | draft `headline`, `bio`, `suggestedTitle`; `GET …/public-profile-preview`                                                              | `PATCH …/steps/PROFILE`                                                                          |
| 9   | `portfolio` — Portfolio                  | same route (part 2)                                   | `GET /v1/me/provider/portfolio`                                                                                                        | `POST` / `PATCH :itemId` / `POST reorder` / `DELETE :itemId` on `/v1/me/provider/portfolio`      |
| 10  | `hubComplete` — Hub, all tasks complete  | `/provider/onboarding` · all six `COMPLETE`/`WAITING` | `GET …/onboarding/hub`                                                                                                                 | none                                                                                             |
| 11  | `review` — Final review                  | `/provider/onboarding/REVIEW_SUBMISSION`              | `GET …/onboarding/review` → `groups[]`, `canSubmit`, `blockedReason`, `draftVersion`, `terms`                                          | none (read)                                                                                      |
| 12  | `terms` — Consent + sticky submit        | same route, consent section                           | review `terms{version,accepted,acceptedVersion}`                                                                                       | `PATCH …/steps/CONSENT`, then `POST …/submit`                                                    |
| 13  | `submitted` — Submission confirmation    | `status=SUBMITTED`/`DOCUMENTS_REQUIRED`               | `GET …/onboarding/review` → `lifecycleState`, timeline                                                                                 | `POST …/withdraw`                                                                                |
| 14  | `waiting` — Status centre, 4 axes        | `status=SUBMITTED`                                    | onboarding completion + specialty moderation + `verificationState` + work-access grant                                                 | `POST …/withdraw`                                                                                |
| 15  | `returned` — Action required             | `status=RETURNED` (`ACTION_REQUIRED`)                 | hub `status`, review `groups.BLOCKING[].taskId`                                                                                        | task `PATCH`, then `POST …/submit`                                                               |
| 16  | `expired` — Session expired (401 only)   | any route on HTTP `401`                               | none                                                                                                                                   | re-auth                                                                                          |
| 17  | `active` — Account activated             | `status=ACTIVE`                                       | all four axes + work-access grant                                                                                                      | none                                                                                             |

### 6.B States, copy, current component, and gap

Copy columns give the screen title and the load-bearing sentence. `AR` is the
prototype's canonical wording.

| #   | Loading                     | Empty                  | Validation               | Error / recovery                                      | Arabic copy                                                                        | English copy                                                                                          | Current component                                        | **Gap**                                                                                                                                                                                                                                                                                            |
| --- | --------------------------- | ---------------------- | ------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | n/a                         | n/a                    | n/a                      | upgrade failure → stay, retry                         | «ابدأ كمهني» / «حوّل خبرتك إلى فرص عمل»                                            | "Start as a provider" / "Turn your skills into work"                                                  | `ProviderApp.tsx` upgrade CTA                            | **No dedicated activation screen.** Hero, "What you need" panel and sticky CTA do not exist.                                                                                                                                                                                                       |
| 1   | spinner is the screen       | n/a                    | n/a                      | refresh failure → recoverable error + retry, stay put | «نجهّز حسابك المهني» / «هذه مزامنة دور وليست جلسة منتهية»                          | "Preparing your provider account" / "This is role synchronization, not an expired session"            | **none**                                                 | **Screen absent entirely.** This is repair A's user-facing half; today a post-upgrade 403 surfaces as "Please sign in again".                                                                                                                                                                      |
| 2   | `ProviderSkeleton rows={4}` | `hub-state-EMPTY`      | n/a                      | `ERROR` → retry; `UNAUTHORIZED` → sign-in             | «أكمل طلبك» / «1 من 6 مهام مكتملة»                                                 | "Complete your application" / "1 of 6 tasks complete"                                                 | `OnboardingHubScreen.tsx`, `HubTaskRow.tsx`              | Grouped task list and count exist. Missing: task **icons** (`user`/`wrench`/`map-pin`/`calendar-days`/`image`/`file-check`), 68 px row height, top progress bar, sticky primary CTA inside the shell.                                                                                              |
| 3   | spinner                     | `basics-load-failed`   | phone E.164 inline       | autosave `error`/`conflict`/`offline` chips           | «البيانات الأساسية» / «التقط صورة أو اختر من المعرض»                               | "Basic details" / "Take a photo or choose from gallery"                                               | `BasicsTaskScreen.tsx`, `AvatarUploader.tsx`             | Upload-first order inverted (prototype puts the photo dropzone **first**). **Prototype has no provider-type selector or legal business name — see conflict C1.**                                                                                                                                   |
| 4   | `catalogue-loading`         | `specialty-no-results` | max-specialties ceiling  | autosave chips                                        | «اختر خدماتك» / «تُراجع التخصصات لاحقاً»                                           | "Choose your services" / "Specialties are reviewed later"                                             | `ServicesTaskScreen.tsx`, `SpecialtyPicker.tsx`          | Picker is checkbox rows; prototype uses `hsm-choice` cards with a check square, a "Primary" meta label, and a **waiting alert** explaining moderation. Alert is absent.                                                                                                                            |
| 5   | shared with #4              | —                      | year range               | autosave chips                                        | «الخبرة والتنقل» / «استخدم + و− لتجنب أخطاء الكتابة»                               | "Experience and transport" / "Use + and − to avoid typing errors"                                     | `ServicesTaskScreen.tsx` (same screen)                   | **Prototype uses a −/+ stepper; implementation uses a numeric year input.** Transport is checkbox rows, not 44 px choice cards. Suggested-title panel present but wired to a separate editable title field the prototype does not have.                                                            |
| 6   | spinner                     | `area-preview-empty`   | radius clamped to policy | autosave chips                                        | «نطاق العمل» / «هذه نقطة الانطلاق وليست عنوان سكن منشوراً»                         | "Work area" / "This is your starting point, not a published home address"                             | `ServiceAreaTaskScreen.tsx`, `ServiceAreaRewardCard.tsx` | **Prototype has a map with a radius ring; implementation renders a dashed circle placeholder.** Prototype has **no country selector and no radius slider** — radius is derived from transport — see conflict C2. Reward card exists but prototype styles it as a warning-toned `hsm-reward` strip. |
| 7   | spinner                     | `summaryEmpty`         | overlap/duplicate/range  | `availability-rejected` alert                         | «ساعات العمل» / «متى تستقبل الطلبات؟»                                              | "Working hours" / "When can you take requests?"                                                       | `AvailabilityTaskScreen.tsx`                             | Day toggles + apply-to-selected exist. **Prototype exposes no timezone control; implementation shows an IANA `<select>`** — see conflict C3. Prototype adds an "Unavailable on selected days" checkbox that has no implementation counterpart.                                                     |
| 8   | spinner                     | `preview-about-empty`  | bio min/max counter      | `preview-load-failed` + retry                         | «ملفك العام» / «عرّف العملاء بخبرتك»                                               | "Your public profile" / "Tell customers about your experience"                                        | `PublicProfileTaskScreen.tsx`                            | Bio + preview present. **Prototype has no editable title field here** (title is generated); implementation offers one — see conflict C1/C4.                                                                                                                                                        |
| 9   | portfolio section spinner   | `preview-no-photos`    | file type/size           | upload retry; broken-image placeholder                | «معرض الأعمال» / «الصور قيد الفحص»                                                 | "Portfolio" / "Photos are being checked"                                                              | `PortfolioSection` (9B.10)                               | Composed as-is. Missing: 3-up grid with "Cover photo" chip, crop/reorder affordances, and the moderation waiting alert. **Broken-image retry placeholder not implemented.**                                                                                                                        |
| 10  | as #2                       | —                      | —                        | —                                                     | «أكملت كل ما عليك» / «بعض الخدمات والصور قيد المراجعة، لكن يمكنك إرسال الطلب الآن» | "You completed your part" / "Some services and photos are under review, but you can submit now"       | `OnboardingHubScreen.tsx`                                | **Success alert separating input completion from moderation is absent.** This is repair B's user-facing half.                                                                                                                                                                                      |
| 11  | spinner                     | —                      | server `blockedReason`   | `review-conflict` (409) + refetch                     | «راجع طلبك» / «حالة مراجعة التخصصات والصور مستقلة ولا تمنع الإرسال»                | "Review your application" / "Specialty and photo moderation are separate and do not block submission" | `ReviewTaskScreen.tsx`                                   | Four server groups render. **Prototype shows a compact per-task summary panel with inline edit pencils**; implementation shows blocker/waiting/optional/complete cards. Structurally different presentation of the same server data.                                                               |
| 12  | —                           | —                      | consent required         | 409 conflict banner                                   | «الموافقة والإرسال» / «طلبك جاهز»                                                  | "Consent and submit" / "Your application is ready"                                                    | `ReviewTaskScreen.tsx` (terms section)                   | Present. Prototype makes consent a **checkbox**; implementation uses an "Accept" button. Sticky submit exists.                                                                                                                                                                                     |
| 13  | submit pending              | —                      | —                        | —                                                     | «وصل طلبك بنجاح» / «نتوقع الرد خلال 24 ساعة عمل»                                   | "Your application is on its way" / "Expect a response within 24 business hours"                       | `ReviewTaskScreen.tsx` `review-submitted`                | **Three-step timeline (Submitted → Under review → Activation) is absent.** Only a flat success banner exists.                                                                                                                                                                                      |
| 14  | —                           | —                      | —                        | withdraw 409                                          | «حالة حسابك» / «نراجع طلبك»                                                        | "Your account status" / "We are reviewing your application"                                           | `deriveHubView` → `SUBMITTED` copy                       | **Status centre does not exist.** The four axes are never rendered as four rows. Withdraw is not reachable from the UI.                                                                                                                                                                            |
| 15  | —                           | —                      | —                        | —                                                     | «إجراء مطلوب» / «بقية الطلب مقبول ولن تحتاج إلى إعادة إدخال بياناتك»               | "Action required" / "The rest of your application is accepted and does not need to be entered again"  | `ProviderNotice` in hub                                  | Banner exists. **No per-blocker "Complete now" deep link on this screen**, and no timeline.                                                                                                                                                                                                        |
| 16  | —                           | —                      | —                        | sign-in CTA                                           | «انتهت جلستك» / «هذا التنبيه يظهر فقط عند 401»                                     | "Your session has expired" / "This message appears only for a 401 response"                           | `SCREEN_COPY.UNAUTHORIZED`                               | **`deriveHubView` maps 401 _and_ 403 to the same `UNAUTHORIZED` state** (`hub-view-state.ts:58`). Direct violation of the state contract — this is repair A.                                                                                                                                       |
| 17  | —                           | —                      | —                        | —                                                     | «أصبحت جاهزاً لاستقبال الطلبات» / «يظهر التنقل المهني الآن لأول مرة»               | "You are ready to receive requests" / "Provider navigation appears now for the first time"            | `SCREEN_COPY.ALREADY_ACTIVE`                             | Copy exists; **the four-axis panel does not.** Workspace-nav-appears-now moment is not staged.                                                                                                                                                                                                     |

---

## 7. Conflicts in approved sources requiring a product decision

Per the rule ("If a reference is missing or sources conflict, stop and report") and the
sprint prompt ("do not choose silently"), these are recorded rather than resolved.
None of them blocks Phases 2–4, which is why work continues.

### C1 — The prototype omits fields the backend requires for submission

`evaluateOnboarding()` raises `providerType: REQUIRED` for every wizard candidate, and
`legalBusinessName: REQUIRED` when `providerType === 'BUSINESS'`. The approved
prototype's `basics` screen collects **only** photo, customer-facing name, and phone.
The flow map agrees: "Name • phone • direct photo upload".

A provider who completes the prototype exactly **cannot submit** — the policy will hold
`PROVIDER_TYPE` incomplete forever and `REVIEW_SUBMISSION` stays `BLOCKED`.

Same class of problem, smaller: the prototype's `profile` screen has no editable
professional title, and the sprint prompt says the title is generated and must not be
re-asked — but `evaluateOnboarding` requires `headline` with `MIN_HEADLINE_LENGTH = 10`
and nothing on the server generates it. `suggestedTitle` is computed but never written.

**Options:** (a) add a provider-type step to the design; (b) default `providerType` to
`INDIVIDUAL` server-side and expose the business path elsewhere; (c) relax the policy.
(b) plus server-side persistence of `suggestedTitle` into `headline` is the smallest
change that keeps both the design and the policy intact. **Recommend (b).**

### C2 — Work area: prototype has no country field, backend requires one

`evaluateOnboarding` requires `serviceAreaCountry` and a positive `serviceAreaRadiusKm`.
The prototype's `area` screen has a single free-text "City or neighborhood" field, a map
ring, and a reward strip — **no country selector and no radius control**; the radius is
stated as derived from transport ("15 km because you selected a car").

The current implementation has both a country `<select>` and a radius slider, so
matching the prototype means removing two controls that today are the only way to
satisfy the policy. Country would have to be derived (from locale, market, or the
city catalogue) and the radius written from `radiusPolicy.suggestedKm`.

**Recommend:** keep the radius derived-and-displayed as the prototype shows, and
resolve country server-side from the operator's market rather than asking. Needs
approval because it changes what the server stores without the provider stating it.

### C3 — Working hours: timezone must be hidden but is required

The sprint prompt is explicit: "Do not expose the timezone name in the hours UI." The
prototype has no timezone control. But `patchStep(AVAILABILITY)` throws
`'A timezone is required before working hours can be saved.'` when availability is
non-empty and no timezone is resolvable, and `resolveTimezone()` returns `AMBIGUOUS`
for any country outside its 36-entry table — including every multi-zone country.

For an ambiguous market the provider would face a save that always fails with no
control to fix it. **Recommend:** server falls back to the market default zone and
records it, with the disambiguation prompt moved out of onboarding. Needs approval
because it silently picks a zone.

### C4 — Prototype frame vs. the 480 px column (capture-target decision)

`.hsm-phone` in the prototype is `width: min(390px, 100%)`, `border-radius: 28px`,
`1px` border, `box-shadow: 0 18px 48px`, plus a 16 px `.hsm-safe-top`. That is a device
frame capped at 390 px. Product-owner decision 3 and the rule both require a **480 px**
centred column at ≥640 px and forbid a decorative phone frame.

Reading: `.hsm-prototype-toolbar` (labelled "Prototype controls"), `#hsm-screen-meta`,
and `.hsm-phone` (`aria-label="Provider onboarding mobile prototype"`) are prototype
**harness**; the product surface is `#hsm-phone-content` / `.hsm-phone-inner`.

**Therefore the visual baseline must be captured from `#hsm-phone-content`, not from
`.hsm-phone`.** Capturing the bezel would bake a 390 px frame into every baseline and
make the ≤ 0.005 target unreachable by construction.

Consequence to accept explicitly: the prototype has **no ≥640 px rendering at all**, so
the 768 px responsive sample has no pixel reference. At 768 px the implementation can
only be asserted structurally (480 px column, centred, neutral ground, no overflow),
not pixel-compared. Recorded so it is not later mistaken for a skipped gate.

### Product-owner rulings on C1–C3 (received in-session, Phase 1)

| Conflict | Ruling                                                                                                                                 | Implementation consequence                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1**   | Default `providerType` to `INDIVIDUAL` **server-side**; persist the generated `suggestedTitle` into `headline`.                        | The prototype's `basics` and `profile` screens stay pixel-exact. No provider-type control is added. The business path is deferred to a later surface. `evaluateOnboarding` is **not** relaxed. |
| **C2**   | Derive **both** server-side: radius from `radiusPolicy.suggestedKm` for the chosen transport, country from the operator market/locale. | The country `<select>` and the radius slider are **removed** from `ServiceAreaTaskScreen`. The screen matches the prototype: city field, map ring showing the derived radius, reward strip.    |
| **C3**   | Server falls back to the market default zone and records it; disambiguation moves out of onboarding.                                   | The IANA `<select>` is **removed** from `AvailabilityTaskScreen`. `resolveTimezone` gains a market-default fallback so an `AMBIGUOUS` country can never dead-end a save.                       |

All three are recorded here because each changes what the server stores without the
provider stating it, and that is a decision a reader six months from now must be able
to find rather than infer from a default.

### C5 — Two divergent copies of the binding rule

`.claude/rules/provider-onboarding-v2.md` is **gitignored**, so the rule that governs
this work is not version-controlled. A near-duplicate **is** committed at
`docs/provider-experience-v2/provider-onboarding-v2-claude-rule.md`. They already differ
(YAML quote style; semantically identical today). Only the committed copy survives for
other contributors and CI. **Recommend** deleting the committed duplicate in favour of a
pointer, or vice versa. Not acted on — deletion was not authorized.

> **RESOLVED in Phase 3 closure.** Both copies were compared: identical line and
> byte counts (73 lines, 3962 bytes each), differing only in YAML quote style,
> semantically the same. The copy the agent actually loads is
> `.claude/rules/provider-onboarding-v2.md` — confirmed by it being the rule
> present in the session context.
>
> That path is now the single source of truth. `.gitignore` gained a narrow
> exception (`.claude/*` … `!.claude/rules/*.md`) that un-ignores the rule files
> and nothing else — `settings.local.json` and `scheduled_tasks.lock` remain
> ignored, verified with `git check-ignore`. The committed duplicate was deleted
> and the two documents that pointed at it now point at the canonical path.
>
> Canonical hash: `a1185140d002ced0e63473ee9eeafe22d5c253b02a8cc85c59fb5856d2b30baa`.

---

## 8. Phase exit criteria

| Phase | Criterion                                                                                                                                                  | Met                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0     | Git/worktree/stash/environment recorded; reference hashes recorded; local and CI failures recorded; no implementation code modified                        | **yes**                                                                              |
| 1     | Reference paths normalized with hash proof; rule renamed; all approved sources read completely; 18-screen matrix produced; responsive exception documented | **yes** (documentation correction in `UX_UI_DESIGN_SYSTEM.md` §3 applied separately) |

Implementation code changed so far: **none.**
