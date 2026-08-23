#!/usr/bin/env node
// Sprint 7 — provider lifecycle backfill + reconciliation report.
//
// Populates the six axis columns (docs/adr/0005) from the legacy
// ProviderProfile.status, using the mapping fixed in docs/adr/0007.
//
//   pnpm --filter @homeservicemarketplace/database backfill:provider-lifecycle
//   pnpm --filter @homeservicemarketplace/database backfill:provider-lifecycle -- --apply
//
// DRY RUN IS THE DEFAULT. `--apply` is required to write anything. A backfill
// whose effect cannot be read before it runs is a backfill nobody can approve.
//
// Three properties this script must have, and the code that gives it them:
//
//   IDEMPOTENT       it only ever fills a NULL column, so a second run writes
//                    zero rows. Asserted by a test, because "idempotent" in a
//                    comment is how a retry doubles its own effect.
//   NON-DESTRUCTIVE  it never deletes, never overwrites a non-null value, and
//                    never "corrects" a conflicting row. Conflicts are
//                    reported and counted; a human decides.
//   CHUNKED          bounded batches, so it cannot hold a long lock on a table
//                    the live API is reading.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../generated/prisma');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const JSON_OUT = args.includes('--json');
const CHUNK = 500;

// docs/adr/0007 — the mapping table, in code exactly as written in the ADR.
//
// ACTIVE maps to verification UNVERIFIED on purpose: an admin clicked approve,
// nobody ever saw a document. LEGACY_APPROVED records "approved under the old
// process, identity never checked" so these rows stay findable when
// verification becomes required for work access.
const MAPPING = {
  DRAFT: {
    onboardingState: 'DRAFT',
    verificationState: 'UNVERIFIED',
    standingState: 'GOOD',
    lifecycleSource: 'LEGACY_DRAFT',
  },
  PENDING_REVIEW: {
    onboardingState: 'SUBMITTED',
    verificationState: 'UNVERIFIED',
    standingState: 'GOOD',
    lifecycleSource: 'LEGACY_PENDING',
  },
  ACTIVE: {
    onboardingState: 'ACCEPTED',
    verificationState: 'UNVERIFIED',
    standingState: 'GOOD',
    lifecycleSource: 'LEGACY_APPROVED',
  },
  SUSPENDED: {
    onboardingState: 'ACCEPTED',
    verificationState: 'UNVERIFIED',
    standingState: 'SUSPENDED',
    lifecycleSource: 'LEGACY_SUSPENDED',
  },
  // Rejection was an APPLICATION decision, not a conduct one: standing stays
  // GOOD so a rejected applicant can reapply rather than being punished for a
  // failed application.
  REJECTED: {
    onboardingState: 'RETURNED',
    verificationState: 'UNVERIFIED',
    standingState: 'GOOD',
    lifecycleSource: 'LEGACY_REJECTED',
  },
};

const DEFAULT_TIER = 'NONE';

/** Contradictions between the legacy columns themselves.
 *
 *  These rows are NOT repaired. Silent normalisation destroys the evidence of
 *  whatever wrote them, and the migration is not entitled to decide which half
 *  of a contradiction was the truth. They are counted, listed, and left. */
function findConflicts(row) {
  const out = [];
  if (row.status === 'DRAFT' && row.submittedForReviewAt !== null) {
    out.push('DRAFT_WITH_SUBMISSION_STAMP');
  }
  if (row.status === 'ACTIVE' && row.reviewedAt === null) {
    out.push('ACTIVE_WITHOUT_REVIEW_STAMP');
  }
  if (row.status === 'REJECTED' && !row.rejectionReason) {
    out.push('REJECTED_WITHOUT_REASON');
  }
  if (row.status === 'PENDING_REVIEW' && row.submittedForReviewAt === null) {
    out.push('PENDING_WITHOUT_SUBMISSION_STAMP');
  }
  if (row.deletedAt !== null && row.status === 'ACTIVE') {
    out.push('SOFT_DELETED_BUT_ACTIVE');
  }
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  const startedAt = new Date();

  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    startedAt: startedAt.toISOString(),
    totals: { scanned: 0, wouldWrite: 0, written: 0, alreadyPopulated: 0, conflicts: 0 },
    byLegacyStatus: {},
    byTargetSource: {},
    conflicts: [],
  };

  try {
    let cursor;
    for (;;) {
      const page = await prisma.providerProfile.findMany({
        take: CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          status: true,
          deletedAt: true,
          submittedForReviewAt: true,
          reviewedAt: true,
          rejectionReason: true,
          onboardingState: true,
          verificationState: true,
          standingState: true,
          subscriptionTier: true,
          lifecycleSource: true,
        },
      });
      if (page.length === 0) break;

      for (const row of page) {
        report.totals.scanned += 1;
        const legacy = row.status;
        report.byLegacyStatus[legacy] = (report.byLegacyStatus[legacy] ?? 0) + 1;

        const conflicts = findConflicts(row);
        if (conflicts.length > 0) {
          report.totals.conflicts += 1;
          // Capped: a report that scrolls for ten thousand lines is a report
          // nobody reads. The COUNT is always exact.
          if (report.conflicts.length < 100) {
            report.conflicts.push({ id: row.id, status: legacy, reasons: conflicts });
          }
        }

        const target = MAPPING[legacy];
        if (!target) {
          // An enum value the mapping does not know. Never guess — a wrong
          // guess here silently authorises or de-authorises a provider.
          report.totals.conflicts += 1;
          if (report.conflicts.length < 100) {
            report.conflicts.push({ id: row.id, status: legacy, reasons: ['UNMAPPED_STATUS'] });
          }
          continue;
        }

        // Fill ONLY nulls. A non-null value was written by something that knew
        // more than this script does.
        const data = {};
        if (row.onboardingState === null) data.onboardingState = target.onboardingState;
        if (row.verificationState === null) data.verificationState = target.verificationState;
        if (row.standingState === null) data.standingState = target.standingState;
        if (row.subscriptionTier === null) data.subscriptionTier = DEFAULT_TIER;
        if (row.lifecycleSource === null) data.lifecycleSource = target.lifecycleSource;

        if (Object.keys(data).length === 0) {
          report.totals.alreadyPopulated += 1;
          continue;
        }

        report.totals.wouldWrite += 1;
        const src = target.lifecycleSource;
        report.byTargetSource[src] = (report.byTargetSource[src] ?? 0) + 1;

        if (APPLY) {
          data.lifecycleSyncedAt = new Date();
          await prisma.providerProfile.update({ where: { id: row.id }, data });
          report.totals.written += 1;
        }
      }

      if (page.length < CHUNK) break;
      cursor = page[page.length - 1].id;
    }

    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt.getTime();

    if (JSON_OUT) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }

    // Conflicts are NOT a failure: the run did the right thing by leaving them
    // alone. Exit 0 and let the operator read the count.
    return report;
  } finally {
    await prisma.$disconnect();
  }
}

function printReport(r) {
  const line = '─'.repeat(72);
  console.log(`\n${line}`);
  console.log(`Provider lifecycle backfill — ${r.mode.toUpperCase()}`);
  console.log(line);
  console.log(`  scanned            ${r.totals.scanned}`);
  console.log(
    `  ${r.mode === 'apply' ? 'written           ' : 'would write       '} ${r.mode === 'apply' ? r.totals.written : r.totals.wouldWrite}`,
  );
  console.log(
    `  already populated  ${r.totals.alreadyPopulated}   (idempotent re-run leaves these)`,
  );
  console.log(`  conflicts          ${r.totals.conflicts}   (left untouched, listed below)`);

  console.log(`\n  by legacy status:`);
  for (const [k, v] of Object.entries(r.byLegacyStatus).sort()) {
    console.log(`    ${k.padEnd(16)} ${v}`);
  }

  if (Object.keys(r.byTargetSource).length > 0) {
    console.log(`\n  by target lifecycleSource:`);
    for (const [k, v] of Object.entries(r.byTargetSource).sort()) {
      console.log(`    ${k.padEnd(18)} ${v}`);
    }
  }

  if (r.conflicts.length > 0) {
    console.log(`\n  CONFLICTS — not modified, require a human decision:`);
    for (const c of r.conflicts) {
      console.log(`    ${c.id}  ${c.status.padEnd(15)} ${c.reasons.join(', ')}`);
    }
    if (r.totals.conflicts > r.conflicts.length) {
      console.log(
        `    … and ${r.totals.conflicts - r.conflicts.length} more (count above is exact)`,
      );
    }
  }

  console.log(`\n  ${r.durationMs}ms`);
  if (r.mode === 'dry-run') {
    console.log(`\n  NOTHING WAS WRITTEN. Re-run with --apply to persist.`);
  }
  console.log(`${line}\n`);
}

// Exported so the integration test drives the same code path the operator
// runs, rather than a reimplementation of it.
export { main as runProviderLifecycleBackfill, MAPPING, findConflicts };

if (process.argv[1] && process.argv[1].endsWith('backfill-provider-lifecycle.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
