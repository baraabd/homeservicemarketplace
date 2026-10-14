'use strict';
// R22 — the replay CLI's own logic (argument handling and the two-step
// confirmation). The service it wraps is covered against real Postgres by
// apps/api/test/integration/r22-outbox-replay.integration.spec.ts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, run, UsageError } = require('./outbox-replay.cjs');

const base = ['--operator', 'op_1', '--reason', 'INC-1 vendor recovered', '--event-type', 'x.y'];

function fakeService(counts) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async replay(req) {
      calls.push(req);
      const n = counts[Math.min(i++, counts.length - 1)];
      const candidates = Array.from({ length: n }, (_, k) => ({
        id: `e${k}`,
        eventType: 'x.y',
        aggregateType: 'A',
        aggregateId: 'a',
        attempts: 8,
        deadSince: new Date(0),
        lastErrorSummary: 'Error: down',
      }));
      return {
        dryRun: req.dryRun,
        candidates,
        replayedIds: req.dryRun ? [] : candidates.map((c) => c.id),
        auditEventId: req.dryRun ? null : 'oxr_1',
      };
    },
  };
}

test('defaults to a dry-run and never writes', async () => {
  const service = fakeService([3]);
  const { exitCode, output } = await run(base, { service });
  assert.equal(exitCode, 0);
  assert.equal(output.dryRun, true);
  assert.equal(output.matched, 3);
  assert.deepEqual(
    service.calls.map((c) => c.dryRun),
    [true],
  );
});

test('--execute requires a confirmation count', () => {
  assert.throws(() => parseArgs([...base, '--execute']), UsageError);
  assert.throws(() => parseArgs([...base, '--confirm-count', '3']), UsageError);
});

test('executes only when the reviewed count still matches', async () => {
  const service = fakeService([3, 3]);
  const { exitCode, output } = await run([...base, '--execute', '--confirm-count', '3'], {
    service,
  });
  assert.equal(exitCode, 0);
  assert.equal(output.replayed, 3);
  assert.deepEqual(
    service.calls.map((c) => c.dryRun),
    [true, false],
  );
});

test('aborts when the scope grew since review', async () => {
  const service = fakeService([5]);
  const { exitCode, output } = await run([...base, '--execute', '--confirm-count', '3'], {
    service,
  });
  assert.equal(exitCode, 2);
  assert.equal(output.refused, 'confirmation-mismatch');
  assert.deepEqual(
    service.calls.map((c) => c.dryRun),
    [true],
  );
});

test('requires operator and reason, rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--reason', 'x', '--event-type', 't']), /--operator/);
  assert.throws(() => parseArgs(['--operator', 'o', '--event-type', 't']), /--reason/);
  assert.throws(() => parseArgs([...base, '--force']), /unknown argument --force/);
  assert.throws(() => parseArgs([...base, '--limit']), /needs a value/);
});

test('passes repeated event ids and the aggregate scope through', () => {
  const args = parseArgs([
    '--operator',
    'o',
    '--reason',
    'INC-2 replay two',
    '--event-id',
    'a',
    '--event-id',
    'b',
    '--aggregate-type',
    'Booking',
    '--aggregate-id',
    'bk',
  ]);
  assert.deepEqual(args.eventIds, ['a', 'b']);
  assert.equal(args.aggregateType, 'Booking');
  assert.equal(args.aggregateId, 'bk');
});
