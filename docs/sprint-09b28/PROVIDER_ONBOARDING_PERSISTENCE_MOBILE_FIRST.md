# Sprint 9B.28 — Provider Onboarding V2: persistence, session recovery, mobile-first shell

**Branch** `fix/sprint-09b28-provider-v2-persistence-mobile-first`
**Base** `feat/provider-experience-v2-ux-redesign` @ `4e2bde3` — **not** an ancestor of
`origin/develop` (@ `4df3845`), so this PR is **stacked**. See §11.
**Delivery mode** Mixed, and the boundary is explicit: Integration/Bug-Fix Mode for the
autosave, cache and authentication work; **Mode B (UX/UI Redesign)** for the onboarding
shell width policy only, scoped to `/provider/onboarding/*`.

---

## 1. What was actually wrong

Six defects, one root. There was no owner of the provider draft.

`useOnboardingStepAutosave(step)` was called **once per step**, and two of the six task
screens call it twice — Basics drives `PROVIDER_TYPE` + `IDENTITY`, Services drives
`SPECIALTIES` + `EXPERIENCE`. That is **seven independent instances**, each with a private
`inFlight` flag, a private debounce timer and a private pending payload, all reading the
version out of **one** shared cache slot and writing to **one** server row behind **one**
optimistic lock.

### RC1 — the exits did not save

`OnboardingTaskScreen` left through:

```ts
const backToHub = () => navigate('/provider/onboarding');
```

wired to **both** the header Close and the "Back to tasks" footer button. Synchronous. An
edit resting in the 900 ms debounce — which is every edit made in the second before
someone taps Close — was still in a timer owned by a component React was about to unmount.

`saveNow()` existed on the hook the entire time and had **zero callers**.

### RC2 — the status lied on the way out

`save()` set a private `isDirty` boolean and left `status` alone. There was **no `dirty`
state in the machine at all**. So the `saved` chip from the _previous_ write stayed on
screen over an edit that had never been sent. This is why the bug was reported as data
loss rather than as a missing save: the UI actively asserted the opposite of the truth.

### RC3 — `flush()` was not a drain

```ts
const flush = useCallback(async () => {
  if (inFlight.current) return;   // ← resolves immediately
```

Any caller awaiting the flush while a write was open got a promise that resolved at once.
A navigation gated on it would have left anyway.

### RC4 — two writers, one version

Both instances on a two-step screen read `currentVersion()` from the same cache slot and
sent it concurrently. The server accepted the first and `409`'d the second.

Reproduced exactly, before the fix:

```
AssertionError: expected [ 3, 3 ] to deeply equal [ 3, 4 ]
```

### RC5 — a successful write was thrown away on unmount

```ts
const view = await patchOnboardingStep(step, { ...payload, version });
if (!mounted.current) return; // ← server wrote; client discarded the answer
qc.setQueryData(providerQueryKeys.onboarding.draft(), view);
```

Closing a task while a write was open meant the row changed and the client never learned
the new version — so the _next_ write presented a stale one and 409'd.

### RC6 — hub and review served projections built before the edit

`flush()` seeded the draft slot and stopped. Hub inherits the **global five-minute
`staleTime`** (`lib/auth-provider.tsx:41`), so returning to the hub after an edit showed a
task list computed up to five minutes earlier.

Reproduced before the fix: `expected false to be true` on
`getQueryState(hub()).isInvalidated`.

### RC7 — the upgrade left the session behind (the 401/403 in the screenshots)

`ProviderService.upgrade()` assigns the provider role **in the database** and returns the
profile. It does not touch the session. `JwtStrategy.validate` takes `roles` **from the
access token** — deliberately, and it says so in a comment claiming "every role mutation
revokes the user's sessions". **The upgrade path does not.** So the token minted at login
still carried the pre-upgrade role set, `RolesGuard` read it, and every
`/v1/me/provider/**` call answered **403**.

Invalidating the cached `/v1/auth/me` — all the mutation used to do — cannot fix this: the
refetch goes out on the same token and returns the same roles.

And because it presented as **403, not 401**, the api client's refresh interceptor never
engaged. That interceptor is correctly scoped to 401: a 403 normally means "correctly
identified, genuinely not allowed", and retrying it after a refresh would be a
privilege-escalation retry loop. **Nothing was wrong with the interceptor.**

The `401`s visible on `/v1/auth/me` in the supplied console are the ordinary
pre-authentication probe on first paint — the app asks who you are before it knows, the
interceptor sees no CSRF cookie and dispatches `auth:session-expired` without attempting a
refresh. That path is correct and unchanged. The favicon 404 and the `SyncoRedux`,
`classifier.js` and `content.js` errors are browser extensions; no repository-owned code
produces them.

### RC8 — the hub called an administrative review "Required"

`evaluateOnboarding` already distinguishes a specialty awaiting admin approval
(`AWAITING_REVIEW`) from one never chosen (`REQUIRED`). `buildHub` threw the distinction
away and rendered both as `AVAILABLE` — "Required" — sending the provider into a screen
where every field they were allowed to touch was already filled in, with no action that
could clear it.

### RC9 — onboarding was 768px wide

9B.15 correctly took the provider **workspace** out of the 430px phone frame; this shell
followed with `max-w-3xl`. That is right for a workspace and wrong for a focused
submission flow.

---

## 2. Why the existing tests were green

This matters more than the fixes, because the suite was large and confident.

1. **They asserted the chip, not the wire.** A test that waits for "Saved" and then clicks
   Close passes on the broken build — the chip was left over from an earlier write
   (RC2) and the click navigated before the debounce fired. Every test in this sprint
   asserts `mock.history.patch` / real network traffic instead.
2. **They waited.** Component tests advanced timers or awaited the debounce before
   leaving. The bug only exists when you _don't_ wait, which is the normal case.
3. **Each screen was tested alone.** RC4 needs two autosave instances flushing together.
   No test mounted a two-step screen and touched both steps.
4. **The stub answered every version.** The mocked Playwright suites replied `200` to any
   PATCH regardless of `version`, so the `[3, 3]` race could not produce a 409.
5. **The real-API suite built fixtures through the API, not the UI**, and — see
   `e2e/real-api.ts` — it _documented RC7 and worked around it_ with an explicit
   `POST /v1/auth/refresh` after upgrade. The defect was known and papered over at the
   harness level rather than fixed in the product.

---

## 3. The fix: one coordinator

`app/features/provider-onboarding-v2/autosave/ProviderOnboardingAutosaveProvider.tsx`,
mounted on a **layout route** above both onboarding routes (`app/routes.ts`), so it
outlives every task component.

### State machine

```
        save()                    drain start            2xx
idle ──────────► dirty ─────────────────────► saving ──────────► saved
                   ▲                             │                 │
                   │ newer edit landed           │ 4xx/5xx/network │ newer edit
                   │ while in flight             ▼                 │ queued
                   └──────────────────────── error ────────────────┘
                                                 │
                              409 ───► conflict  │  navigator.onLine === false ───► offline
```

- `dirty` is set **on the first local change, before anything is sent**. A `saved` chip can
  never outlive the keystroke that invalidated it.
- `saved` is set **only** after the API acknowledges the latest logical revision for that
  step — and only if no newer edit arrived for it while the request was open.
- `saved` carries `projectionStale`, rendered as **"Saved — refreshing status"**, when the
  write landed but the hub/review refresh that follows it did not. It never claims the
  write failed, because it did not.
- Precedence for a screen with two steps (`mergeAutosaveStatus`) is now
  `conflict > error > offline > saving > dirty > saved > idle`. **`dirty` outranks `saved`**
  — the old ranking scored both at zero, which is how a half-written screen showed "Saved".

### Queue and versioning invariants

1. **One queue.** `Map<step, patch>`; iteration order is queue order.
2. **Coalesce within a step, preserve across steps.** A repeated edit to the same step
   replaces its pending payload; an edit to a different step is kept alongside.
3. **Serial.** Exactly one request in flight for the whole draft, ever.
4. **Version from the latest server response**, read from the draft cache slot the previous
   response seeded. Because the queue is serial, two writes can never present the same
   version.
5. **A conflict drops that step's patch** and stops the drain. Retrying a 409 would
   overwrite work the provider has not seen; the answer is Reload.
6. **A failure re-queues under any newer edit** (`{...failed, ...newer}`) and stops the
   drain. No automatic re-fire — that would hot-loop the network.
7. **Responses are applied unconditionally.** The coordinator outlives the task, so a
   response landing after the screen closed still seeds the cache (fixes RC5).

`flushAll(): Promise<FlushResult>` resolves only when the queue is empty **and** nothing is
in flight, or a terminal state is reached. It loops, re-checking `pending` after each
drain, so an edit queued mid-drain is carried by the same call (fixes RC3).

### Navigation

`useOnboardingExit` is the only way out of a task. Header Close, "Back to tasks", and
browser Back (via the router's `useBlocker` — a POP runs no click handler) all funnel
through it. Nothing dirty → navigate immediately. Dirty → "Saving…", the control is
disabled against a second tap, `flushAll()`, then navigate. Terminal failure → **stay on
the task**, with `ExitBlockedNotice` (`role="alert"`) naming the reason and offering Retry,
or Reload for a 409, or "Keep editing".

`beforeunload` stays on the coordinator and covers **only** the hard reload and tab close.
It does not fire for a React Router navigation — treating it as protection for Close was
the category error underneath the original bug.

### Cache invalidation policy

After every successful patch:

| Key                                    | Action                                                  | Why                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `onboarding.draft()`                   | **seeded** from the response                            | the response _is_ the new draft; a refetch repaints the pre-save state and the provider watches their typing flicker |
| `onboarding.hub()`                     | invalidated                                             | server-derived verdict; the client must not recompute the completeness policy                                        |
| `onboarding.review('en')` and `('ar')` | invalidated                                             | both, so switching language cannot show a verdict about the draft as it was                                          |
| `profile.root`                         | invalidated, for the seven profile-affecting steps only | `CONSENT` and `REVIEW` change nothing about what a provider _is_                                                     |

Scoped keys throughout — no broad `qc.clear()`, which would take unrelated user state with
it. Invalidation is **not awaited** inside the write path: the write is already durable and
holding navigation for a refetch makes a successful save feel like a failed one. A failed
refresh downgrades the chip to "Saved — refreshing status".

### Authentication recovery

`useUpgradeToProvider` now calls `POST /v1/auth/refresh` after the upgrade commits and
**before** invalidating. `AuthenticationService.refresh` re-reads the role rows from the
database (`peekByRefreshRaw` → `users.listRoles`) before minting, so the new access token
carries `provider` **because the server looked it up**, not because the client asked. No
new endpoint, no client-asserted claim, no capability the upgrade did not already grant.

A failed rotation is deliberately non-fatal: the role is committed either way, and the
ordinary 401 → coalesced refresh → single retry path recovers on the next call. Throwing
would report a successful upgrade as a failure and invite the provider to run it again.
Nothing is logged on that path — a refresh failure carries cookie detail.

The existing interceptor behaviour is unchanged and was already correct: one coalesced
refresh, one retry (`config._retry`), and `returnTo` preservation through `RequireAuth`
already carries the full task URL.

### Hub semantics

A task whose outstanding issues are **all** `AWAITING_REVIEW` is now `WAITING`, not
`AVAILABLE`. If it also owns an issue the provider can act on, it stays `AVAILABLE` —
there is something they can do, and sending them away would be worse than an imprecise
label. It remains in `blockedTasks`, so `collectingComplete` stays false and
`REVIEW_SUBMISSION` stays `BLOCKED`: the application genuinely is not submittable. That is
why this could not be fixed by dropping the issue.

---

## 4. Mobile-first responsive contract

**Scoped to `/provider/onboarding/*` only.** `OnboardingShell` is used by the onboarding
hub and tasks and by nothing else, so the policy lives there. `Root.tsx` is **not** touched
— the old global 430px cap stays gone and the provider workspace, Seeker and Admin are
untouched.

| Viewport  | Rule                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| 320–639px | the column **is** the viewport; no second card inside the phone; 16px gutters; one scroll container                      |
| ≥640px    | centred column, **≤520px** (currently 480px), on a quiet neutral ground, with a border and soft shadow only at that size |

`sm:` (640px) rather than `md:` (768px) is deliberate: 768px **is** the tablet in the
acceptance matrix, and a rule that engaged only above it would leave the tablet full-bleed.

`height: 100svh` — the _small_ viewport height — so the sticky footer stays above the fold
with the mobile URL bar expanded. `dvh` would put the footer under the bar at the moment it
grows, which is exactly when the provider is reaching for it. Safe-area insets are honoured
top and bottom. The close control holds a 44×44 target at 320px; the **title** gives up
space, never the way out.

The dark surround in a device-emulator frame is tooling, not application UI. Every
measurement in `provider-onboarding-v2-mobile-first.spec.ts` is taken from
`getBoundingClientRect` in the real viewport.

---

## 5. Files changed

**New**

```
apps/web/src/app/features/provider-onboarding-v2/autosave/
  ProviderOnboardingAutosaveProvider.tsx      the coordinator
  useOnboardingExit.ts                        the single exit path
  onboarding-autosave.regression.test.tsx     the six defects, pinned
  onboarding-autosave.states.test.tsx         the state machine
  onboarding-exit.test.tsx                    every exit control, per task
apps/web/src/app/features/provider-onboarding-v2/components/ExitBlockedNotice.tsx
apps/web/src/app/features/provider-onboarding-v2/copy/exit-copy.ts
apps/web/e2e/provider-onboarding-v2-persistence.spec.ts     real stack
apps/web/e2e/provider-onboarding-v2-mobile-first.spec.ts    viewport matrix
docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
```

**Changed**

```
apps/web/src/app/routes.ts                        onboarding nested under a layout route
apps/web/src/app/pages/ProviderOnboardingPage.tsx ProviderOnboardingLayout
apps/web/src/app/features/.../OnboardingShell.tsx mobile-first width policy
apps/web/src/app/features/.../OnboardingTaskScreen.tsx exits go through the guard
apps/web/src/app/features/.../AutosaveStatus.tsx  renders dirty + projection-stale
apps/web/src/app/features/.../autosave-status.ts  dirty, and the new precedence
apps/web/src/app/features/.../copy/autosave-copy.ts  dirty + savedProjectionStale, en/ar
apps/web/src/app/features/.../{Basics,Services,ServiceArea,Availability,PublicProfile}TaskScreen.tsx
                                                  import the coordinator's hook
apps/web/src/app/hooks/provider/useProviderProfile.ts  session rotation after upgrade
apps/web/src/app/hooks/provider/useProviderOnboarding.ts  legacy hook renamed
apps/web/src/app/components/provider/onboarding/ProviderOnboardingWizard.tsx  follows the rename
apps/api/src/modules/provider/onboarding/hub/onboarding-hub-resolver.ts  AWAITING_REVIEW → WAITING
```

---

## 6. Test evidence

Exact commands and counts are in the PR description and §7 below. Summary:

| Gate                                        | Before                  | After                                                         |
| ------------------------------------------- | ----------------------- | ------------------------------------------------------------- |
| web unit                                    | 1450 passed / 100 files | **1494 passed / 103 files** (+44)                             |
| api unit (jest, hermetic)                   | —                       | **2975 passed, 602 skipped**                                  |
| api DB+Redis gated (`RUN_DB_INTEGRATION=1`) | —                       | **3573 passed, 4 skipped** on isolated pg 15433 / redis 63791 |
| hub resolver spec                           | 27                      | **32** (+5)                                                   |
| Playwright — mocked V2                      | 308 passed              | **308 passed, 52 skipped**                                    |
| Playwright — mobile-first matrix            | —                       | **57 passed**                                                 |
| Playwright — real-stack persistence         | —                       | **6 passed** (browser → real API → real Postgres)             |

No test was removed, skipped or weakened. No workers were reduced, no retries added, no
timeouts widened.

**Before-evidence** was captured by running the required assertions against `4e2bde3`:

```
B2  expected 'saved' not to be 'saved'                  ← RC2
B4  expected [ 3, 3 ] to deeply equal [ 3, 4 ]          ← RC4
B5  expected false to be true (hub isInvalidated)       ← RC6
```

---

## 7. Rollback

The V2 flag is the rollback and is unchanged.

- `VITE_PROVIDER_ONBOARDING_V2` — **default OFF**. Build-time.
- `localStorage['hsm.ff.providerOnboardingV2']` — per-browser override, wins in both
  directions.

With the flag off, `/provider/onboarding*` redirect to `/provider` and the Sprint 8 wizard
serves exactly as before. **Every change in this sprint except two is inside V2 or its
routes.** The two that are not:

1. `useUpgradeToProvider` — affects any caller of the upgrade. It adds a session rotation;
   worst case on failure is the pre-existing behaviour.
2. `onboarding-hub-resolver.ts` — the hub read-model, which only V2 consumes.

To roll back entirely: revert the branch. No migration was created, so there is nothing to
un-apply.

---

## 8. Residual risks — stated honestly

1. **V1 still carries RC2 and RC3.** The Sprint 8 wizard keeps its own autosave, renamed
   `useLegacyWizardStepAutosave`. V1 is **still the default surface** (the V2 flag ships
   off), so most providers today are on a wizard whose `saved` chip can outlive an edit and
   whose `saveNow()` is not a true drain. It is **much less exposed** than V2 was — it
   mounts one step at a time, so RC4 cannot occur — and its Next/Back do call `saveNow()`.
   Rewriting the live fallback's save semantics was out of this sprint's scope and risk
   budget. **This is the single most important follow-up.**
2. **Pending edits are in memory only.** They survive a lost connection and a route change;
   they do **not** survive a reload or a crashed tab. `beforeunload` gives the browser's own
   prompt, and the offline copy says "keep this page open" rather than promising durability
   we do not have. Durable, identity-bound local persistence was deliberately not
   implemented — the brief requires it not be claimed unless tested, and it is not.
3. **Two web unit suites flake under full-suite parallel load** — `WalletScreen.test.tsx`,
   `ProviderApp.test.tsx`, and once `ProviderStatusState.test.tsx`. The failing set
   **varies between runs** and every one of them passes in isolation. They are
   `findByText` timeouts on provider screens that do not import anything this sprint
   changed. Not introduced here, not fixed here, and not hidden: see §9 of the PR.
4. **`SERVICES_EXPERIENCE` browser coverage is thinner than the other tasks.** Its controls
   are a catalogue-driven picker; the real-stack spec asserts the outcome that matters
   (no 409s, no lost value) but drives fewer controls than a full multi-select scenario
   would.
5. The `AWAITING_REVIEW` → `WAITING` change makes an approval-blocked application show
   `WAITING` with `REVIEW_SUBMISSION` still `BLOCKED`. That is correct and honest, but it
   is a state in which the provider has **nothing to do but wait**, and the hub does not yet
   offer an explicit "we are reviewing your specialty" banner.
