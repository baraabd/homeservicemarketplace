// R27 — start, observe and stop the built API under the lane environment.

import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { REPO_ROOT } from './provenance.mjs';
import { LANE, apiEnv, assertLaneService } from './lane-env.mjs';

export const API_MAIN = resolve(REPO_ROOT, 'apps/api/dist/main.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Detect even a non-HTTP listener; unexpected socket errors fail closed. */
export async function portBusy(url = `${LANE.api}/health/live`) {
  const target = new URL(url);
  if (target.hostname !== '127.0.0.1') throw new Error('port probe must use loopback');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(true);
      else reject(error);
    });
    server.listen({ host: target.hostname, port: Number(target.port), exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve(false)));
    });
  });
}

/** Resident set size of a process in MiB, or null when it cannot be read. */
export function rssMiB(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`],
        { encoding: 'utf8' },
      );
      return Math.round((Number(out.trim()) / 2 ** 20) * 10) / 10;
    }
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const kb = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1]);
    return Number.isFinite(kb) ? Math.round((kb / 1024) * 10) / 10 : null;
  } catch {
    return null;
  }
}

/**
 * Spawn the API and time it to liveness and readiness.
 * Times are from just before spawn(), so they include Node's own start-up.
 */
export async function startApi({
  logFile,
  profile = 'fixture',
  overrides = {},
  nodeArgs = [],
  ipc = false,
  timeoutMs = 90_000,
} = {}) {
  if (!existsSync(API_MAIN))
    throw new Error('apps/api/dist/main.js is missing; build the API first');
  assertLaneService('postgres');
  assertLaneService('redis');
  if (await portBusy()) {
    throw new Error(`port ${LANE.apiPort} already answers; refusing to measure another process`);
  }
  const log = logFile ? createWriteStream(logFile, { flags: 'a' }) : null;
  const t0 = performance.now();
  const child = spawn(process.execPath, [...nodeArgs, API_MAIN], {
    cwd: REPO_ROOT,
    env: apiEnv({ profile, overrides }),
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });
  child.stdout.on('data', (d) => log?.write(d));
  child.stderr.on('data', (d) => log?.write(d));
  try {
    await once(child, 'spawn');
  } catch (error) {
    log?.end();
    throw error;
  }

  let liveMs = null;
  let readyMs = null;
  while (performance.now() - t0 < timeoutMs) {
    if (exited) {
      log?.end();
      throw new Error(`API exited during start-up (${JSON.stringify(exited)})`);
    }
    if (liveMs === null) {
      try {
        const res = await fetch(`${LANE.api}/health/live`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) liveMs = performance.now() - t0;
      } catch {
        /* not listening yet */
      }
    }
    if (liveMs !== null) {
      try {
        const res = await fetch(`${LANE.api}/health/ready`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          readyMs = performance.now() - t0;
          break;
        }
      } catch {
        /* dependencies not ready yet */
      }
    }
    await sleep(20);
  }
  if (readyMs === null) {
    await stopApi({ child, log });
    throw new Error(`API not ready within ${timeoutMs} ms`);
  }
  return { child, log, liveMs, readyMs, pid: child.pid };
}

/** Stop the process tree this harness started, and only that tree. */
export async function stopApi(handle) {
  const { child, log } = handle;
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    } else {
      child.kill('SIGTERM');
    }
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
      await sleep(50);
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      const killed = Date.now() + 5000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < killed) {
        await sleep(50);
      }
      if (child.exitCode === null && child.signalCode === null) {
        throw new Error('owned API child did not exit; refusing a subsequent measurement');
      }
    }
  }
  log?.end();
  // Do not wait for or kill another process that acquires the released port.
}
