# R05 — Seeker profile, addresses and service catalog durability

Status: IMPLEMENTATION CANDIDATE. Exact-final-SHA CI and real-service acceptance are
required before closure. Base develop SHA:
`56294c05442f064424bfc74d2caa566a768861da`.

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

## Acceptance evidence

Source tests added by R05:

- real PostgreSQL concurrency, ownership, Unicode profile, immutable request/booking
  snapshots, active/retired catalog and custom Arabic-service persistence;
- route-level Arabic custom-service length validation;
- web regressions for address-coordinate payloads and read-only avatar authority;
- Chromium against the real built SPA + real API + Postgres + Redis + Mailpit, including
  profile/address reload, fresh login, direct DB reads, historical snapshot and catalog
  retirement.

Final workflow/run IDs and the final source SHA are recorded in PR #120 after GitHub
finishes the exact-head gates. Pending, failed, cancelled or skipped required evidence
is non-PASS.

## Rollback

Application changes can be reverted normally before deployment. The additive unique
index should not be removed while binaries without default-address serialization can
run. Do not reset, truncate or rewrite user addresses as rollback. If migration
preflight detects historical duplicate defaults, resolve those records explicitly with
the account owner/operator policy before retrying; the migration itself makes no choice.
