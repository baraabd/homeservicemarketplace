'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const { test } = require('node:test');

async function startReceiver(t) {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, 'test-receiver.cjs'), String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const closed = once(child, 'exit');
    child.kill();
    await closed;
  });
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(() => {
      throw new Error('receiver exited before listening');
    }),
  ]);
  return `http://127.0.0.1:${port}`;
}

const payload = (status = 'firing') => ({
  receiver: 'test-page',
  status,
  alerts: [
    {
      status,
      labels: { alertname: 'ApiAvailabilityFastBurn', severity: 'page', private: 'discard-me' },
      startsAt: new Date().toISOString(),
      endsAt: new Date().toISOString(),
      annotations: {
        runbook_url: 'infra/production/observability/RUNBOOK.md#apiavailabilityfastburn',
        summary: 'discard-me',
      },
    },
  ],
});
const post = (url, body) =>
  fetch(`${url}/alerts/page`, { method: 'POST', body: JSON.stringify(body) });

test('receiver records firing and resolved delivery with only evidence fields', async (t) => {
  const url = await startReceiver(t);
  assert.equal((await post(url, payload())).status, 200);
  assert.equal((await post(url, payload('resolved'))).status, 200);
  const records = await (await fetch(`${url}/notifications`)).json();
  assert.deepEqual(
    records.map((r) => r.status),
    ['firing', 'resolved'],
  );
  assert.equal(records[0].path, '/alerts/page');
  assert.equal(records[0].alerts[0].labels.alertname, 'ApiAvailabilityFastBurn');
  assert.equal(JSON.stringify(records).includes('discard-me'), false);
});

test('malformed, oversized and unexpected webhooks fail without crashing or recording', async (t) => {
  const url = await startReceiver(t);
  for (const value of [
    null,
    [],
    {},
    { ...payload(), alerts: {} },
    { ...payload(), alerts: [null] },
    { ...payload(), receiver: 'wrong' },
    { ...payload(), status: 'unknown' },
  ]) {
    assert.equal((await post(url, value)).status, 400);
  }
  assert.equal((await fetch(`${url}/alerts/page`, { method: 'POST', body: '{' })).status, 400);
  assert.equal(
    (await fetch(`${url}/alerts/page`, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }))
      .status,
    413,
  );
  assert.equal((await fetch(`${url}/alerts/other`, { method: 'POST', body: '{}' })).status, 404);
  assert.deepEqual(await (await fetch(`${url}/notifications`)).json(), []);
  assert.equal((await post(url, payload())).status, 200);
});

test('receiver refuses further notifications at its bounded capacity', async (t) => {
  const url = await startReceiver(t);
  for (let i = 0; i < 256; i += 1) assert.equal((await post(url, payload())).status, 200);
  assert.equal((await post(url, payload())).status, 503);
  assert.equal((await (await fetch(`${url}/notifications`)).json()).length, 256);
});
