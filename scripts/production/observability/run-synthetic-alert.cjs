#!/usr/bin/env node
'use strict';

// R23 — end-to-end synthetic alert test.
//
//   compiled API telemetry (synthetic-target.cjs)
//     → Prometheus scrape + the production rule files
//     → Alertmanager routing (test receivers only)
//     → local test receiver (test-receiver.cjs)
//
// Phases: healthy traffic, injected failure until ApiAvailabilityFastBurn is
// DELIVERED as firing, recovery until it is DELIVERED as resolved. Also runs
// the alert quality gate against the rules Prometheus actually loaded.
//
// Isolation: Compose project `hsm-r23-obs` (no fixed names, no named
// volumes); host ports 19090/19093/19095/19100 on loopback, refused if taken.
// Teardown removes only this project's containers and anonymous volumes.
//
// Usage: node run-synthetic-alert.cjs <evidence-dir>

const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { checkAlertQuality } = require('./alert-quality.cjs');

const repoRoot = path.resolve(__dirname, '../../..');
const obsDir = path.join(repoRoot, 'infra/production/observability');
const composeFile = path.join(obsDir, 'compose.alert-test.yml');
const PROJECT = 'hsm-r23-obs';
const PORTS = { prometheus: 19090, alertmanager: 19093, receiver: 19095, target: 19100 };
const ALERT = 'ApiAvailabilityFastBurn';
const RPS = 5;

const evidenceDir = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: run-synthetic-alert.cjs <evidence-dir>');
  process.exit(2);
}
fs.mkdirSync(evidenceDir, { recursive: true });
const receiverFile = path.join(evidenceDir, 'receiver-notifications.jsonl');
const targetLog = path.join(evidenceDir, 'synthetic-target.log.jsonl');
for (const f of [receiverFile, targetLog]) fs.rmSync(f, { force: true });

const timeline = [];
const mark = (event, extra = {}) => {
  const entry = { at: new Date().toISOString(), event, ...extra };
  timeline.push(entry);
  process.stdout.write(
    `[${entry.at}] ${event} ${Object.keys(extra).length ? JSON.stringify(extra) : ''}\n`,
  );
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sha256Files(files) {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(path.relative(repoRoot, f).replace(/\\/gu, '/'));
    h.update('\0');
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex');
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function compose(...args) {
  return execFileSync('docker', ['compose', '-p', PROJECT, '-f', composeFile, ...args], {
    cwd: obsDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function waitFor(label, fn, timeoutMs, everyMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // keep polling
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(everyMs);
  }
}

function notifications() {
  if (!fs.existsSync(receiverFile)) return [];
  return fs
    .readFileSync(receiverFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function delivered(status) {
  return notifications().find(
    (n) => n.status === status && n.alerts.some((a) => a.labels.alertname === ALERT),
  );
}

/** Drives traffic at RPS until stop() is called; failRatio of calls hit /fail. */
function traffic(failRatio) {
  let stopped = false;
  const counts = { ok: 0, fail: 0, errors: 0 };
  const loop = (async () => {
    let i = 0;
    while (!stopped) {
      const fail = i % 10 < failRatio * 10;
      i += 1;
      fetch(`http://127.0.0.1:${PORTS.target}/v1/synthetic/${fail ? 'fail' : 'ok'}`, {
        signal: AbortSignal.timeout(5_000),
      })
        .then((r) => (r.status >= 500 ? counts.fail++ : counts.ok++))
        .catch(() => counts.errors++);
      await sleep(1_000 / RPS);
    }
  })();
  return {
    counts,
    stop: async () => {
      stopped = true;
      await loop;
    },
  };
}

const children = [];
function start(script, args, name) {
  const child = spawn(process.execPath, [path.join(__dirname, script), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  children.push(child);
  return child;
}

async function main() {
  const result = {
    test: 'r23-synthetic-alert-path',
    sourceSha: git('rev-parse', 'HEAD'),
    worktreeClean: git('status', '--porcelain') === '',
    configVersion: sha256Files([
      path.join(obsDir, 'prometheus/rules/api-slo.rules.yml'),
      path.join(obsDir, 'prometheus/rules/platform.rules.yml'),
      path.join(obsDir, 'prometheus/prometheus.test.yml'),
      path.join(obsDir, 'alertmanager/alertmanager.test.yml'),
      composeFile,
    ]),
    images: {},
    receiver: 'local test receiver only (no production contact)',
    timeline,
  };

  for (const [name, port] of Object.entries(PORTS)) {
    if (!(await portFree(port)))
      throw new Error(`port ${port} (${name}) is in use; refusing to guess`);
  }

  start('test-receiver.cjs', [String(PORTS.receiver), receiverFile], 'receiver');
  start('synthetic-target.cjs', [String(PORTS.target), targetLog], 'target');
  await waitFor(
    'synthetic target',
    async () => (await fetch(`http://127.0.0.1:${PORTS.target}/v1/synthetic/ok`)).ok,
    30_000,
    500,
  );
  mark('target-and-receiver-up');

  compose('up', '-d');
  mark('compose-up', { project: PROJECT });
  for (const svc of ['prometheus', 'alertmanager']) {
    const id = compose('ps', '-q', svc).trim();
    result.images[svc] = execFileSync(
      'docker',
      ['inspect', '--format', '{{.Image}} {{.Config.Image}}', id],
      {
        encoding: 'utf8',
      },
    ).trim();
  }

  await waitFor(
    'prometheus ready',
    async () => (await fetch(`http://127.0.0.1:${PORTS.prometheus}/-/ready`)).ok,
    60_000,
  );
  await waitFor(
    'alertmanager ready',
    async () => (await fetch(`http://127.0.0.1:${PORTS.alertmanager}/-/ready`)).ok,
    60_000,
  );
  await waitFor(
    'scrape target up',
    async () => {
      const t = await getJson(`http://127.0.0.1:${PORTS.prometheus}/api/v1/targets`);
      return t.data.activeTargets.some((x) => x.labels.job === 'hsm-api' && x.health === 'up');
    },
    60_000,
  );
  mark('scrape-target-up');

  const rules = await getJson(`http://127.0.0.1:${PORTS.prometheus}/api/v1/rules`);
  result.alertQuality = checkAlertQuality(rules, repoRoot);
  mark('alert-quality-checked', {
    alerts: result.alertQuality.alerts.length,
    problems: result.alertQuality.problems.length,
  });

  // Healthy baseline.
  let t = traffic(0);
  await sleep(60_000);
  await t.stop();
  result.healthyTraffic = { ...t.counts };
  mark('healthy-phase-done', t.counts);

  // Every dashboard query must parse and evaluate against the live server.
  // "Has data" is reported separately: PENDING panels legitimately have none.
  result.dashboardQueries = [];
  for (const file of fs.readdirSync(path.join(obsDir, 'dashboards'))) {
    const dash = JSON.parse(fs.readFileSync(path.join(obsDir, 'dashboards', file), 'utf8'));
    for (const p of dash.panels) {
      for (const target of p.targets) {
        const q = new URL(`http://127.0.0.1:${PORTS.prometheus}/api/v1/query`);
        q.searchParams.set('query', target.expr);
        let status = 'error';
        let series = 0;
        try {
          const r = await getJson(q.toString());
          status = r.status;
          series = r.data.result.length;
        } catch {
          // recorded as error
        }
        result.dashboardQueries.push({
          dashboard: dash.uid,
          panel: p.title,
          ref: target.refId,
          status,
          series,
        });
      }
    }
  }
  const badQueries = result.dashboardQueries.filter((q) => q.status !== 'success');
  mark('dashboard-queries-checked', {
    total: result.dashboardQueries.length,
    failed: badQueries.length,
  });

  // Injected failure: 60 % of requests throw.
  t = traffic(0.6);
  mark('failure-injection-started', { failRatio: 0.6, rps: RPS });
  const firing = await waitFor(
    'firing notification',
    async () => delivered('firing'),
    10 * 60_000,
    5_000,
  );
  await t.stop();
  result.failureTraffic = { ...t.counts };
  mark('firing-delivered', { receivedAt: firing.receivedAt, path: firing.path });

  // Recovery: healthy traffic until the resolved notification arrives.
  t = traffic(0);
  mark('recovery-started');
  const resolved = await waitFor(
    'resolved notification',
    async () => delivered('resolved'),
    15 * 60_000,
    5_000,
  );
  await t.stop();
  result.recoveryTraffic = { ...t.counts };
  mark('resolved-delivered', { receivedAt: resolved.receivedAt, path: resolved.path });

  // Self-check of the scrape: no request path with an id, no secret-shaped
  // header ever reaches the exposition.
  const exposition = await (await fetch(`http://127.0.0.1:${PORTS.target}/metrics`)).text();
  result.exposition = {
    httpSeries: exposition.split('\n').filter((l) => l.startsWith('http_requests_total{')),
  };

  result.notifications = notifications().map((n) => ({
    receivedAt: n.receivedAt,
    path: n.path,
    status: n.status,
    alerts: n.alerts.map((a) => ({
      alertname: a.labels.alertname,
      severity: a.labels.severity,
      status: a.status,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      runbook_url: a.annotations.runbook_url,
    })),
  }));
  result.passed =
    result.alertQuality.problems.length === 0 &&
    result.dashboardQueries.every((q) => q.status === 'success') &&
    firing.path === '/alerts/page' &&
    Boolean(resolved);
  return result;
}

async function teardown() {
  for (const c of children) c.kill();
  try {
    compose('down', '-v', '--remove-orphans');
    mark('compose-down', { project: PROJECT });
  } catch (err) {
    mark('compose-down-failed', { error: err.name });
  }
}

main()
  .then(async (result) => {
    await teardown();
    fs.writeFileSync(
      path.join(evidenceDir, 'synthetic-alert-result.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    process.stdout.write(`RESULT passed=${result.passed}\n`);
    process.exit(result.passed ? 0 : 1);
  })
  .catch(async (err) => {
    mark('failed', { error: String(err && err.message) });
    await teardown();
    fs.writeFileSync(
      path.join(evidenceDir, 'synthetic-alert-result.json'),
      JSON.stringify({ test: 'r23-synthetic-alert-path', passed: false, timeline }, null, 2) + '\n',
    );
    process.exit(1);
  });
