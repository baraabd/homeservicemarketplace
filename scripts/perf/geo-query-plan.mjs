#!/usr/bin/env node
// Sprint 6 — measures the provider-feed query before and after the geo work.
//
// "It should be faster now" is not evidence. This seeds a realistic table,
// runs BOTH queries against it — the pre-Sprint-6 JSON-path filter and the
// promoted-column filter that replaced it — and prints EXPLAIN ANALYZE for
// each plus a timing distribution over repeated runs.
//
// The two queries are written out in full rather than generated, so the
// comparison is legible: you can read exactly what changed.
//
// Usage:
//   node scripts/perf/geo-query-plan.mjs [--rows 50000] [--runs 30] [--keep]
//
// Requires DATABASE_URL (or the local Compose default). Seeds into a
// dedicated schema and drops it afterwards unless --keep, so it never touches
// application data.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../packages/database/generated/prisma');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const ROWS = flag('rows', 50_000);
const RUNS = flag('runs', 30);
const KEEP = args.includes('--keep');

const SCHEMA = 'perf_sprint06';

// Aleppo, and a 25 km service area around it.
const CENTRE = { lat: 36.2021, lng: 37.1343 };
const RADIUS_KM = 25;
const EARTH_R = 6371;

const latDelta = (RADIUS_KM / EARTH_R) * (180 / Math.PI);
const lngDelta = latDelta / Math.cos((CENTRE.lat * Math.PI) / 180);
const BOX = {
  minLat: CENTRE.lat - latDelta,
  maxLat: CENTRE.lat + latDelta,
  minLng: CENTRE.lng - lngDelta,
  maxLng: CENTRE.lng + lngDelta,
};

const prisma = new PrismaClient();

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function timeIt(label, sql) {
  // Warm the cache first: comparing a cold plan against a warm one measures
  // the buffer pool, not the query.
  for (let i = 0; i < 3; i++) await prisma.$queryRawUnsafe(sql);

  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    await prisma.$queryRawUnsafe(sql);
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    min: samples[0],
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: samples[samples.length - 1],
  };
}

async function explain(sql) {
  const rows = await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
  return rows.map((r) => r['QUERY PLAN']).join('\n');
}

async function main() {
  console.log(`Seeding ${ROWS.toLocaleString()} rows into schema "${SCHEMA}"...`);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA}"`);

  // A table with the same shape as the parts of ServiceRequest the feed
  // touches — both the JSON snapshot and the promoted columns, so the two
  // queries run against IDENTICAL data and the only variable is the predicate.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "${SCHEMA}"."ServiceRequest" (
      "id"              text PRIMARY KEY,
      "status"          text NOT NULL,
      "deletedAt"       timestamptz,
      "categoryId"      text NOT NULL,
      "seekerUserId"    text NOT NULL,
      "createdAt"       timestamptz NOT NULL DEFAULT now(),
      "addressSnapshot" jsonb NOT NULL,
      "locationCityKey" text,
      "locationLat"     double precision,
      "locationLng"     double precision
    )
  `);

  // City cycles on g/7 while category cycles on g%8. Using g%12 for the city
  // would lock the two together — "aleppo" needs g divisible by 12, which
  // forces g%8 into {0,4}, so a city+category query would match zero rows and
  // the comparison would measure nothing. Integer division breaks the tie.
  // Realistic spread: 12 cities, most rows OPEN_FOR_BIDS, coordinates
  // scattered within ~2 degrees of the centre so the box is selective but not
  // trivially empty. 5% ungeocoded, matching the "address did not geocode"
  // case the fallback arm exists for.
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "${SCHEMA}"."ServiceRequest"
      ("id","status","categoryId","seekerUserId","createdAt","addressSnapshot",
       "locationCityKey","locationLat","locationLng")
    SELECT
      'r-' || g,
      CASE WHEN g % 10 = 0 THEN 'COMPLETED' ELSE 'OPEN_FOR_BIDS' END,
      'cat-' || (g % 8),
      'user-' || (g % 1000),
      now() - (g || ' minutes')::interval,
      jsonb_build_object(
        'city',    city.name,
        'cityKey', city.name,
        'country', 'SY',
        'lat',     CASE WHEN g % 20 = 0 THEN NULL ELSE lat END,
        'lng',     CASE WHEN g % 20 = 0 THEN NULL ELSE lng END
      ),
      city.name,
      CASE WHEN g % 20 = 0 THEN NULL ELSE lat END,
      CASE WHEN g % 20 = 0 THEN NULL ELSE lng END
    FROM generate_series(1, $1) AS g,
    LATERAL (SELECT ($2::float8 + ((g % 400) - 200) * 0.01) AS lat,
                    ($3::float8 + ((g % 373) - 186) * 0.01) AS lng) coords,
    LATERAL (SELECT (ARRAY['aleppo','damascus','homs','hama','latakia','tartus',
                           'idlib','raqqa','deirezzor','hasakah','qamishli','daraa'])[1 + ((g / 7) % 12)] AS name) city
  `,
    ROWS,
    CENTRE.lat,
    CENTRE.lng,
  );

  // The indexes the Sprint 6 migration adds. The BEFORE query gets no help
  // from them, which is the point: no btree index can serve a JSON path
  // expression.
  await prisma.$executeRawUnsafe(
    `CREATE INDEX sr_city_idx ON "${SCHEMA}"."ServiceRequest" ("status","deletedAt","locationCityKey")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX sr_geo_idx ON "${SCHEMA}"."ServiceRequest" ("status","deletedAt","locationLat","locationLng")`,
  );
  await prisma.$executeRawUnsafe(`ANALYZE "${SCHEMA}"."ServiceRequest"`);

  const common = `
      "status" = 'OPEN_FOR_BIDS'
      AND "deletedAt" IS NULL
      AND "categoryId" IN ('cat-1','cat-2','cat-3')`;

  // BEFORE — the pre-Sprint-6 predicate: city equality through a JSON path.
  const before = `
    SELECT "id" FROM "${SCHEMA}"."ServiceRequest"
    WHERE ${common}
      AND "addressSnapshot"->>'cityKey' = 'aleppo'
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 20`;

  // AFTER (city path) — the same question against the promoted column.
  const afterCity = `
    SELECT "id" FROM "${SCHEMA}"."ServiceRequest"
    WHERE ${common}
      AND "locationCityKey" = 'aleppo'
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 20`;

  // AFTER (radius path) — what the feed runs for a geocoded provider: the
  // bounding box, OR-ed with the ungeocoded same-city fallback arm.
  const afterRadius = `
    SELECT "id" FROM "${SCHEMA}"."ServiceRequest"
    WHERE ${common}
      AND (
        ("locationLat" BETWEEN ${BOX.minLat} AND ${BOX.maxLat}
         AND "locationLng" BETWEEN ${BOX.minLng} AND ${BOX.maxLng})
        OR ("locationLat" IS NULL AND "locationCityKey" = 'aleppo')
      )
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT 26`; // over-fetched by 4/pi, as the repository does

  const cases = [
    ['BEFORE  json-path city equality', before],
    ['AFTER   promoted-column city equality', afterCity],
    ['AFTER   bounding box + city fallback', afterRadius],
  ];

  const results = [];
  for (const [label, sql] of cases) {
    console.log(`\n${'='.repeat(78)}\n${label}\n${'='.repeat(78)}`);
    console.log(await explain(sql));
    const t = await timeIt(label, sql);
    results.push(t);
    console.log(
      `\n  min ${t.min.toFixed(2)}ms | p50 ${t.p50.toFixed(2)}ms | ` +
        `p95 ${t.p95.toFixed(2)}ms | max ${t.max.toFixed(2)}ms  (${RUNS} runs)`,
    );
  }

  console.log(`\n${'='.repeat(78)}\nSUMMARY — ${ROWS.toLocaleString()} rows, ${RUNS} runs each`);
  console.log('='.repeat(78));
  for (const r of results) {
    console.log(
      `${r.label.padEnd(42)} p50 ${r.p50.toFixed(2).padStart(8)}ms   p95 ${r.p95
        .toFixed(2)
        .padStart(8)}ms`,
    );
  }
  const [b, c] = results;
  if (b && c && c.p50 > 0) {
    console.log(`\nCity-equality path: ${(b.p50 / c.p50).toFixed(1)}x faster at p50`);
  }

  if (!KEEP) {
    await prisma.$executeRawUnsafe(`DROP SCHEMA "${SCHEMA}" CASCADE`);
    console.log(`\nDropped schema "${SCHEMA}".`);
  } else {
    console.log(`\nKept schema "${SCHEMA}" (--keep).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
