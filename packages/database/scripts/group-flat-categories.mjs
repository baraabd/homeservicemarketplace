#!/usr/bin/env node
// Sprint 8 — group the flat service-category catalogue under parent headings.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
//   pnpm --filter @homeservicemarketplace/database catalog:group -- --plan grouping.json
//   pnpm --filter @homeservicemarketplace/database catalog:group -- --plan grouping.json --apply
//
// WHY THIS IS A TOOL AND NOT A MIGRATION
//
// Nothing is broken. The Sprint 8 schema change is backward compatible by
// construction: every existing row kept `parentId = NULL` and `isLeaf = true`,
// so it stayed exactly what it was — a selectable competency at the root.
// Matching, the seeker catalogue, and the admin queue all still work, and the
// wizard offers those roots as selectable leaves.
//
// Grouping is therefore an EDITORIAL decision about how the catalogue should
// read, not a correctness repair. Editorial decisions do not belong in a
// migration that runs unattended on every deploy: the migration would encode
// one person's taxonomy as a schema fact, and reversing it later would need
// another migration. So it is a script, it takes the taxonomy as input, and
// somebody runs it deliberately.
//
// DRY RUN IS THE DEFAULT. `--apply` is required to write anything.
//
// WHAT IT WILL NOT DO
//
//   - It never deletes or renames an existing category.
//   - It never moves a category that already has a parent. A row someone has
//     already placed is a decision; silently re-placing it is not this
//     script's call.
//   - It never flips `isLeaf` on a category providers HOLD. Un-selecting a
//     held competency orphans everyone holding it, and no unattended script
//     should be able to do that.
//   - It reports every skipped row with the reason, so the operator sees the
//     shape of what did not happen rather than a count that looks like success.
//
// PLAN FILE FORMAT
//
//   {
//     "groups": [
//       {
//         "slug": "plumbing",
//         "labelEn": "Plumbing",
//         "labelAr": "سباكة",
//         "icon": "droplet",
//         "children": ["boiler-repair", "drain-clearing", "leak-detection"]
//       }
//     ]
//   }
//
// `children` are the SLUGS of existing flat categories. The group itself is
// created if it does not exist, always with `isLeaf = false`.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../generated/prisma');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const JSON_OUT = args.includes('--json');
const planIndex = args.indexOf('--plan');
const PLAN_PATH = planIndex >= 0 ? args[planIndex + 1] : null;

const prisma = new PrismaClient();

/** Every reason a row can be skipped. Named, not counted: "12 skipped" tells
 *  an operator nothing they can act on. */
const SKIP = {
  MISSING: 'child slug not found in the catalogue',
  ALREADY_PARENTED: 'already has a parent — a placement someone already made',
  IS_A_GROUP: 'is itself a group with children beneath it',
  HELD_AND_WOULD_BE_UNSELECTABLE: 'providers hold it and the plan would make it unselectable',
  IS_THE_GROUP: 'a group cannot be its own child',
};

async function main() {
  if (!PLAN_PATH) {
    fail('A --plan <file.json> is required. This script has no default taxonomy, on purpose.');
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
  } catch (error) {
    fail(`Could not read the plan at ${PLAN_PATH}: ${error.message}`);
  }
  if (!Array.isArray(plan?.groups)) fail('The plan must have a "groups" array.');

  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    plan: PLAN_PATH,
    groupsCreated: [],
    groupsReused: [],
    moved: [],
    skipped: [],
  };

  for (const group of plan.groups) {
    if (!group.slug || !group.labelEn || !group.labelAr) {
      fail(`Group "${group.slug ?? '(no slug)'}" needs slug, labelEn and labelAr.`);
    }

    // The group row. Reused when it already exists so a re-run is a no-op
    // rather than a duplicate-slug failure — a script that cannot be re-run is
    // a script nobody runs twice, including after fixing one bad row.
    let parent = await prisma.serviceCategory.findFirst({
      where: { slug: group.slug, deletedAt: null },
    });

    if (parent) {
      report.groupsReused.push(group.slug);
    } else if (APPLY) {
      parent = await prisma.serviceCategory.create({
        data: {
          slug: group.slug,
          labelEn: group.labelEn,
          labelAr: group.labelAr,
          icon: group.icon ?? 'folder',
          // A heading, never selectable. This is the whole point of the
          // exercise: the group organises, the leaves are chosen.
          isLeaf: false,
          parentId: null,
          sortOrder: group.sortOrder ?? 0,
        },
      });
      report.groupsCreated.push(group.slug);
    } else {
      report.groupsCreated.push(group.slug);
      // Dry run: there is no row to hang children off, so the children are
      // reported against the slug rather than an id.
      parent = { id: `(would-create:${group.slug})`, slug: group.slug };
    }

    for (const childSlug of group.children ?? []) {
      if (childSlug === group.slug) {
        report.skipped.push({ slug: childSlug, reason: SKIP.IS_THE_GROUP });
        continue;
      }

      const child = await prisma.serviceCategory.findFirst({
        where: { slug: childSlug, deletedAt: null },
        include: {
          _count: { select: { providerProfiles: true, children: true } },
        },
      });

      if (!child) {
        report.skipped.push({ slug: childSlug, reason: SKIP.MISSING });
        continue;
      }
      if (child.parentId) {
        report.skipped.push({
          slug: childSlug,
          reason: SKIP.ALREADY_PARENTED,
          currentParentId: child.parentId,
        });
        continue;
      }
      if (child._count.children > 0) {
        report.skipped.push({ slug: childSlug, reason: SKIP.IS_A_GROUP });
        continue;
      }

      // Moving a category under a group does NOT change its selectability —
      // it stays a leaf, which is what keeps every existing grant valid. The
      // check below exists because a plan could ask for something else later,
      // and a held row must never be silently un-selected by a script.
      if (child._count.providerProfiles > 0 && child.isLeaf === false) {
        report.skipped.push({
          slug: childSlug,
          reason: SKIP.HELD_AND_WOULD_BE_UNSELECTABLE,
          providerCount: child._count.providerProfiles,
        });
        continue;
      }

      if (APPLY) {
        await prisma.serviceCategory.update({
          where: { id: child.id },
          data: { parentId: parent.id },
        });
      }
      report.moved.push({
        slug: childSlug,
        into: group.slug,
        providerCount: child._count.providerProfiles,
      });
    }
  }

  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  print(report);
}

function print(report) {
  const line = (s = '') => process.stdout.write(`${s}\n`);

  line();
  line(`Catalogue grouping — ${report.mode.toUpperCase()}`);
  line(`Plan: ${report.plan}`);
  line();
  line(`Groups created : ${report.groupsCreated.length}  ${report.groupsCreated.join(', ')}`);
  line(`Groups reused  : ${report.groupsReused.length}  ${report.groupsReused.join(', ')}`);
  line(`Categories moved: ${report.moved.length}`);
  for (const m of report.moved) {
    line(
      `  ${m.slug} → ${m.into}${m.providerCount ? `  (${m.providerCount} provider(s) hold it)` : ''}`,
    );
  }

  if (report.skipped.length > 0) {
    line();
    line(`Skipped: ${report.skipped.length}`);
    // Every skip, with its reason. A count alone reads as success.
    for (const s of report.skipped) {
      line(`  ${s.slug}: ${s.reason}`);
    }
  }

  line();
  if (!APPLY) {
    line('DRY RUN — nothing was written. Re-run with --apply to commit this plan.');
  } else {
    line('Applied.');
  }
  line();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
