# Provider onboarding: location, readiness, hours and re-entry

Base: `develop` at `cad5b73aa3789ad9643be4536e9d3205904fb28e`.
The user reported these failures through four mobile screenshots and explicitly
requested functional map/hours improvements, fixes, testing and a separate PR.
This authorizes UX/UI changes to these controls alongside integration repairs.
Existing reference artifacts remain unchanged; their static map and hours-only
form are historical references, not the acceptance target for the repaired controls.

## Confirmed causes and resulting behavior

| Report                                   | Cause in the original code                                                                                                                                    | Repair                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static work-area map                     | `ServiceAreaTaskScreen` rendered a decorative `role=img` band; there was no map engine or device-location action.                                             | Private Leaflet editor with touch pan/pinch, zoom controls, tap/drag red pin and keyboard centre selection. Device location is requested only by a button.                                                                       |
| Work area remains required               | V2 writes `serviceAreaCountryCode`; wizard readiness still required the legacy `serviceAreaCountry` display string.                                           | The wizard evaluates the canonical country code, with a legacy display-name fallback. Enabled-market validation remains authoritative.                                                                                           |
| Bio and images remain required           | The hidden generated professional title could be `Plumber` or a short Arabic trade, but readiness required 10 characters while the shared title minimum is 2. | One minimum in readiness and response metadata. A conditional title recovery field exposes actual server blockers. Bio still requires the server minimum. Photos remain optional and pending moderation is described accurately. |
| Applying hours has no visible result     | Saved intervals existed, but the screen omitted the weekly summary and Apply confirmation; time controls always started at 09:00–17:00.                       | Seven-day summary including split periods and unavailable days; custom saved times hydrate the editor. Apply distinguishes pending, saved, offline, failed and conflicting writes.                                               |
| Re-login opens the workspace prematurely | `ProviderApp` used legacy profile `ACTIVE` as its routing permission instead of `/me/provider/capabilities`.                                                  | Fresh canonical capabilities gate routes and navigation. Incomplete V2 applicants return to their tasks; failures cannot fall back to ACTIVE. API guards remain independent and unchanged.                                       |

The jobs-map screenshot alone did not prove a server work grant. The old UI
could mount a forbidden workspace while its API requests were denied. Regression
coverage checks both the rendered route and actual work API refusal.

## Data and interaction contract

- City, selected coordinates, market and server-suggested radius use the existing
  versioned LOCATION writer. Coordinates are sent as a pair. Clearing the city
  persists null, so the saved state cannot conceal a cleared required field.
- The default world map is a viewport only. No default city or coordinate is
  selected or stored. The owner sees their exact starting point; the public
  profile continues to expose only its existing approximate location projection.
- GPS lookup is optional. Denied permission, unsupported geolocation or failed
  city lookup retains the manual path. A failed city lookup never inserts numeric
  coordinates as a city. Device coordinates do not choose an enabled market.
- City lookup uses the existing OpenStreetMap reverse-geocoding utility only
  after the explicit current-location action. Map taps/drags do not generate
  reverse-geocoding requests. Superseded callbacks cannot overwrite newer edits;
  the vendor request is abortable and bounded. The existing exit barrier tracks
  the lookup and queued writes.
- Leaflet is lazy-loaded in the onboarding route. The editor reuses Provider
  buttons, inputs, feedback, spacing and color tokens. Its styles are scoped to
  this component; seeker maps and the workspace map are unchanged.
- Working hours still use the existing AVAILABILITY writer and server interval
  model. The summary is a projection, not another persistence store. “Saved”
  follows server acknowledgement. Editing unapplied bulk times does not silently
  overwrite the applied week.
- Submission readiness is distinct from moderation, verification and work
  permission. No applicant receives working capabilities from entering a bio,
  selecting coordinates, submitting documents, or signing in again.
- The same canonical-country fallback is used by the legacy readiness endpoint
  and evidence-case submission. A profile completed through V2 must not become
  incomplete when either of those consumers reads it.

## Verification and operational boundaries

Regression tests cover the country-code-only draft, generated EN/AR short titles,
missing title recovery, optional portfolio states, saved hours hydration and
feedback, explicit/denied GPS, stale callbacks, capability mismatches and session
re-entry. The browser repair suite uses real application API responses and
database persistence; any device/vendor emulation is identified in its evidence.

Local checks use Node 20.18.1 and pnpm 10.32.1. PostgreSQL, Redis and Chromium are
not available in the editing environment; runtime browser/database acceptance is
performed by the PR CI jobs. Counts and final-SHA results belong in the PR report,
not guessed here before the jobs finish.

There is no schema migration, dependency upgrade, flag change, automatic merge
or deployment in this repair. Existing onboarding rollback flags remain usable;
capability guards continue to protect both presentation versions. The exact
deployed web/API revisions must include the repair before manual retesting.

Map infrastructure continues to use the existing Leaflet/OpenStreetMap stack.
Attribution is visible and tiles are not prefetched or scraped. Operators must
retain their existing compliant map/geocoder service configuration as usage
grows; the public OSM services are not an application SLA. Reference:
[Leaflet interactions](https://leafletjs.com/reference.html),
[OSM tile policy](https://operations.osmfoundation.org/policies/tiles/),
[Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).
