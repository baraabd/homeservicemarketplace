#!/usr/bin/env node
// R27 — where API start-up time goes.
//
// Boots the production build once under V8's sampling profiler and stops it
// when /health/ready answers, then attributes self time to packages and
// application areas. Sampling is statistical: shares are reliable, a single
// small function's time is not. Use it to choose what to investigate, not as
// a timing result (profiling adds overhead; api-boot.mjs gives the timings).
//
// Usage: node scripts/perf/post-r18/api-boot-profile.mjs [--out-json path]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { startApi, stopApi } from './lib/api-process.mjs';
import { assertLaneService } from './lib/lane-env.mjs';
import { REPO_ROOT, hostProvenance, sourceProvenance } from './lib/provenance.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out-json');
const OUT = outIndex >= 0 ? args[outIndex + 1] : null;

/** Group a profiled script URL into a package or source area. */
export function areaOf(url) {
  if (!url) return '(native/vm)';
  const path = decodeURIComponent(url.replace(/^file:\/\/\/?/, '')).replace(/\\/g, '/');
  const at = path.lastIndexOf('/node_modules/');
  if (at >= 0) {
    const rest = path.slice(at + '/node_modules/'.length).split('/');
    return rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const dist = path.indexOf('/apps/api/dist/');
  if (dist >= 0)
    return `api:${path
      .slice(dist + '/apps/api/dist/'.length)
      .split('/')
      .slice(0, 2)
      .join('/')}`;
  if (path.includes('/packages/database/generated/')) return 'prisma-generated-client';
  if (path.startsWith('node:')) return 'node:internal';
  return path.includes('/') ? 'other' : path;
}

async function main() {
  assertLaneService('redis');
  execFileSync('docker', ['exec', 'hsm-r27-perf-redis', 'redis-cli', 'FLUSHDB'], {
    stdio: 'ignore',
  });
  const dir = mkdtempSync(join(tmpdir(), 'hsm-r27-prof-'));
  const handle = await startApi({
    profile: 'production',
    nodeArgs: [
      '--cpu-prof',
      `--cpu-prof-dir=${dir}`,
      '--cpu-prof-interval=2000',
      '--require',
      resolve(import.meta.dirname, 'lib/exit-on-ipc.cjs'),
    ],
    ipc: true,
    logFile: join(dir, 'api.log'),
  });
  const readyMs = Math.round(handle.readyMs);
  // A forced kill writes no profile; ask the process to exit cleanly instead.
  handle.child.send('r27:exit');
  const deadline = Date.now() + 15_000;
  while (handle.child.exitCode === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await stopApi(handle);

  const file = readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
  if (!file) throw new Error('no CPU profile was written (the process did not exit cleanly)');
  const profile = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parentOf = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
  // Native frames (compileFunction, JSON.parse, fs reads) carry no URL. Charge
  // them to the nearest JavaScript caller, so module compilation is attributed
  // to the package that required the module rather than to "native".
  const areaFor = (node) => {
    const name = node.callFrame.functionName;
    if (['(idle)', '(program)', '(garbage collector)'].includes(name)) return name;
    for (let cur = node; cur; cur = byId.get(parentOf.get(cur.id))) {
      if (cur.callFrame.url && !cur.callFrame.url.startsWith('node:')) {
        return areaOf(cur.callFrame.url);
      }
    }
    return '(native/vm)';
  };
  // Samples taken anywhere inside CommonJS loading (resolve, read, compile).
  const LOADER = new Set(['Module._load', 'Module._compile', 'wrapModuleLoad', 'Module.require']);
  const loading = (node) => {
    for (let cur = node; cur; cur = byId.get(parentOf.get(cur.id))) {
      if (LOADER.has(cur.callFrame.functionName)) return true;
    }
    return false;
  };
  let loadingUs = 0;
  const deltas = profile.timeDeltas;
  const self = new Map();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const node = byId.get(id);
    const area = areaFor(node);
    const us = deltas[i] ?? 0;
    if (loading(node)) loadingUs += us;
    self.set(area, (self.get(area) ?? 0) + us);
    total += us;
  });
  const busy = total - (self.get('(idle)') ?? 0);
  const ranked = [...self.entries()]
    .filter(([area]) => area !== '(idle)')
    .map(([area, us]) => ({
      area,
      selfMs: Math.round(us / 1000),
      shareOfBusy: Math.round((us / busy) * 1000) / 10,
    }))
    .sort((a, b) => b.selfMs - a.selfMs);

  const report = {
    schemaVersion: 1,
    kind: 'r27-api-boot-profile',
    measuredAt: new Date().toISOString(),
    source: sourceProvenance(),
    host: hostProvenance(),
    note: 'sampling profile of one production-profile boot; overhead included; shares, not timings',
    readyMsUnderProfiler: readyMs,
    profiledMs: Math.round(total / 1000),
    idleMs: Math.round((self.get('(idle)') ?? 0) / 1000),
    moduleLoadingMs: Math.round(loadingUs / 1000),
    moduleLoadingShareOfBusy: Math.round((loadingUs / busy) * 1000) / 10,
    attribution: 'loader/native frames charged to the nearest non-internal JavaScript caller',
    top: ranked.slice(0, 25),
  };
  if (OUT) writeFileSync(resolve(REPO_ROOT, OUT), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `[r27-boot-profile] ready ${readyMs} ms under profiler; busy ${Math.round(busy / 1000)} ms; ` +
      `module loading ${report.moduleLoadingMs} ms (${report.moduleLoadingShareOfBusy}%)`,
  );
  for (const row of ranked.slice(0, 15)) {
    console.log(
      `  ${row.area.padEnd(40)} ${String(row.selfMs).padStart(6)} ms ${String(row.shareOfBusy).padStart(5)}%`,
    );
  }
}

main().catch((error) => {
  console.error(`[r27-boot-profile] failed: ${error.message}`);
  process.exitCode = 1;
});
