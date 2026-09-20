import { randomBytes } from 'node:crypto';
import { WorkspaceCipher } from './workspace-cipher.service';
import type { AppConfigService } from '../../../config/app-config.service';
import { workspaceWorkerConfig } from './workspace-worker.config';
import { sanitizedRedactedPng } from './redacted-png';
function keys() {
  const values: Record<string, string> = {
    DISPUTE_PRIVATE_ACTIVE_KEY: 'first',
    DISPUTE_PRIVATE_KEYS_JSON: JSON.stringify({ first: randomBytes(32).toString('base64') }),
  };
  return {
    values,
    cipher: new WorkspaceCipher({ get: (key: string) => values[key] } as AppConfigService),
  };
}
describe('Private dispute data and worker configuration', () => {
  it('authenticates every envelope, rejects swaps/tampering and randomizes encryption', () => {
    const { cipher } = keys(),
      text = 'Private statement';
    const a = cipher.encode(text, 'case:one'),
      b = cipher.encode(text, 'case:one');
    expect(a).not.toBe(b);
    expect(cipher.decode(a, 'case:one')).toBe(text);
    expect(() => cipher.decode(a, 'case:two')).toThrow();
    const tampered = JSON.parse(a);
    tampered.t = randomBytes(16).toString('base64');
    expect(() => cipher.decode(JSON.stringify(tampered), 'case:one')).toThrow();
  });
  it('supports retained old keys while encrypting only under the active key', () => {
    const { cipher, values } = keys();
    const original = cipher.encode('text', 'context');
    const old = JSON.parse(values.DISPUTE_PRIVATE_KEYS_JSON);
    values.DISPUTE_PRIVATE_ACTIVE_KEY = 'second';
    values.DISPUTE_PRIVATE_KEYS_JSON = JSON.stringify({
      ...old,
      second: randomBytes(32).toString('base64'),
    });
    expect(cipher.decode(original, 'context')).toBe('text');
    expect(JSON.parse(cipher.encode('new', 'context')).k).toBe('second');
  });
  it('fails closed without leaking malformed configuration in an exception', () => {
    const { cipher, values } = keys();
    values.DISPUTE_PRIVATE_KEYS_JSON = 'private-invalid-input';
    expect(() => cipher.ready()).toThrow('Private case storage is unavailable.');
  });
  it('keeps the worker default off and forbids the test scanner outside test', () => {
    const base = { DATABASE_URL: 'postgresql://localhost/test' };
    expect(workspaceWorkerConfig(base).DISPUTE_WORKER_MODE).toBe('off');
    expect(() =>
      workspaceWorkerConfig({
        ...base,
        NODE_ENV: 'production',
        DISPUTE_WORKER_MODE: 'enforce',
        METRICS_TOKEN: randomBytes(32).toString('hex'),
        DISPUTE_WORKER_APPROVAL_REF: 'test-reference',
        DISPUTE_WORKER_INFRA_REF: 'test-inventory',
        EVIDENCE_SCANNER_DRIVER: 'test',
      }),
    ).toThrow('real-scanner-required');
  });
  it('refuses PDFs and malformed rasters as supposedly redacted derivatives', () => {
    expect(() => sanitizedRedactedPng(Buffer.from('%PDF-1.4 hidden layers'))).toThrow();
    expect(() => sanitizedRedactedPng(Buffer.from('89504e470d0a1a0a', 'hex'))).toThrow();
  });
});
