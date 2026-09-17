import { retentionWorkerConfig } from './retention-worker.config';
const base = {
  DATABASE_URL: 'postgresql://localhost/test',
  RESTRICTED_STORAGE_DIR: '/tmp/test-restricted',
};
it('defaults closed and needs neither JWT nor public media credentials', () => {
  expect(retentionWorkerConfig(base).EVIDENCE_RETENTION_MODE).toBe('off');
});
it('allows read-only shadow without asserting approval', () => {
  const c = retentionWorkerConfig({ ...base, EVIDENCE_RETENTION_MODE: 'shadow' });
  expect(c.policy.approvalReference).toBe('UNAPPROVED.SHADOW');
});
it('cannot enforce without separate policy and infrastructure signoff references', () => {
  expect(() => retentionWorkerConfig({ ...base, EVIDENCE_RETENTION_MODE: 'enforce' })).toThrow();
  expect(() =>
    retentionWorkerConfig({
      ...base,
      EVIDENCE_RETENTION_MODE: 'enforce',
      EVIDENCE_RETENTION_APPROVAL_REF: 'PRIVACY.12',
      EVIDENCE_RETENTION_INFRA_REF: 'STORAGE.12',
    }),
  ).not.toThrow();
});
it.each([
  { NODE_ENV: 'production', EVIDENCE_RETENTION_MODE: 'shadow' },
  { EVIDENCE_RETENTION_MODE: 'shadow', STORAGE_DRIVER: 's3' },
  { EVIDENCE_RETENTION_MODE: 'shadow', RESTRICTED_STORAGE_DIR: '../public' },
  { EVIDENCE_RETENTION_BATCH: '100000' },
  { EVIDENCE_RETENTION_MODE: 'true' },
  { S3_ACCESS_KEY_ID: 'placeholder', EVIDENCE_RETENTION_MODE: 'shadow' },
])('refuses unsafe configuration without echoing values %#', (patch) => {
  expect(() => retentionWorkerConfig({ ...base, ...patch })).toThrow(/retention-worker/);
});
