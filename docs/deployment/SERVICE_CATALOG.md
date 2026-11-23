# Proposed launch service catalog

The six existing specialty slugs and bilingual labels stay stable. The three groups are proposed headings. All nine rows start active. Only specialties have `isLeaf: true`.

| Group (Arabic / English)               | Specialty (Arabic / English) | Specialty slug |
| -------------------------------------- | ---------------------------- | -------------- |
| الصيانة المنزلية / Home maintenance    | سباكة / Plumbing             | `plumbing`     |
| الصيانة المنزلية / Home maintenance    | كهرباء / Electrical          | `electrical`   |
| الصيانة المنزلية / Home maintenance    | صيانة تكييف / AC Repair      | `ac-repair`    |
| العناية بالمنزل / Home care            | تنظيف / Cleaning             | `cleaning`     |
| التشطيبات الداخلية / Interior finishes | نجارة / Carpentry            | `carpentry`    |
| التشطيبات الداخلية / Interior finishes | دهانات / Painting            | `painting`     |

## Operator preview

Use the reviewed commit with its generated Prisma client and built database package. Set `DATABASE_URL` explicitly for the intended migrated database. Preview reads the current catalog and prints the target, bilingual entries and per-row actions.

```sh
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/database build
pnpm --filter @homeservicemarketplace/database catalog:init
```

Archive or label collisions, inactive entries, conflicting parents and changed bilingual labels block the entire plan and return a nonzero exit status. Existing compatible groups and specialties keep their IDs, icons and display order. A matching legacy root specialty can be moved in place by including `--adopt-flat` in the preview and subsequent apply.

After the catalog and target are approved, rerun the reviewed command with `--apply`. A remote target or production process also requires `ALLOW_HOSTED_CATALOG_INIT=true`. The command rechecks current rows inside the same transaction as its category and audit writes. An identical rerun adds zero rows and zero audit events. Deployment and migrations do not invoke the command.

## Operational checks

- Read `GET /v1/services` to check the visible groups, both languages and the six specialty IDs.
- Read `GET /v1/admin/catalog/categories` as an administrator to inspect the tree. A seeker selects a leaf ID. Provider onboarding submits the same kind of ID for moderation.
- To retire an applied specialty, use the audited admin category update with `isActive: false`. Previously linked requests keep their IDs and history. Retiring a group hides its children from new selections.
