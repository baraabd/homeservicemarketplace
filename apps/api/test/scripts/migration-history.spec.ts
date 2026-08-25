// Sprint 9B.1 — the historical-snapshot cutoff used by the constraint-migration
// harness (packages/database/scripts/verify-constraint-migrations.mjs).
//
// Scenario B of that harness materialises "the database an upgrade starts
// from" by copying prisma/ to a temp directory and deleting the migrations
// that did not exist yet. It selected them by DATE PREFIX ('20260822'), which
// is wrong in both directions:
//
//   it deleted   20260822205824_sprint06_geo_columns_and_outbox — a Sprint 6
//                migration that merely shares Sprint 2's date
//   it retained  every 20260823* and 20260824* migration — Sprint 7, 8 and 9
//
// So the "pre-Sprint-2" baseline contained Sprint 9 while missing the Sprint 2
// migration that creates DataRemediationLog. The Sprint 9 backfill writes its
// recoverability row into that table BEFORE it changes anything, so CI failed
// with P3018 / 42P01 relation "DataRemediationLog" does not exist.
//
// The lib is a .cjs beside the harness, loaded through createRequire — the same
// arrangement as scripts/runtime/reset-admin-password.lib.cjs and its spec,
// because the harness is ESM and this suite runs under CommonJS ts-jest.

import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const requireCjs = createRequire(__filename);

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'prisma', 'migrations');

interface Entry {
  name: string;
  isDirectory: boolean;
}

interface Selection {
  keep: string[];
  drop: string[];
  preserved: string[];
}

const { selectHistoricalMigrations, SPRINT2_START } = requireCjs(
  join(REPO_ROOT, 'packages', 'database', 'scripts', 'migration-history.lib.cjs'),
) as {
  selectHistoricalMigrations: (entries: Entry[], cutoff?: string) => Selection;
  SPRINT2_START: string;
};

const dir = (name: string): Entry => ({ name, isDirectory: true });
const file = (name: string): Entry => ({ name, isDirectory: false });

/** The real names, so the fixture cannot drift away from the repository. */
const REAL_ENTRIES: Entry[] = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).map((e) => ({
  name: e.name,
  isDirectory: e.isDirectory(),
}));

const CUTOFF = '20260822090000_sprint02_moderation_schema';
const LAST_BEFORE_CUTOFF = '20260821120000_add_admin_access_requests_and_provider_onboarding';

describe('the cutoff itself', () => {
  it('is the Sprint 2 moderation-schema migration', () => {
    expect(SPRINT2_START).toBe(CUTOFF);
  });

  it('names a migration that actually exists in the repository', () => {
    // If this migration is ever renamed, the harness must fail loudly rather
    // than silently snapshot the wrong history.
    const names = REAL_ENTRIES.filter((e) => e.isDirectory).map((e) => e.name);
    expect(names).toContain(CUTOFF);
  });
});

describe('selection against the real migration directory', () => {
  const selection = (): Selection => selectHistoricalMigrations(REAL_ENTRIES, CUTOFF);

  it('retains the migration immediately before the boundary', () => {
    expect(selection().keep).toContain(LAST_BEFORE_CUTOFF);
  });

  it('excludes the cutoff migration itself', () => {
    expect(selection().drop).toContain(CUTOFF);
    expect(selection().keep).not.toContain(CUTOFF);
  });

  it('excludes every later Sprint 2 migration', () => {
    const { drop } = selection();
    for (const name of [
      '20260822091000_sprint02_one_pending_category_application',
      '20260822092000_sprint02_case_insensitive_unique_email',
      '20260822093000_sprint02_one_default_address_per_user',
      '20260822094000_sprint02_one_active_bid_per_provider_request',
    ]) {
      expect(drop).toContain(name);
    }
  });

  it('excludes a later migration that merely shares the cutoff date', () => {
    // Sprint 6 landed on the same day as Sprint 2. Under the old prefix rule
    // this was dropped for the right outcome but the wrong reason; under the
    // cutoff it is dropped because it sorts after the boundary.
    expect(selection().drop).toContain('20260822205824_sprint06_geo_columns_and_outbox');
  });

  it('excludes every Sprint 6, 7, 8 and 9 migration', () => {
    // THE regression. The old prefix rule kept all of these, which is how a
    // "pre-Sprint-2" database ended up containing the Sprint 9 backfill.
    const { keep, drop } = selection();
    for (const name of [
      '20260822205824_sprint06_geo_columns_and_outbox',
      '20260823120235_sprint07_provider_lifecycle_axes',
      '20260823224144_sprint08_onboarding_wizard_foundation',
      '20260824030000_sprint08_catalog_audit_events',
      '20260824084629_sprint09_verification_restricted_media_work_access',
      '20260824084700_sprint09_backfill_legacy_work_access_grants',
    ]) {
      expect(drop).toContain(name);
      expect(keep).not.toContain(name);
    }
  });

  it('keeps nothing at or after the cutoff', () => {
    // The invariant the whole fix exists for, stated over the real directory
    // rather than a fixture.
    const offenders = selection().keep.filter((name) => name >= CUTOFF);
    expect(offenders).toEqual([]);
  });

  it('drops nothing before the cutoff', () => {
    const offenders = selection().drop.filter((name) => name < CUTOFF);
    expect(offenders).toEqual([]);
  });

  it('preserves migration_lock.toml', () => {
    const { keep, drop, preserved } = selection();
    expect(preserved).toContain('migration_lock.toml');
    expect(drop).not.toContain('migration_lock.toml');
    expect(keep).not.toContain('migration_lock.toml');
  });
});

describe('non-migration entries are never treated as migrations', () => {
  it('preserves prisma files that sit beside the migrations', () => {
    const { drop, preserved } = selectHistoricalMigrations(
      [
        dir(LAST_BEFORE_CUTOFF),
        dir(CUTOFF),
        file('migration_lock.toml'),
        file('README.md'),
        file('.gitkeep'),
      ],
      CUTOFF,
    );
    expect(preserved.sort()).toEqual(['.gitkeep', 'README.md', 'migration_lock.toml']);
    expect(drop).toEqual([CUTOFF]);
  });

  it('does not treat a FILE named like a migration as a migration directory', () => {
    // A stray file must not be deleted by a rule about directories, and must
    // not be counted as history either.
    const { drop, keep, preserved } = selectHistoricalMigrations(
      [dir(CUTOFF), file('20260825000000_not_really_a_migration')],
      CUTOFF,
    );
    expect(preserved).toContain('20260825000000_not_really_a_migration');
    expect(drop).not.toContain('20260825000000_not_really_a_migration');
    expect(keep).not.toContain('20260825000000_not_really_a_migration');
  });
});

describe('fails closed', () => {
  it('refuses when the cutoff migration is absent', () => {
    expect(() =>
      selectHistoricalMigrations(
        [dir(LAST_BEFORE_CUTOFF), dir('20260823120235_sprint07_x')],
        CUTOFF,
      ),
    ).toThrow(/cutoff/i);
  });

  it('names the missing cutoff in the error', () => {
    expect(() => selectHistoricalMigrations([dir(LAST_BEFORE_CUTOFF)], CUTOFF)).toThrow(
      new RegExp(CUTOFF),
    );
  });

  it('refuses when the cutoff has been renamed', () => {
    // The rename case is indistinguishable from absence, which is the point:
    // a renamed boundary must stop the harness, not silently shift it.
    expect(() =>
      selectHistoricalMigrations(
        [dir(LAST_BEFORE_CUTOFF), dir('20260822090000_sprint02_moderation_schema_v2')],
        CUTOFF,
      ),
    ).toThrow(/cutoff/i);
  });

  it('refuses when the cutoff appears more than once', () => {
    expect(() => selectHistoricalMigrations([dir(CUTOFF), dir(CUTOFF)], CUTOFF)).toThrow(
      /more than once|duplicat/i,
    );
  });

  it('refuses a directory that looks like a migration but is malformed', () => {
    // Starts with digits, so it is plainly meant to be a migration, but the
    // timestamp is the wrong length. Ignoring it would silently retain a
    // post-cutoff migration; deleting it would be equally arbitrary.
    expect(() =>
      selectHistoricalMigrations([dir(CUTOFF), dir('2026082_short_timestamp')], CUTOFF),
    ).toThrow(/malformed|2026082_short_timestamp/i);
  });

  it('refuses a bare timestamp directory with no descriptive suffix', () => {
    expect(() => selectHistoricalMigrations([dir(CUTOFF), dir('20260825000000')], CUTOFF)).toThrow(
      /malformed|20260825000000/i,
    );
  });
});
