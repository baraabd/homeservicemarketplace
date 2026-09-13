import { Client } from 'pg';

// Sprint 09B.29 Phase 5B — reading the database, not the API.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHY AN API READ IS NOT ENOUGH, EVEN AN INDEPENDENT ONE
//
// The persistence suite already re-reads every edit through a second
// authenticated API client, which is a real check and catches the failure it
// was written for — a value that exists only in one tab's React Query cache.
//
// It cannot catch the layer below. An endpoint that serves from Redis, a write
// that landed in a transaction nobody committed, a column the API projects from
// somewhere other than where it stored it: all of those answer an API read
// correctly and a database read wrongly. "Durable" is a claim about the
// database, so the evidence has to come from the database.
//
// AND IT CATCHES THE TEST'S OWN MISTAKES
//
// The first version of this file selected `displayName` as a COLUMN of
// `ProviderOnboardingDraft`. It is not one — the draft keeps every answer in a
// single `data` JSON column — and the query would have failed against the real
// schema after looking entirely reasonable. A read that has to satisfy Postgres
// cannot be written from memory, which is part of why it is worth having.
//
// STRICTLY READ-ONLY, AND THAT IS A DESIGN CONSTRAINT
//
// Nothing here writes. The harness builds every fixture by calling the same
// public endpoints a provider's browser calls, because a suite that seeds rows
// directly stops testing the path that creates them. This module exists to
// OBSERVE the result of those calls and must never become a shortcut around a
// journey that is failing.

/**
 * Open a read-only connection to the database under test.
 *
 * Keyed by `providerProfileId` throughout, because that is what the real-API
 * harness carries on its `Account` — and it is the column the rows are already
 * indexed by, so no join is needed to reach either of them.
 *
 * `DATABASE_URL` is the same value the API was started with, so this is the
 * database the browser's writes actually reached — not a copy, and not a
 * second environment that happens to have the same schema.
 */
async function connect(): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'phase5-db-read requires DATABASE_URL — the real-API run sets it to the same ' +
        'database the API was started against.',
    );
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Which database answered.
 *
 * Postgres' own cluster identifier, so two runs against two databases cannot be
 * conflated in the evidence — and so a marker that claims a database read names
 * the instance that served it.
 */
export async function databaseSystemId(): Promise<string> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'SELECT system_identifier::text AS id FROM pg_control_system()',
    );
    return rows[0]?.id ?? 'unknown';
  });
}

/**
 * One provider's stored draft, straight from the row.
 *
 * The draft is a single `data` JSON column plus its optimistic-concurrency
 * `version`, which is why this returns both: the value a test asserts on and
 * the revision the server had reached when it stored it.
 */
export async function readDraftRow(
  providerProfileId: string,
): Promise<{ data: Record<string, unknown>; version: number } | null> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ data: Record<string, unknown>; version: number }>(
      `SELECT d."data", d."version"
         FROM "ProviderOnboardingDraft" d
        WHERE d."providerProfileId" = $1
        LIMIT 1`,
      [providerProfileId],
    );
    return rows[0] ?? null;
  });
}

/**
 * Pick named answers out of the stored draft.
 *
 * Returns exactly the requested keys — including ones the draft does not hold,
 * as `undefined` — so a marker's `databaseValues` can be compared field for
 * field against what the provider left on screen. Comparing whole objects would
 * fail on every unrelated field the server also stores.
 */
export async function readDraftValues(
  providerProfileId: string,
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  const row = await readDraftRow(providerProfileId);
  const data = row?.data ?? {};
  const picked: Record<string, unknown> = {};
  for (const key of keys) picked[key] = data[key];
  return picked;
}

/**
 * The weekly availability a provider actually has stored.
 *
 * Its own function because availability is ROWS rather than a field, and the
 * thing worth proving about it is the SET — a week that reloads correctly while
 * the table still holds a stale seventh interval is exactly the bug reading one
 * JSON field cannot see. Which is the G-04 failure mode, one layer down.
 */
export async function readAvailability(
  providerProfileId: string,
): Promise<Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>> {
  return withClient(async (client) => {
    const { rows } = await client.query<{
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
    }>(
      `SELECT a."dayOfWeek", a."startMinute", a."endMinute"
         FROM "ProviderAvailabilityInterval" a
        WHERE a."providerProfileId" = $1
        ORDER BY a."dayOfWeek", a."startMinute"`,
      [providerProfileId],
    );
    return rows;
  });
}
