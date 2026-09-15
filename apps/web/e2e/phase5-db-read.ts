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
// AND IT CATCHES THE TEST'S OWN MISTAKES — TWICE, SO FAR
//
// First this file selected `displayName` as a COLUMN of
// `ProviderOnboardingDraft`. It is not one, so the query failed outright.
//
// The correction was worse, because it passed. It concluded that the draft
// keeps every answer in its `data` JSON and read them all from there, and CI
// duly reported `displayName: undefined` for a name that was on screen, in the
// API response, and in the database. The wizard writes two different things:
//
//   ProviderOnboardingDraft.data   the SCRATCH only — `primaryGroupIds` and
//                                  friends, values with nowhere else to live
//                                  (`data: scratch` in the wizard service)
//   ProviderProfile.<column>       every real answer: displayName, headline,
//                                  bio, yearsOfExperience, serviceAreaRadiusKm,
//                                  acceptedConsentVersion, …
//
// The API's `data` field in a wizard RESPONSE is a projection built by
// `toData()` from the profile, which is what made the wrong model look right:
// the response and the draft column share a name and hold different things.
//
// So "durable" for an onboarding answer means a ProviderProfile column, and
// that is what `readProfileValues` reads. Twice now the schema has refused a
// query written from memory; both times it was the test that was wrong.
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
 * Columns of `ProviderProfile` a Phase 5 marker is allowed to read.
 *
 * An allow-list rather than free interpolation: a column name cannot be
 * parameterised in SQL, so the only safe way to build `SELECT "x"` from a
 * caller's string is to refuse any string that is not on this list. It also
 * fails loudly when a spec asks for a field that moved, instead of quietly
 * returning `undefined` and letting a marker record that nothing persisted —
 * which is precisely the failure this module just had.
 */
const READABLE_PROFILE_COLUMNS = new Set([
  'displayName',
  'legalBusinessName',
  'providerType',
  'phoneNumber',
  'headline',
  'bio',
  'yearsOfExperience',
  'professionSince',
  'transportMode',
  'serviceAreaCity',
  'serviceAreaCityKey',
  'serviceAreaCountryCode',
  'serviceAreaRadiusKm',
  'serviceAreaLat',
  'serviceAreaLng',
  'primaryServiceCategoryId',
  'acceptedConsentVersion',
  'consentAcceptedAt',
  'onboardingState',
  'status',
  'submittedForReviewAt',
]);

/**
 * Named answers, from the columns that actually hold them.
 *
 * Returns exactly the requested keys so a marker's `databaseValues` can be
 * compared field for field against what the provider left on screen; comparing
 * whole rows would fail on every unrelated column the server also keeps.
 *
 * `null` is normalised to `undefined` because that is what the screens mean by
 * "not set" and what an assertion against `before` is written in terms of; a
 * column that has never been written and one explicitly cleared are the same
 * fact to a provider looking at an empty field.
 */
export async function readProfileValues(
  providerProfileId: string,
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  const unknown = keys.filter((k) => !READABLE_PROFILE_COLUMNS.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `phase5-db-read: not readable ProviderProfile columns: ${unknown.join(', ')}. ` +
        'Add them to READABLE_PROFILE_COLUMNS only after confirming against the ' +
        'live schema that the wizard stores the answer there.',
    );
  }
  if (keys.length === 0) return {};
  return withClient(async (client) => {
    const selection = keys.map((k) => `p."${k}"`).join(', ');
    const { rows } = await client.query<Record<string, unknown>>(
      `SELECT ${selection} FROM "ProviderProfile" p WHERE p."id" = $1 LIMIT 1`,
      [providerProfileId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error(
        `phase5-db-read: no ProviderProfile row for ${providerProfileId}. The ` +
          'harness creates the provider through the public endpoints, so an absent ' +
          'row means the journey under test never got that far.',
      );
    }
    const picked: Record<string, unknown> = {};
    for (const key of keys) picked[key] = row[key] ?? undefined;
    return picked;
  });
}

/**
 * One provider's stored draft SCRATCH, straight from the row.
 *
 * Only the values that have nowhere better to live are in here. Anything a
 * provider typed into a field is a `ProviderProfile` column — use
 * `readProfileValues` for those.
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
 * Pick named keys out of the draft's scratch JSON.
 *
 * For scratch only. An onboarding ANSWER is not in here and asking for one
 * returns `undefined`, which is why the profile reader exists and why this is
 * no longer the default choice for a persistence assertion.
 */
export async function readDraftScratch(
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
 * The specialty ids a provider actually HOLDS, from the membership table.
 *
 * Its own read because the reported failure lived exactly in the gap between
 * two facts: `ProviderProfile.primaryServiceCategoryId` was set while
 * `ProviderProfileServiceCategory` held no rows — a primary pointing at
 * nothing. An API projection can paper over that; the rows cannot.
 */
export async function readSpecialtyMembership(providerProfileId: string): Promise<string[]> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ serviceCategoryId: string }>(
      `SELECT s."serviceCategoryId"
         FROM "ProviderProfileServiceCategory" s
        WHERE s."providerProfileId" = $1
        ORDER BY s."serviceCategoryId"`,
      [providerProfileId],
    );
    return rows.map((r) => r.serviceCategoryId);
  });
}

/**
 * The portfolio item ids, in the order the rows say they are in.
 *
 * Its own function for the same reason availability has one: the durable fact
 * is a SEQUENCE, and `position` is the column that carries it. A reorder that
 * satisfies the endpoint while leaving `position` untouched would answer an API
 * read correctly — the projection could sort by anything — and answer this one
 * wrongly.
 *
 * Soft-deleted rows are excluded, because a provider who removed a photo does
 * not consider it part of their order.
 */
export async function readPortfolioOrder(providerProfileId: string): Promise<string[]> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT p."id"
         FROM "ProviderPortfolioItem" p
        WHERE p."providerProfileId" = $1
          AND p."deletedAt" IS NULL
        ORDER BY p."position", p."createdAt"`,
      [providerProfileId],
    );
    return rows.map((r) => r.id);
  });
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
