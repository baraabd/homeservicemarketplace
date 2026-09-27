import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { baselineProblems, verifyBaseline } from './release-baseline.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = JSON.parse(await readFile(new URL('../../docs/production-readiness/r01/BASELINE.json', import.meta.url), 'utf8'));

test('R01-R10 baseline references existing source and test paths', async () => {
  assert.deepEqual(await verifyBaseline(root), []);
});
for (const [name, change] of Object.entries({
  'missing owner': (s) => { delete s.owners.migrations; },
  'missing blocker action': (s) => { s.sprints[5].action = ''; },
  'missing blocker evidence': (s) => { delete s.sprints[5].requiredEvidence; },
  'missing test reference': (s) => { s.sprints[5].tests = []; },
  'duplicate sprint': (s) => { s.sprints[1].id = 'R01'; },
  'future dependency': (s) => { s.sprints[0].dependencies = ['R10']; },
  'self dependency': (s) => { s.sprints[1].dependencies = ['R02']; },
  'unsafe reference': (s) => { s.sprints[0].source = ['../../elsewhere']; },
  'unassigned blocker': (s) => { s.sprints[2].owner = ''; },
  'unsupported completion claim': (s) => { s.sprints[0].status = 'COMPLETE'; },
  'duplicate reservation': (s) => { s.reservations.push(s.reservations[0]); },
  'unknown reservation owner': (s) => { s.reservations[0].role = 'unknown'; },
  'unknown reservation sprint': (s) => { s.reservations[0].serialOrder = ['R99']; },
  'silently certified protection': (s) => { s.protection.status = 'PASS'; },
})) {
  test(`baseline rejects ${name}`, () => {
    const value = structuredClone(baseline);
    change(value);
    assert.ok(baselineProblems(value).length);
  });
}
