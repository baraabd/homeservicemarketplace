# Initial Index Strategy

This document tracks the indexes maintained by the **infrastructure & data foundation** baseline. It lives next to the schema as the source of truth for "why this index exists." Every PR that adds, removes, or changes a model **must** update this file alongside the migration (CLAUDE.md §Database.6 — "every schema change must come with: migration, rollback consideration, index review, test impact review").

## PostgreSQL — IAM tables

### `users`

| Index                             | Type         | Why                                                                                                                                                                                                     |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users_pkey` (id)                 | PK btree     | Primary key.                                                                                                                                                                                            |
| `users_email_key` (email)         | Unique btree | Login lookup; uniqueness invariant.                                                                                                                                                                     |
| `users_deletedAt_idx` (deletedAt) | btree        | Cheap predicate for "active users only" queries (`WHERE deletedAt IS NULL`). Replace with a partial unique on `(email) WHERE deletedAt IS NULL` once we want to allow re-registering after soft-delete. |

### `roles`

| Index                             | Type         | Why                                          |
| --------------------------------- | ------------ | -------------------------------------------- |
| `roles_pkey` (id)                 | PK btree     | Primary key.                                 |
| `roles_name_key` (name)           | Unique btree | Role lookup by natural key (e.g. `"admin"`). |
| `roles_deletedAt_idx` (deletedAt) | btree        | Same rationale as `users_deletedAt_idx`.     |

### `permissions`

| Index                       | Type         | Why                                                                                                     |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `permissions_pkey` (id)     | PK btree     | Primary key.                                                                                            |
| `permissions_key_key` (key) | Unique btree | Permissions are addressed by their stable string key (`"user:read:self"`); unique guards against drift. |

### `user_roles` (join)

| Index                              | Type         | Why                                                                       |
| ---------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `user_roles_pkey` (userId, roleId) | Composite PK | Natural key of the join; also serves "list roles for user" lookups.       |
| `user_roles_roleId_idx` (roleId)   | btree        | Required for "list users with this role" without scanning the full table. |

### `role_permissions` (join)

| Index                                              | Type         | Why                                                                                                     |
| -------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `role_permissions_pkey` (roleId, permissionId)     | Composite PK | Natural key of the join; serves "list permissions for role".                                            |
| `role_permissions_permissionId_idx` (permissionId) | btree        | Required for "list roles holding this permission" — needed by future audit/permission-revocation flows. |

### Soft-delete policy

- `User.deletedAt` and `Role.deletedAt` are nullable. Repositories filter `deletedAt IS NULL` on every read path (verified by unit tests).
- Join tables (`user_roles`, `role_permissions`) are **hard-deleted** — having a soft-delete on a join row would make `(userId, roleId)` non-unique and force readers to remember the predicate everywhere. CLAUDE.md guidance: "do not overuse soft delete on join tables unless clearly necessary."
- `Permission` is system-managed reference data and uses **no soft delete** — permissions are added through migrations or the seed script, never user-deleted at runtime.

## MongoDB — draft collections

### `service_metadata_drafts`

| Index                         | Why                                                 |
| ----------------------------- | --------------------------------------------------- |
| `_id` (default)               | Primary key.                                        |
| `ownerUserId`                 | List drafts owned by a user.                        |
| `categorySlug`                | Filter drafts by category.                          |
| `(ownerUserId, categorySlug)` | Compound, supports the most common combined filter. |

### `provider_portfolio_drafts`

| Index                  | Why                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `_id` (default)        | Primary key.                                                                                 |
| `ownerUserId` (unique) | One draft per provider user; uniqueness enforced at the DB layer to avoid silent duplicates. |

`autoIndex` is **disabled in production** (`MongoService` passes `autoIndex: !isProduction`). Indexes are created in dev/staging automatically, and in production via deliberate migrations or `Model.syncIndexes()` in a controlled job.

## Future indexes (not yet added)

Listed here so future contributors don't recreate them ad-hoc:

- `users (email) WHERE deletedAt IS NULL` partial unique — once we permit re-registration after deletion.
- `users (lower(email))` functional unique — once the email-normalization story is finalised.
- Audit/Activity tables — once the audit-log bounded context lands, expect monthly partitions on `(actorId, createdAt)`.
