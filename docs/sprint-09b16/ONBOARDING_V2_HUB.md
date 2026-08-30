# Sprint 9B.16 — the full-screen onboarding shell and the resumable hub

Ships **default off** behind `VITE_PROVIDER_ONBOARDING_V2`. With the flag off,
a provider gets the Sprint 8 wizard, unchanged, and `/provider/onboarding`
does not exist.

> **Update (9B.26/9B.27):** the hub ENDPOINT this sprint's client was written
> against did not exist when this document was first written. It does now — see
> §"The endpoint" below.
>
> The browser evidence in §6 was gathered against `stubApi()`, which fulfils
> the onboarding routes from a fixture. That is why the missing endpoint went
> unnoticed for six sprints: a spec that stubs the route under test passes
> whether or not the server implements it. Since 9B.27 there is also a
> **real-stack** suite — `provider-onboarding-v2-real-api.spec.ts`, browser to
> real API to real Postgres, nothing intercepted — and that is the coverage to
> trust for integration claims. See
> `docs/sprint-09b26/PROVIDER_ONBOARDING_V2_RELEASE.md` §12.

---

## 1. What this is

The Sprint 8 wizard walks nine steps in a fixed order inside the provider app
shell, with the bottom navigation underneath it. This replaces that with:

- a **full-screen route** (`/provider/onboarding`) that drops the application
  chrome — no bottom nav, no welcome bar — and keeps a compact header with one
  always-visible way out;
- a **hub** of six server-decided tasks, grouped, each with its own status;
- a **per-task route** (`/provider/onboarding/:taskId`) so the task a provider
  is on survives a reload and a login round-trip.

"Full screen" means it drops the chrome, not the phone frame. The 430px frame
is the app viewport; leaving it would restyle the product on desktop for no
one's benefit.

---

## 2. The contract

The hub renders `GET /v1/me/provider/onboarding/hub`, typed in
`packages/contracts/src/provider/onboarding/response/provider-onboarding-hub.ts`.

```jsonc
{
  "tasks": [
    {
      "id": "BASICS_IDENTITY",
      "group": "BASICS",
      "status": "AVAILABLE",
      "title": "…",
      "description": "…",
    },
    // …six in total
  ],
  "progress": { "complete": 0, "total": 6 },
  "nextAction": { "kind": "COMPLETE_TASK", "taskId": "BASICS_IDENTITY" },
  "status": "DRAFT",
}
```

**Everything about readiness comes from the server.** The client does not count
completed tasks, does not decide which rows are openable, and does not infer
what to do next. A component test pins this directly: given one `COMPLETE` row
and a server count of `3 of 6`, the screen renders `3 of 6 complete`. A hub
that computed its own progress could tell a provider they are finished while
the API refuses their submission.

The hub is **not a task**. It has no row, it is not in `tasks`, and it is not
in the count.

### Statuses

| Status      | Row shape                     | Why                                               |
| ----------- | ----------------------------- | ------------------------------------------------- |
| `AVAILABLE` | a real `<button>`             | the only status the provider can act on           |
| `COMPLETE`  | plain container, "Done" badge | nothing to do                                     |
| `WAITING`   | plain container + explanation | it is with us; the provider should not wait on it |
| `BLOCKED`   | plain container + explanation | something earlier is unfinished                   |

Non-actionable rows are **not disabled buttons**. A disabled control is still
announced as a control and still invites a press, while telling a screen-reader
user only that something they cannot identify is unavailable. `WAITING` and
`BLOCKED` carry different sentences on purpose — "we are checking this" and
"finish the tasks above" are different instructions.

An unknown status from a newer server is treated as **not actionable**.
Guessing "openable" is the guess that breaks.

---

## 3. Two places this build departs from the brief

Both are recorded rather than resolved silently.

### 3.1 The brief says three groups; the canonical response sends five

The brief describes "Basics, Your services, and Review". The 9B.15 response
groups the six tasks under **five** codes: `BASICS`, `SERVICES`, `COVERAGE`
(×2), `PROFILE`, `REVIEW`.

The canonical response wins, and the client does not hardcode the set at all:
`groupTasks()` renders one heading per group in **first-appearance order**, so
three groups and five groups both render correctly and re-grouping is a server
change alone.

### 3.2 The response carries single-language display text

`title` and `description` arrive in Arabic only. Rendering them verbatim shows
an English reader Arabic, which breaks the EN/LTR parity the acceptance
criteria require.

So the rule the rest of the codebase already follows applies here too — codes
on the wire, prose in the bundle. The client keys its own copy off the stable
task `id` and **falls back to the server's string** when it has no entry, so a
task shipped by a newer server stays readable instead of rendering a bare code.

This is a display decision only. Status, progress and next action are still
server-owned and never inferred.

---

## 4. The flag

`isProviderOnboardingV2Enabled()` reads, in order:

1. `localStorage['hsm.ff.providerOnboardingV2']` — per-browser override,
   honoured in **both** directions;
2. `VITE_PROVIDER_ONBOARDING_V2` — the deployment default, baked in at build.

Anything unrecognised, including a missing value, is **off**.

The override exists because the flag's value is otherwise fixed at build time,
and both states must be provable against the one bundle the browser suite
builds. Playwright seeds it through `addInitScript`, exactly as the language
preference is already seeded.

It is safe for a real user to set: the flag chooses which onboarding UI
renders and nothing else. Every write behind these screens is authorised
server-side by the same capability rules the wizard is subject to, so a
provider who flips it sees a different screen — never data or an action they
were not already entitled to.

### No redirect loop

The entry point is the existing "Continue onboarding" CTA on
`ProviderStatusState`. With the flag on it navigates to `/provider/onboarding`
instead of setting a tab; the hub's close control returns to `/provider`, which
renders the status surface again. Nothing auto-redirects **into** the hub, so
there is no cycle. The customer profile route (`/home/profile`) is untouched.

---

## 5. What is deliberately not here

**The task forms.** 9B.16 is the shell and the hub. `/provider/onboarding/:taskId`
exists because it is what makes the hub resumable, and it renders the task's
title, description, server status and a way back — plus a plain sentence saying
the step is not in this preview. It does not render an input that saves nowhere.

It does own the **access decision**, and that comes from the server like
everything else: a task the hub reports as `BLOCKED` cannot be entered by
typing its id into the address bar.

**The endpoint.** 9B.15 was not delivered alongside this sprint: for six
sprints `/v1/me/provider/onboarding/hub` existed only as a TypeScript type and
a Playwright stub, and the client had never spoken to a server.

**It exists now.** It was implemented in the 9B.26 release-gate branch —
`apps/api/src/modules/provider/onboarding/hub/onboarding-hub-resolver.ts`, served
by `@Get('hub')` on the wizard controller — and is covered by unit tests and by
integration tests that drive the real route over HTTP against real Postgres with
the real guards. See `docs/sprint-09b26/PROVIDER_ONBOARDING_V2_RELEASE.md` §1.

The resolver restates no rule: task completeness is `evaluateOnboarding()`'s
answer routed through `stepForField()` and the same `STEP_TO_V2_TASK` map the
review screen uses, so the hub and the review cannot disagree about whether an
application is ready.

---

## 6. Evidence

| Gate                                     | Result                                                 |
| ---------------------------------------- | ------------------------------------------------------ |
| `web lint`                               | 0 errors (32 pre-existing warnings, none in new files) |
| `web typecheck`                          | pass                                                   |
| `web` unit (vitest)                      | 972 passed / 80 files                                  |
| `web test:e2e` (Playwright, 3 viewports) | 457 passed, 2 viewport-conditional skips               |
| `api` lint / typecheck / build           | pass                                                   |
| `api` test                               | 2592 passed, 477 DB/Redis-gated skips                  |
| `contracts` / `database` build+typecheck | pass                                                   |
| `pnpm audit --prod --audit-level high`   | no known vulnerabilities                               |
| gitleaks (full history, via Docker)      | 10 findings, all pre-existing test fixtures            |
| isolated Compose smoke                   | 29/29 assertions                                       |
| `prisma validate`                        | valid; no schema or migration changes in this sprint   |

The browser suite covers 320px and 430px, EN/LTR and AR/RTL, keyboard focus and
tab order, reload and browser-back resume, flag on and off, and the absence of
bottom-nav leakage.

### One harness fix, and why it belongs to this change

`WalletScreen.test.tsx` mounted `ProviderApp` with no router. That worked while
`useNavigate()` was only reached on the profile tab; this sprint calls it at
the top of `ProviderApp`, so the bare mount started throwing. Every other
`ProviderApp` suite already wraps in `MemoryRouter`, and in the product there is
no way to reach that screen from outside the router — the harness was the
unrealistic part, so it was corrected rather than worked around.
