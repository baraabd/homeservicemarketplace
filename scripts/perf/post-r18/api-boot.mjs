#!/usr/bin/env node
// R27 — API start-to-ready and first-response timing on the lane stack.
//
// Each run spawns `node apps/api/dist/main.js` (the production build, not a
// watcher), times spawn -> /health/live -> /health/ready, then times the first
// and subsequent responses of a public catalogue read and an anonymous
// session probe. Dependency installation and compilation are excluded: the
// build must already exist and its provenance is recorded.
//
// "First" boot is the first after this script starts; later boots reuse the
// OS file cache, so the report calls them warm. A truly cold disk cache needs
// a reboot and is not claimed.
//
// Usage: node scripts/perf/post-r18/api-boot.mjs [--runs 5] [--requests 30]
//   [--profile production|fixture] [--out-json path]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { API_MAIN, rssMiB, startApi, stopApi } from './lib/api-process.mjs';
import { LANE } from './lib/lane-env.mjs';
import { REPO_ROOT, hostProvenance, sha256File, sourceProvenance } from './lib/provenance.mjs';
import { summarize } from './lib/stats.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const RUNS = Number(option('runs', 5));
const REQUESTS = Number(option('requests', 30));
const OUT = option('out-json', null);
const PROFILE = option('profile', 'production');

// Public reads only: they need no fixture and show framework + DB round trip.
const PROBES = [
  { name: 'catalogue', path: '/v1/services', expect: 200 },
  { name: 'session-anonymous', path: '/v1/auth/me', expect: 401 },
];

async function timed(path) {
  const t0 = performance.now();
  const res = await fetch(`${LANE.api}${path}`);
  await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status };
}

// The production throttle (100 requests/minute per IP, Redis-backed) is left
// unchanged, so its counters are cleared between runs instead. This touches
// only the lane's own disposable Redis container, never a shared instance.
function resetLaneRedis() {
  execFileSync('docker', ['exec', 'hsm-r27-perf-redis', 'redis-cli', 'FLUSHDB'], {
    stdio: 'ignore',
  });
}

async function main() {
  const logDir = mkdtempSync(join(tmpdir(), 'hsm-r27-api-'));
  const runs = [];
  for (let run = 0; run < RUNS; run += 1) {
    resetLaneRedis();
    const handle = await startApi({
      logFile: join(logDir, `boot-${run}.log`),
      profile: PROFILE,
    });
    try {
      const rssAtReady = rssMiB(handle.pid);
      const probes = {};
      for (const probe of PROBES) {
        const first = await timed(probe.path);
        if (first.status !== probe.expect) {
          throw new Error(`${probe.name} answered ${first.status}, expected ${probe.expect}`);
        }
        const later = [];
        for (let i = 0; i < REQUESTS; i += 1) {
          const r = await timed(probe.path);
          if (r.status !== probe.expect) throw new Error(`${probe.name} changed to ${r.status}`);
          later.push(r.ms);
        }
        probes[probe.name] = {
          firstMs: Math.round(first.ms * 10) / 10,
          subsequent: summarize(later),
        };
      }
      runs.push({
        run,
        cache: run === 0 ? 'first-boot-in-session' : 'warm-os-cache',
        liveMs: Math.round(handle.liveMs),
        readyMs: Math.round(handle.readyMs),
        rssMiBAtReady: rssAtReady,
        rssMiBAfterProbes: rssMiB(handle.pid),
        probes,
      });
      console.log(
        `[r27-boot] run ${run}: live ${Math.round(handle.liveMs)} ms, ready ${Math.round(handle.readyMs)} ms, ` +
          `catalogue first ${probes.catalogue.firstMs} ms p50 ${probes.catalogue.subsequent.p50} ms, rss ${rssAtReady} MiB`,
      );
    } finally {
      await stopApi(handle);
    }
  }

  const report = {
    schemaVersion: 1,
    kind: 'r27-api-boot',
    measuredAt: new Date().toISOString(),
    source: sourceProvenance(),
    host: hostProvenance(),
    build: {
      artifact: 'apps/api/dist/main.js',
      sha256: sha256File(API_MAIN),
      modifiedAt: statSync(API_MAIN).mtime.toISOString(),
    },
    environment: {
      profile:
        PROFILE === 'production'
          ? 'production (NODE_ENV=production, production env policy, secure cookies)'
          : 'fixture (NODE_ENV=development, CI real-API settings)',
      deviations: [
        'VERIFICATION_ENFORCED=false: production policy needs ClamAV, which the lane does not run',
        'CORS_ORIGINS is an https placeholder; no browser is served',
      ],
      APP_ENV: 'test',
      LOG_LEVEL: 'info (stdout to a temporary file)',
      workers: 'all background workers disabled',
      database: 'hsm-r27-perf-postgres (postgres:16-alpine, loopback, seeded catalogue)',
      redis: 'hsm-r27-perf-redis (redis:7-alpine, no persistence)',
      betweenRuns: 'lane Redis FLUSHDB (throttle counters); database untouched',
      concurrentLoad: 'none from this harness; other lanes may run on the host',
    },
    runs,
    summary: {
      liveMs: summarize(runs.map((r) => r.liveMs)),
      readyMs: summarize(runs.map((r) => r.readyMs)),
      warmReadyMs: summarize(runs.slice(1).map((r) => r.readyMs)),
      catalogueFirstMs: summarize(runs.map((r) => r.probes.catalogue.firstMs)),
      rssMiBAtReady: summarize(runs.map((r) => r.rssMiBAtReady)),
    },
  };
  if (OUT) writeFileSync(resolve(REPO_ROOT, OUT), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[r27-boot] ready p50 ${report.summary.readyMs.p50} ms over ${runs.length} runs`);
}

main().catch((error) => {
  console.error(`[r27-boot] failed: ${error.message}`);
  process.exitCode = 1;
});
