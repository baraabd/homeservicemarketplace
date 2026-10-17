// R27 — direct access to the lane database (fixtures, statistics, plans).

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { LANE, assertLaneDatabase, assertLaneService } from './lane-env.mjs';
import { REPO_ROOT } from './provenance.mjs';

// `pg` is a dev dependency of the web package (its real-API suites use it).
const { Client } = createRequire(resolve(REPO_ROOT, 'apps/web/package.json'))('pg');

export async function laneDb() {
  assertLaneService('postgres');
  const client = new Client({ connectionString: assertLaneDatabase(LANE.databaseUrl) });
  await client.connect();
  await client.query("SET application_name = 'r27-harness'");
  return client;
}
