# R05 — Seeker profile, addresses and service catalog durability

Status: **COMPLETE** for the R05 functional scope. The implementation was merged
through PR #120 and the browser-discovered cold-login return-target defect was
repaired through PR #121. The final recovery head passed the complete required
CI suite before merge. This closes R05 itself; repository protection, hosted
production infrastructure, live-money enablement and later feature sprints remain
separate release gates.

Implementation PR: https://github.com/baraabd/homeservicemarketplace/pull/120

Recovery PR: https://github.com/baraabd/homeservicemarketplace/pull/121

Merged develop SHA containing both changes:
`24361c5cc71917d555d79024c485d3540fd41515`.

R05 does not add admin capability, does not alter authentication/CSRF authority and
does not invent a seeker-avatar upload contract. It repairs only source-backed gaps.

## Field authority

| UI / business field | Wire / validation | Server authority | Durable source | Reload/render source |
| --- | --- | --- | --- | --- |
| firstName | `UpdateProfileRequest.firstName`, max 60 | `ProfileService.update` | `User.firstName` | `GET /v1/me/profile` |
| lastName | `UpdateProfileRequest.lastName`, max 60 | `ProfileService.update` | `User.lastName` | `GET /v1/me/profile` |
| phoneNumber | nullable, max 40 | `ProfileService.update` | `UserProfile.phoneNumber` | profile API |
| city | nullable, max 80 | `ProfileService.update` | `UserProfile.city` | profile API |
| bio | nullable, max 500 | `ProfileService.update` | `UserProfile.bio` | profile API |
| avatarUrl | read-only in current seeker contract | no R05 mutation exists | `UserProfile.avatarUrl` | profile API; fake local editor removed |
| address text/type | create/update DTO bounds | `AddressesService` + owned repository writes | `Address` | `GET /v1/me/addresses` |
| address coordinates | optional validated lat/lng | same owned address mutation | `Address.lat/lng` | address API + map pin |
| default address | dedicated default endpoint | serialized User-row lock + transaction | `Address.isDefault` + partial unique index | address API |
| catalog | no client write | `ServiceCategoryRepository.listActive` | `ServiceCategory` | `GET /v1/services` |
| custom service | length 1–200 | `RequestsService.create` | `ServiceRequest.customServiceText` | request detail/list |
| historical address | client cannot supply snapshot | request service snapshots an owned server row | `ServiceRequest.addressSnapshot` | request and booking projections |

## Default-address concurrency

A plain READ COMMITTED transaction did not serialize two first-address writers or two
default promotions. R05 locks the owning `User` row before every default-affecting
create/promote/delete transaction and adds the partial unique index
`address_one_live_default_per_user_uniq` for the final database invariant.

The migration is deliberately fail-closed. If historical data already contains more
than one live default for a user, it raises an exception instead of silently choosing
which address represents the user's intent.

## Historical data

A service request stores a JSON address snapshot built server-side from the owned
Address row. Booking projections read that parent request snapshot, not the mutable
Address row. R05 real-Postgres acceptance edits and soft-deletes the saved address and
then proves both request and booking still expose the original snapshot.

Categories are similar: active catalog reads exclude retired rows, new request creation
refuses an inactive category, while a historical request retains the relation and
labels it had selected.

## Browser authority repairs

The saved-address map previously persisted only its text: captured/draggable coordinates
were preview state and were omitted from create/update payloads. R05 sends the persisted
pin in the same mutation and rehydrates it when editing.

The seeker profile showed a camera / Change Photo control that only changed a local
gradient. Because no seeker avatar mutation contract exists, R05 removes the false
success affordance. A persisted `avatarUrl` renders read-only; otherwise the persisted
initials render as fallback.

The real-service R05 journey later exposed a cold-login navigation race after OTP.
PR #121 introduced one shared, sanitized return-target resolver used by the login page
and authenticated guest guard, preserving valid same-origin `returnTo` targets without
turning navigation state into authorization.

## Acceptance evidence

The exact recovery head
`04d976243f6a22aabd13a9a40b24c2de188a7cfb` completed the required hosted
acceptance before merge:

- CI run 36858186860: **PASS**, including install/lockfile, contracts, database,
  API, Web, Browser E2E, visual/responsive/accessibility, real PostgreSQL/Redis,
  Admin real-route persistence, authentication cookie contract, dispute journey,
  Compose smoke, dependency/secret/container scans, Docker production boot,
  S3/ClamAV retention and Phase 5 real-route persistence.
- CodeQL run 36858186662: **PASS**.
- Authentication lifecycle acceptance run 36858186443: **PASS**.
- Web development startup run 36858186522: **PASS**.
- Staging release boundary run 36858186495: **PASS**.
- Production governance run 36860216999: **PASS**.

R05 source tests prove:

- real PostgreSQL default-address concurrency and two-user ownership;
- Unicode/Arabic profile persistence;
- immutable request/booking address snapshots;
- active/retired catalog behavior and custom Arabic-service persistence;
- address-coordinate payload persistence and rehydration;
- real built SPA + API + Postgres + Redis + Mailpit persistence across reload and
  fresh login, including direct database reads;
- the corrected post-OTP cold-login return path.

No successful API-response mock is counted as persistence evidence.

## Scope boundary after closure

R05 does **not** close the confirmed request-media ownership gap. Request attachments
remain the first functional blocker for R06: request presign still lacks an owned
`MediaAsset` reservation and request creation still accepts the supplied `mediaUrls`
array without transaction-bound claim authority.

R05 also does not implement ratings/reviews, support-agent persistence, booking call or
tracking capabilities, payout/withdrawal authority, or the Provider V2 cutover. Those
items are assigned to the functional-completion roadmap rather than being hidden inside
R05.

The historical `docs/production-readiness/r01/BASELINE.json` remains unchanged because
it is a dated audit snapshot, not a mutable current-status registry.

## Rollback

Application changes can be reverted normally before deployment. The additive unique
index should not be removed while binaries without default-address serialization can
run. Do not reset, truncate or rewrite user addresses as rollback. If migration
preflight detects historical duplicate defaults, resolve those records explicitly with
the account owner/operator policy before retrying; the migration itself makes no choice.
