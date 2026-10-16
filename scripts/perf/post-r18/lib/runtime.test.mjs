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
