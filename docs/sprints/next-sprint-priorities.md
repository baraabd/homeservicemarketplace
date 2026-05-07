# Next Sprint Priorities (post-Phase-5)

Captured at the close of the UX sweep that shipped Phases 1 → 5
(commits `e54fc19` → `1892d77`). All 365 web tests green.

---

## 1. Primary objective — Media upload backend wiring

Phase 3 (commit `b346a33`) established the frontend state contract:
the Job Wizard's "Media & Brief" step holds picked files in a typed
`MediaItem[]` whose `.file: File` is ready to ship. The wiring to
durable storage is **not** done — `handlePost` currently posts the
text payload only.

Goal: complete the upload pipeline end-to-end so seeker-uploaded
photos are persisted and `ServiceRequest.mediaUrls` (the column
added in Phase 1, migration `20260503000000_add_request_media_urls`)
holds real CDN URLs the provider can render.

### Concrete delivery shape

1. **Backend storage adapter.** New module under
   `apps/api/src/infrastructure/storage/` modelled on the existing
   `redis.service.ts` / `prisma.service.ts` pattern. Default
   implementation: AWS S3 via `@aws-sdk/client-s3` +
   `@aws-sdk/s3-request-presigner`. Env: `S3_BUCKET`, `S3_REGION`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (or IAM role in prod).
   Document a local stub (Mailpit-style) so dev shells without S3
   keep working.

2. **Presigned-URL endpoint.** `POST /v1/me/requests/media/presign`
   accepting `{ contentType, sizeBytes, filename }[]` and returning
   per-file `{ uploadUrl, mediaUrl, expiresAt }`. Validate
   contentType against `image/*|video/*`, cap `sizeBytes` (e.g. 10 MB
   per file, 4 files per request — matches the wizard's
   `MAX_MEDIA_ITEMS = 4`). Authenticated; rate-limited.

3. **Frontend wire.** Update `handlePost` in
   `apps/web/src/app/components/wizard/JobWizardModal.tsx` to:
   - call `/presign` once with the array of selected `MediaItem.file`,
   - PUT each `File` to its `uploadUrl` (parallel, with retry +
     per-file progress that updates the existing thumbnail),
   - send the resulting `mediaUrl[]` to `POST /v1/me/requests` in a
     new `mediaUrls: string[]` field on `CreateServiceRequest`.
     Keep submit blocked while uploads are in flight; sonner toast on
     any failure with a single "Retry" affordance.

4. **Contract update.**
   `packages/contracts/src/seeker/requests/...` adds
   `mediaUrls?: string[]` to the create-request DTO. Backend service
   passes it straight to the existing column.

5. **Provider read path.** No work — Phase 1 already mapped
   `ServiceRequest.mediaUrls` → `ProviderAvailableRequestSummary.media`
   on the wire and the provider UI already renders the array.

### Operator runbook delta

Document `S3_BUCKET` / `S3_REGION` / credentials in `.env.example`
with explicit "do not put a real prod key in the dev .env" note.
Add a `pnpm runtime:verify-media-upload` smoke that picks a fixture
file, hits `/presign`, PUTs to the returned URL, then GETs the
public URL to confirm round-trip.

---

## 2. Live-map soak test (operator-gated)

Phase 4 Feature 4 shipped `<LocationMap>` (commit `1892d77`) with a
graceful fallback when `VITE_GOOGLE_MAPS_API_KEY` is unset. Once the
operator provisions the key in `apps/web/.env`:

1. Hard-reload the dev shell. The placeholder cell in JobWizardModal
   Step 2 + SavedAddressesPage form should swap to a real Google Map
   at zoom 15 with a draggable amber pin centred on the captured
   coords.
2. Confirm draggable behaviour: drag the marker, drop it. The
   underlying state (GeoState in the wizard, `pinCoords` in the
   addresses page) should update; the address text field should NOT
   auto-update on drag (intentional — the user typed-or-geocoded
   address is the source of truth for line1/city/country, the
   coordinates are independent).
3. Confirm CSP: the Google Maps loader pulls scripts from
   `*.googleapis.com` and tiles from `*.gstatic.com`. If the deploy
   adds a strict CSP later, both domains need allowlisting on
   `script-src` and `img-src`.
4. **Bill-watch.** The Maps JS API has a 28k free monthly load
   ceiling; restrict the key by HTTP referrer in the Google Cloud
   console (only the dev / preview / prod web origins) before
   broadly testing.
5. Once the soak is clean, write a one-pass Playwright probe that
   captures coords, confirms `<GoogleMap>` mounts (jsdom can't render
   the canvas, so use the existing fallback assertion as the
   regression guard and do the visual check live).

---

## Status at pause

- `git rev-parse HEAD` → `1892d77` (Phase 4 + 5 land).
- Web tests: 365/365 (the documented `app-selector-routing` flake
  cleared on rerun in this session).
- API tests: 884/890 (6 skipped, IO-bound — unchanged since Sprint 7.1).
- Typecheck: clean on api + web + contracts + database.
- Lint: 0 errors (web has 26 pre-existing unrelated warnings).
