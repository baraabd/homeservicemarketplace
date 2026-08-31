# ADR 0014 — The provider workspace is addressable

- **Status:** Accepted
- **Date:** 2026-08-31
- **Sprint:** 09B (Mode B — provider UX/UI redesign, slice 1)
- **Related:** [0005](0005-provider-lifecycle-axes.md) (the statuses this gate mirrors), [0006](0006-provider-capability-service.md) (who actually decides), `docs/sprint-09b16/ONBOARDING_V2_HUB.md` (the same argument, made for onboarding)

## Context

`ProviderApp.tsx` was 3,251 lines: every workspace screen — live jobs and its
map, bids, chat, wallet, profile — plus the shell that framed them, plus this
line:

```tsx
const [activeTab, setActiveTab] = useState('jobs');
```

Which screen a provider was looking at lived in component state. Nothing about
that state was addressable, and four things followed from it:

- a reload dropped the provider back on Jobs, whatever they had been doing;
- nothing could be linked to — not a bid, not a payout, not a conversation;
- the browser back button did not move between screens, so on a phone it left
  the app entirely;
- support could not send a provider a link to the screen they were describing,
  and could not be sent one either.

The project had already made this argument once and acted on it. Sprint 9B.16
gave the V2 onboarding surface real routes, and the route table says why:

> the task the provider is on has to survive a reload and a login round-trip,
> and tab state in a component survives neither.

Onboarding got routes. The workspace, which a provider uses every day rather
than once, did not.

A second consequence was structural. With every screen in one module there was
nothing for the bundler to split on, and no boundary at which a screen's
dependencies stopped being everyone's dependencies.

## Decision

**The workspace is a route family, and the URL is the single source of truth
for which screen is open.**

```
/provider                    index — resolves to the provider's actual home
/provider/status             not-yet-active: the application's own address
/provider/jobs               live jobs (leaflet)
/provider/bids               my bids
/provider/messages           conversations
/provider/messages/:threadId one conversation
/provider/wallet             earnings (recharts)
/provider/profile            profile — or the legacy wizard, while applying
```

Consequences of that decision:

1. **Screens are modules.** `./screens/*` and `./shell/*`, one per screen, each
   loaded on demand. The shell is ~330 lines and holds no screen.
2. **The nav is links.** `NavLink` derives its active state from the URL, so
   the highlighted destination and the rendered screen read the same fact
   instead of keeping two copies of it. Middle-click opens a tab, like every
   other link on the web.
3. **The status gate is a redirect, not a pinned tab.** A provider who cannot
   take work is sent to `/provider/status`, which is a real address they can be
   linked to.

## What did NOT change, deliberately

The gate is a **rendering** rule that mirrors a **server** rule, and mirrors are
easy to crack while moving them. Each was carried over verbatim:

- the statuses that may reach onboarding are still `DRAFT`, `PENDING_REVIEW`,
  `REJECTED` — a mirror of `COMPLETE_ONBOARDING` in [ADR 0005](0005-provider-lifecycle-axes.md), not a second opinion;
- a non-ACTIVE provider still never mounts a marketplace screen, so the client
  never paints a marketplace whose every call would 403;
- **no profile row is not a status.** The old gate read
  `profile && profile.status !== 'ACTIVE'`, and the `profile &&` was doing real
  work: a user with the provider role and no profile has not applied yet and
  belongs on the Activate screen, not on a status page reporting a status they
  have never had. Dropping it during this change sent every not-yet-provider to
  a DRAFT status page; the routing tests now pin it;
- the first-resolution loading gate (`isFetched`) still cannot re-open, so a
  background refetch never tears down the mounted workspace.

None of this is what enforces the rules. `ProviderCapabilityService` does, and
answers 403 regardless of what the client renders. This ADR moves where a
provider can **be**; it changes nothing about what they may **do**.

## Consequences

**Good.** Every screen has an address, so reload, back, deep links and support
links all work. Conversations are linkable, which is the thing providers and
support actually ask each other for. The 3,251-line module is six modules and a
shell. Screens load on demand.

**The bundle win is smaller than it looks, and was measured rather than
assumed.** Route-splitting the workspace defers five chunks (~78 KB), but the
1.8 MB entry chunk is essentially unchanged, because both heavy dependencies
are pulled in by surfaces outside the provider app: leaflet by
`ds/LocationMap` and `wizard/JobWizardModal`, recharts by
`admin/DashboardOverview` and `ui/chart`. Splitting the workspace cannot remove
a dependency the customer and admin surfaces load anyway. Lazy route components
in `routes.ts` are what would move it — a change that belongs to the whole
router, not to this slice.

**Costs.** A navigation now includes a dynamic import, so a test that clicks and
asserts immediately can race the module load; the fix is to wait for the screen
rather than to lengthen a timeout. And `ProviderApp` only works mounted under
`provider/*` — mounted bare, its relative routes resolve against `/` and its
catch-all loops. Tests mount it the way production does.

## Alternatives considered

**Keep the tab state and add a URL alongside it.** Two sources of truth for one
fact, which is the defect being removed rather than a fix for it.

**Nested layout routes in `routes.ts` instead of a splat.** Spells the routes
out in one table, but scatters the workspace across two files and makes it
harder to mount whole in a test. The splat keeps the workspace one unit, which
is also how the onboarding surface is organised.

**Split the screens without routing them.** Would have delivered the bundle
change and none of the addressability, which is the part providers feel.
