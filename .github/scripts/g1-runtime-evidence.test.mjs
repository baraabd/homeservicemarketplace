import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ci = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
test('G1 required CI jobs run previously omitted real-service scenarios', () => {
  const integration = ci.slice(ci.indexOf('  integration-e2e:'), ci.indexOf('  browser-e2e:'));
  const storage = ci.slice(ci.indexOf('  evidence-retention:'), ci.indexOf('  dispute-workspace:'));
  for (const key of ['R21_MAILPIT_SMTP_PORT', 'R21_MAILPIT_API_URL', 'RUN_R22_WORKER_PROCESS'])
    assert.ok(integration.includes(key), key);
  assert.ok(
    integration.indexOf('name: Build API for independent') <
      integration.indexOf('--testPathPatterns=r22-outbox-process'),
  );
  for (const key of [
    'RUN_R20_STORAGE_INTEGRATION',
    'R20_MC',
    '--testPathPatterns=r20-storage',
    'if-no-files-found: error',
  ])
    assert.ok(storage.includes(key), key);
});
test('G1 changes do not declare the wave accepted before owner publication', () => {
  const gate = JSON.parse(
    readFileSync(
      new URL(
        '../../docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json',
        import.meta.url,
      ),
    ),
  );
  if (gate.decision === 'BLOCKED') assert.equal(gate.frozenBaseSha, null);
});
