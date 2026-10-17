import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiEnv, assertLaneDatabase, LANE, verifyLaneContainer } from './lane-env.mjs';
import { portBusy } from './api-process.mjs';

test('only the exact disposable database URL is accepted', () => {
  assert.equal(assertLaneDatabase(LANE.databaseUrl), LANE.databaseUrl);
  for (const url of [
    LANE.databaseUrl + '?host=peer.example',
    LANE.databaseUrl.replace('postgresql:', 'https:'),
    LANE.databaseUrl.replace('127.0.0.1', 'localhost'),
    LANE.databaseUrl.replace('54397', '5432'),
    LANE.databaseUrl.replace('r27-local-only', 'another-password'),
    LANE.databaseUrl.replace('hsm_r27_perf', 'production'),
  ])
    assert.throws(() => assertLaneDatabase(url), /refusing/);
});

test('environment overrides cannot redirect fixtures or weaken policy', () => {
  for (const [key, value] of Object.entries({
    DATABASE_URL: 'postgresql://peer/working',
    PORT: '4010',
    REDIS_HOST: 'peer',
    WORK_ACCESS_ENFORCED: 'false',
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'false',
    NODE_OPTIONS: '--require=untrusted.cjs',
  }))
    assert.throws(() => apiEnv({ overrides: { [key]: value } }), /not allowed/);
  assert.equal(apiEnv({ overrides: { LOG_LEVEL: 'warn' } }).LOG_LEVEL, 'warn');
  assert.equal(apiEnv().PORT, '4327');
  assert.equal(apiEnv().DATABASE_URL, LANE.databaseUrl);
  assert.equal(apiEnv({ profile: 'production' }).COOKIE_SECURE, 'true');
  assert.equal(apiEnv({ profile: 'production' }).GLOBAL_THROTTLE_LIMIT, undefined);
});

test('port probe refuses a silent non-HTTP listener without connecting or killing it', async () => {
  const listener = createServer(() =>
    assert.fail('probe must not send traffic to another process'),
  );
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const url = 'http://127.0.0.1:' + listener.address().port;
  try {
    assert.equal(await portBusy(url), true);
    assert.equal(listener.listening, true);
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
  assert.equal(await portBusy(url), false);
  await assert.rejects(portBusy('http://example.test:4327'), /loopback/);
});

function container() {
  return {
    Name: '/hsm-r27-perf-postgres',
    State: { Running: true },
    Mounts: [],
    Config: {
      Labels: {
        'com.docker.compose.project': 'hsm-r27-perf',
        'com.docker.compose.service': 'postgres',
        'hsm.r27.disposable': 'true',
      },
      Env: ['POSTGRES_USER=r27', 'POSTGRES_DB=hsm_r27_perf'],
    },
    HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54397' }] } },
  };
}

test('a matching container name alone cannot authorize destructive fixture operations', () => {
  assert.doesNotThrow(() => verifyLaneContainer('postgres', container()));
  for (const change of [
    (c) => {
      c.Config.Labels['com.docker.compose.project'] = 'peer';
    },
    (c) => {
      delete c.Config.Labels['hsm.r27.disposable'];
    },
    (c) => {
      c.Config.Env = ['POSTGRES_USER=owner', 'POSTGRES_DB=working'];
    },
    (c) => {
      c.HostConfig.PortBindings['5432/tcp'][0].HostIp = '0.0.0.0';
    },
    (c) => {
      c.Mounts.push({ Type: 'bind', Source: '/working-data' });
    },
    (c) => {
      c.State.Running = false;
    },
  ]) {
    const value = container();
    change(value);
    assert.throws(() => verifyLaneContainer('postgres', value), /refusing/);
  }
});

for (const mode of ['existing-environment', 'wrong-container']) {
  test('reset refuses ' + mode + ' before dropdb/createdb/seed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'r27-reset-negative-'));
    try {
      const scriptDir = join(dir, 'scripts/perf/post-r18');
      mkdirSync(join(scriptDir, 'lib'), { recursive: true });
      cpSync(new URL('../lane-db-reset.sh', import.meta.url), join(scriptDir, 'lane-db-reset.sh'));
      cpSync(new URL('./lane-env.mjs', import.meta.url), join(scriptDir, 'lib/lane-env.mjs'));
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      const log = join(dir, 'calls');
      writeFileSync(
        join(bin, 'docker'),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$R27_TEST_CALLS"\nprintf "[{}]\\n"\n',
        { mode: 0o755 },
      );
      if (mode === 'existing-environment')
        writeFileSync(join(dir, '.env'), 'DATABASE_URL=postgresql://peer/working\n');
      const run = spawnSync('bash', [join(scriptDir, 'lane-db-reset.sh')], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: bin + ':' + process.env.PATH, R27_TEST_CALLS: log },
      });
      assert.notEqual(run.status, 0);
      assert.match(
        run.stderr,
        mode === 'existing-environment' ? /fresh worktree/ : /refusing unverified/,
      );
      let calls = '';
      try {
        calls = readFileSync(log, 'utf8');
      } catch {
        /* no call expected */
      }
      assert.doesNotMatch(calls, /exec|dropdb|createdb|seed/);
      if (mode === 'existing-environment') {
        assert.equal(calls, '');
        assert.equal(
          readFileSync(join(dir, '.env'), 'utf8'),
          'DATABASE_URL=postgresql://peer/working\n',
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// Docker/Redis are explicit contract doubles in these negative-control tests.
// Actual isolated Redis/browser execution is required separately by R27 CI.
for (const mode of [
  'valid',
  'empty',
  'wrong-container',
  'wrong-key',
  'not-hosted',
  'scan-failure',
]) {
  test('browser fixture throttle isolation: ' + mode, () => {
    const dir = mkdtempSync(join(tmpdir(), 'r27-browser-reset-'));
    try {
      const scriptDir = join(dir, 'scripts/perf/post-r18/lib');
      mkdirSync(scriptDir, { recursive: true });
      cpSync(new URL('./lane-env.mjs', import.meta.url), join(scriptDir, 'lane-env.mjs'));
      const redis = container();
      redis.Name = '/hsm-r27-perf-redis';
      redis.Config.Labels['com.docker.compose.service'] = 'redis';
      redis.HostConfig.PortBindings = {
        '6379/tcp': [{ HostIp: '127.0.0.1', HostPort: '63797' }],
      };
      if (mode === 'wrong-container') redis.Config.Labels['hsm.r27.disposable'] = 'false';
      const counter = 'rl:throttler:default:' + 'a'.repeat(64);
      const kept = ['session:keep', 'rl:auth:register:ip:keep', 'cache:keep'];
      const keys = [...kept];
      if (mode !== 'empty') keys.push(counter, counter + ':blocked');
      if (mode === 'wrong-key') keys.push('rl:throttler:default:unrecognised');
      const stateFile = join(dir, 'redis-state.json');
      writeFileSync(stateFile, JSON.stringify(keys));
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      const log = join(dir, 'calls.jsonl');
      writeFileSync(
        join(bin, 'docker'),
        `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.R27_TEST_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') {
  process.stdout.write(process.env.R27_TEST_CONTAINER);
} else if (args.includes('--scan')) {
  if (process.env.R27_TEST_MODE === 'scan-failure') process.exit(42);
  const keys = JSON.parse(fs.readFileSync(process.env.R27_TEST_STATE, 'utf8'));
  process.stdout.write(keys.filter(key => key.startsWith('rl:throttler:default:')).join('\\n') + '\\n');
} else if (args.includes('DEL')) {
  const keys = JSON.parse(fs.readFileSync(process.env.R27_TEST_STATE, 'utf8'));
  const deleted = new Set(args.slice(args.indexOf('DEL') + 1));
  const remaining = keys.filter(key => !deleted.has(key));
  fs.writeFileSync(process.env.R27_TEST_STATE, JSON.stringify(remaining));
  process.stdout.write(String(keys.length - remaining.length) + '\\n');
} else {
  process.exit(43);
}
`,
        { mode: 0o755 },
      );
      const run = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import { resetBrowserThrottleBuckets } from './scripts/perf/post-r18/lib/lane-env.mjs'; console.log(resetBrowserThrottleBuckets());",
        ],
        {
          cwd: dir,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: bin + ':' + process.env.PATH,
            GITHUB_ACTIONS: 'true',
            RUNNER_ENVIRONMENT: mode === 'not-hosted' ? 'self-hosted' : 'github-hosted',
            R27_TEST_CALLS: log,
            R27_TEST_CONTAINER: JSON.stringify([redis]),
            R27_TEST_STATE: stateFile,
            R27_TEST_MODE: mode,
          },
        },
      );
      let calls = [];
      try {
        calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      } catch {
        /* The non-hosted negative must not call Docker. */
      }
      const remaining = JSON.parse(readFileSync(stateFile, 'utf8'));
      assert.equal(
        calls.some((args) => args.includes('FLUSHDB') || args.includes('FLUSHALL')),
        false,
      );
      if (mode === 'valid' || mode === 'empty') {
        assert.equal(run.status, 0, run.stderr);
        assert.equal(Number(run.stdout.trim()), mode === 'valid' ? 2 : 0);
        assert.deepEqual(remaining, kept);
        assert.deepEqual(calls[0], ['inspect', 'hsm-r27-perf-redis']);
        assert.deepEqual(calls[1], [
          'exec',
          'hsm-r27-perf-redis',
          'redis-cli',
          '-e',
          '--raw',
          '--scan',
          '--pattern',
          'rl:throttler:default:*',
        ]);
      } else {
        assert.notEqual(run.status, 0);
        assert.deepEqual(remaining, keys, 'negative control must preserve every fixture key');
        assert.equal(
          calls.some((args) => args.includes('DEL')),
          false,
        );
        if (mode === 'not-hosted') assert.deepEqual(calls, []);
        if (mode === 'wrong-container') assert.equal(calls.length, 1);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
