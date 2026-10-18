// Bounded R37 input profiles on the isolated R27 fixture. No capacity claim.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rssMiB } from './lib/api-process.mjs';
import { summarize } from './lib/stats.mjs';

function cpuSeconds(pid) {
  try {
    if (process.platform !== 'linux') return null;
    // Work Mode may expose a different /proc view: do not attribute a peer PID.
    if (Number(readFileSync('/proc/self/stat', 'utf8').split(' ')[0]) !== process.pid) return null;
    const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
    return (Number(fields[11]) + Number(fields[12])) / ticks;
  } catch {
    return null;
  }
}

export async function measureWorkloads(pid, request) {
  const results = [];
  for (const [name, concurrency] of [
    ['normal', 2],
    ['burst', 16],
    ['post-burst-recovery', 4],
  ]) {
    const count = 200;
    const timings = [],
      statuses = {},
      memory = [];
    let next = 0;
    const sample = () => {
      const rss = rssMiB(pid);
      if (rss !== null) memory.push(rss);
    };
    sample();
    const interval = setInterval(sample, 100);
    const cpuStart = cpuSeconds(pid),
      started = performance.now();
    try {
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next++ < count) {
            const at = performance.now();
            const response = await request();
            timings.push(performance.now() - at);
            statuses[response.status] = (statuses[response.status] ?? 0) + 1;
          }
        }),
      );
    } finally {
      clearInterval(interval);
      sample();
    }
    const wallSeconds = (performance.now() - started) / 1000;
    const cpuEnd = cpuSeconds(pid);
    results.push({
      name,
      concurrency,
      requests: timings.length,
      statusCounts: statuses,
      errorRate: (timings.length - (statuses[200] ?? 0)) / timings.length,
      latencyMs: summarize(timings),
      elapsedSeconds: wallSeconds,
      apiCpuSeconds: cpuStart === null || cpuEnd === null ? null : cpuEnd - cpuStart,
      apiRssPeakMiB: memory.length ? Math.max(...memory) : null,
      cache: 'warm application/DB cache after query profiling',
      limits:
        '200 closed-loop requests; fixture throttle budget; no network shaping. Empirical tails are not production SLO confidence or hosted capacity.',
    });
    if (statuses[200] !== count)
      throw new Error(name + ' read workload returned non-200 responses');
  }
  return results;
}
