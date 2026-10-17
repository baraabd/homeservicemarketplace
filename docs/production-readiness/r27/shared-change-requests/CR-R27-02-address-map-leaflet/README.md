> **Current G1 continuation:** The current-source baseline reproduced this
> finding. The minimal runtime patch is now implemented under the exact
> lease in `../../G1_HANDOFF.json`; affected local tests pass. Fresh real-service
> baseline/after and browser evidence are pending in Draft #173. The earlier
> measurements and proposal below are retained as historical context.

# CR-R27-02 — load the address pin map only when it is shown

- **Path:** `apps/web/src/app/components/profile/SavedAddressesPage.tsx` (seeker profile owner).
- **Patch:** `patch.diff` (full proposed file: `SavedAddressesPage.tsx`).
- **Delivery mode:** A; the visible map, placeholder size and copy are unchanged.

## Reason (measured)

`SavedAddressesPage` statically imports `LocationMap`, which imports leaflet
and its CSS. The page is part of the seeker home chunk, so every seeker home
visit downloads leaflet, although the map renders only after the seeker
presses "Use my current location" and coordinates are captured.

| Build (059c018)                     | `+seeker-home` JS raw | gzip-1 | brotli-11 | leaflet in `+seeker-home` |
| ----------------------------------- | --------------------- | ------ | --------- | ------------------------- |
| baseline                            | 372.9 KiB             | 128.9  | 95.3      | 472.9 KiB rendered        |
| with this CR (overlay build)        | 215.2 KiB             | 72.0   | 52.0      | 0                         |
| map chunk, on location capture only | 158.5 KiB             | 57.1   | 43.5      | 472.9 KiB rendered        |

CSS for the seeker home increment also falls from 21.1 KiB to 5.8 KiB raw
(leaflet's stylesheet moves with the map).

## Behaviour

- Same lazy pattern as `ServiceAreaTaskScreen` → `ServiceAreaMap` and
  `ProviderApp` → `LiveJobsScreen`.
- While loading, and if the chunk fails, a 200 px placeholder identical to
  `LocationMap`'s own placeholder is shown, so there is no layout shift and
  the typed address can still be saved (the pin is an optional refinement).
- Location permission remains opt-in behind the existing button.
- No change to address data, validation or the PATCH payload.

## Tests to add with the patch (owner)

1. `SavedAddressesPage.test.tsx`: the existing "edit flow preserves persisted
   map coordinates" test must stay green (use `findBy…` for the map region).
2. A rejected lazy import renders the placeholder and the Save button stays enabled.
3. Seeker real-API and RTL specs stay green.
4. `check-budgets.mjs`: `+seeker-home` ≤ 60 KiB brotli; leaflet only in
   `job-wizard`/`address-map`.

## Rollback

Revert the commit.
