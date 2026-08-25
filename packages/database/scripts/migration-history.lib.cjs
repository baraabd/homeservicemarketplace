'use strict';

// Which migrations existed BEFORE Sprint 2 — the history the constraint
// harness replays to build "the database an upgrade starts from".
//
// Extracted from verify-constraint-migrations.mjs so it can be tested without
// a Postgres server, following scripts/runtime/reset-admin-password.lib.cjs.
// CommonJS on purpose: the harness is ESM and loads it through createRequire,
// and the jest suite (CommonJS ts-jest) requires it directly. One file, both
// callers, no build step.
//
// It used to select by DATE PREFIX ('20260822'), which was wrong in both
// directions:
//
//   deleted   20260822205824_sprint06_geo_columns_and_outbox — a Sprint 6
//             migration whose only crime was sharing Sprint 2's date
//   retained  every 20260823* and 20260824* — Sprint 7, 8 and 9
//
// So the "pre-Sprint-2" baseline contained the Sprint 9 backfill while missing
// the Sprint 2 migration that CREATES DataRemediationLog. The backfill writes
// its recoverability row into that table before it changes anything, so CI
// failed with P3018 / 42P01 relation "DataRemediationLog" does not exist.
//
// A date prefix was never the boundary. The boundary is a specific migration,
// so that is what this names.

/** The first Sprint 2 migration. Everything sorting strictly before it is
 *  history; this one and everything after are what the upgrade must apply. */
const SPRINT2_START = '20260822090000_sprint02_moderation_schema';

/** Prisma's own shape: a 14-digit UTC timestamp, an underscore, a name. The
 *  fixed-width prefix is what makes a plain lexical compare a chronological
 *  one. */
const MIGRATION_DIR = /^\d{14}_[A-Za-z0-9][A-Za-z0-9_]*$/;

/** Anything starting with a digit was plainly MEANT to be a migration. If it
 *  is not well-formed we stop, rather than guess which side of the cutoff it
 *  belongs on. */
const INTENDED_AS_MIGRATION = /^\d/;

/**
 * Split the entries of prisma/migrations into the ones a pre-Sprint-2 snapshot
 * keeps, the ones it must delete, and the ones that are not migrations at all
 * and must survive untouched (migration_lock.toml and friends).
 *
 * Pure: it reads no filesystem and deletes nothing. The caller does the I/O.
 *
 * @param {Array<string | {name: string, isDirectory: boolean}>} entries
 * @param {string} [cutoff] the first migration NOT in the snapshot
 * @returns {{keep: string[], drop: string[], preserved: string[]}}
 */
function selectHistoricalMigrations(entries, cutoff = SPRINT2_START) {
  if (typeof cutoff !== 'string' || !MIGRATION_DIR.test(cutoff)) {
    throw new Error(
      `migration-history: malformed cutoff ${JSON.stringify(cutoff)} — ` +
        'expected a 14-digit timestamp, an underscore and a name.',
    );
  }
  if (!Array.isArray(entries)) {
    throw new Error('migration-history: entries must be an array.');
  }

  const keep = [];
  const drop = [];
  const preserved = [];
  let cutoffSeen = 0;

  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    // A bare string is a directory by convention; the harness passes Dirents.
    const isDirectory = typeof entry === 'string' ? true : Boolean(entry?.isDirectory);

    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`migration-history: unreadable entry ${JSON.stringify(entry)}.`);
    }

    // Files are never migration directories, however they are named. Deleting
    // one because it looks like a migration would be the same class of guess
    // the prefix rule made.
    if (!isDirectory) {
      preserved.push(name);
      continue;
    }

    if (!MIGRATION_DIR.test(name)) {
      if (INTENDED_AS_MIGRATION.test(name)) {
        throw new Error(
          `migration-history: malformed migration directory ${JSON.stringify(name)}. ` +
            'It starts with a digit but is not a Prisma migration name, so it cannot ' +
            'be placed relative to the cutoff. Refusing to guess.',
        );
      }
      preserved.push(name);
      continue;
    }

    if (name === cutoff) cutoffSeen += 1;

    // Fixed-width timestamps make this comparison chronological.
    if (name < cutoff) keep.push(name);
    else drop.push(name);
  }

  if (cutoffSeen === 0) {
    throw new Error(
      `migration-history: cutoff migration ${cutoff} was not found. It has been ` +
        'renamed, deleted, or the harness is pointed at the wrong directory. ' +
        'Refusing to build a snapshot whose boundary cannot be verified.',
    );
  }
  if (cutoffSeen > 1) {
    throw new Error(
      `migration-history: cutoff migration ${cutoff} appears more than once (${cutoffSeen}).`,
    );
  }

  // Defensive, and cheap. If a future entry shape ever made the comparison
  // non-chronological, the snapshot would be silently wrong — which is the
  // exact failure being fixed here, so it gets an assertion rather than trust.
  const lateKeeps = keep.filter((name) => name >= cutoff);
  if (lateKeeps.length > 0) {
    throw new Error(
      `migration-history: snapshot would retain migrations at or after the cutoff: ${lateKeeps.join(', ')}.`,
    );
  }
  const earlyDrops = drop.filter((name) => name < cutoff);
  if (earlyDrops.length > 0) {
    throw new Error(
      `migration-history: snapshot would drop migrations before the cutoff: ${earlyDrops.join(', ')}.`,
    );
  }

  return { keep, drop, preserved };
}

module.exports = { SPRINT2_START, selectHistoricalMigrations };
