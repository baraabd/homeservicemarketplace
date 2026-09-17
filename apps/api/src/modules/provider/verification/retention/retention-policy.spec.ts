import {
  planRetention,
  policyVersion,
  retentionPolicySchema,
  retryAt,
  type RetentionFacts,
} from './retention-policy';
const policy = retentionPolicySchema.parse({
  format: 1,
  approvalReference: 'test-review',
  verifiedDays: 90,
  rejectedDays: 30,
  abandonedDays: 30,
  quarantineDays: 180,
  maxAttempts: 3,
});
const now = new Date('2026-09-17T00:00:00Z');
const facts: RetentionFacts = {
  assetId: 'asset',
  visibility: 'RESTRICTED',
  completedAt: new Date('2026-01-01Z'),
  deletedAt: null,
  caseId: 'case',
  documentCaseId: 'case',
  caseState: 'VERIFIED',
  casePolicyVersion: 'kyc.v1',
  lastActivityAt: new Date('2026-01-02Z'),
  decidedAt: new Date('2026-01-03Z'),
  scanState: 'CLEAN',
  scannedAt: new Date('2026-01-02Z'),
};
it('pins the whole policy, basis and canonical case into a stable intent', () => {
  const a = planRetention(facts, policy, now)!;
  expect(a.dueAt).toEqual(new Date('2026-04-03Z'));
  expect(planRetention({ ...facts }, { ...policy }, now)).toEqual(a);
  expect(policyVersion({ ...policy, verifiedDays: 91 })).not.toBe(a.policyVersion);
  expect(planRetention({ ...facts, casePolicyVersion: 'kyc.v2' }, policy, now)?.intentKey).not.toBe(
    a.intentKey,
  );
});
it.each(['SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED', 'UNKNOWN'])(
  'never expires live/unrecognized case %s',
  (caseState) => {
    expect(planRetention({ ...facts, caseState }, policy, now)).toBeNull();
  },
);
it.each([
  { completedAt: null },
  { deletedAt: now },
  { visibility: 'PUBLIC' },
  { documentCaseId: 'different' },
  { casePolicyVersion: null },
  { decidedAt: null },
  { decidedAt: new Date('2027-01-01Z') },
  { decidedAt: new Date('2025-01-01Z') },
  { decidedAt: new Date('invalid') },
])('fails closed for incomplete, contradictory or future facts %#', (patch) => {
  expect(planRetention({ ...facts, ...patch }, policy, now)).toBeNull();
});
it('does not invent a decision date for an expired case', () => {
  expect(
    planRetention({ ...facts, caseState: 'EXPIRED', decidedAt: null }, policy, now),
  ).toBeNull();
});
it('quarantine lengthens ordinary retention without changing a malware finding', () => {
  const p = planRetention({ ...facts, scanState: 'QUARANTINED' }, policy, now)!;
  expect(p.dueAt).toEqual(new Date('2026-07-01Z'));
  expect(
    planRetention({ ...facts, scanState: 'QUARANTINED', scannedAt: null }, policy, now),
  ).toBeNull();
});
it('draft abandonment is anchored to observed activity', () => {
  expect(planRetention({ ...facts, caseState: 'DRAFT' }, policy, now)?.dueAt).toEqual(
    new Date('2026-02-01Z'),
  );
});
it('rejects bad policy and bounds retry backoff', () => {
  expect(() => policyVersion({ ...policy, maxAttempts: 0 })).toThrow();
  expect(retryAt(1, now).getTime() - now.getTime()).toBe(30_000);
  expect(retryAt(20, now).getTime() - now.getTime()).toBe(3_600_000);
  expect(() => retryAt(0, now)).toThrow();
});
