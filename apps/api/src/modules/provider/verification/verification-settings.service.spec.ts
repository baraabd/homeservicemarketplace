import { ADMIN_SETTINGS_SCHEMA } from '@homeservicemarketplace/contracts';

import {
  VERIFICATION_POLICY_MAX_DOCUMENTS_KEY,
  VerificationSettingsService,
} from './verification-settings.service';

// Sprint 9B.2 — verification limits come from the canonical settings
// mechanism, not from a constant and not from a second config system.
//
// The whole value of this class is that it is thin: it reads the same
// PlatformSetting row the admin screen writes, and falls back to the same
// ADMIN_SETTINGS_SCHEMA default the admin screen shows as the default. Anything
// cleverer — a cache, a local default, a parallel table — would let the number
// the service enforces drift from the number an admin was told they set.

const schemaDefault = ADMIN_SETTINGS_SCHEMA.find(
  (f) => f.key === VERIFICATION_POLICY_MAX_DOCUMENTS_KEY,
)?.default as number;

function build(row: { key: string; value: unknown } | null) {
  const findByKey = jest.fn().mockResolvedValue(row);
  const service = new VerificationSettingsService({ findByKey } as never);
  return { service, findByKey };
}

describe('the key is declared in the canonical schema', () => {
  it('exists in ADMIN_SETTINGS_SCHEMA', () => {
    // If it were not, the admin screen could never set it and the "default"
    // below would be a local invention.
    const field = ADMIN_SETTINGS_SCHEMA.find(
      (f) => f.key === VERIFICATION_POLICY_MAX_DOCUMENTS_KEY,
    );
    expect(field).toBeDefined();
    expect(field?.type).toBe('integer');
  });

  it('declares an explicit, documented default', () => {
    expect(typeof schemaDefault).toBe('number');
    expect(schemaDefault).toBeGreaterThan(0);
  });

  it('declares bounds that make a verifying policy publishable', () => {
    // min 0 would make every policy that requires verification unpublishable,
    // because a verifying policy must name at least one document.
    const field = ADMIN_SETTINGS_SCHEMA.find(
      (f) => f.key === VERIFICATION_POLICY_MAX_DOCUMENTS_KEY,
    );
    expect(field?.min).toBeGreaterThanOrEqual(1);
    expect(field?.max).toBeGreaterThanOrEqual(field?.min as number);
  });
});

describe('a configured value is used', () => {
  it('returns the stored number', async () => {
    const { service } = build({ key: VERIFICATION_POLICY_MAX_DOCUMENTS_KEY, value: 3 });
    await expect(service.policyMaxDocuments()).resolves.toBe(3);
  });

  it('reads the canonical key', async () => {
    const { service, findByKey } = build({
      key: VERIFICATION_POLICY_MAX_DOCUMENTS_KEY,
      value: 3,
    });
    await service.policyMaxDocuments();
    expect(findByKey).toHaveBeenCalledWith(VERIFICATION_POLICY_MAX_DOCUMENTS_KEY, undefined);
  });

  it('passes a transaction through so a read joins the caller-s transaction', async () => {
    const { service, findByKey } = build({
      key: VERIFICATION_POLICY_MAX_DOCUMENTS_KEY,
      value: 3,
    });
    const tx = {} as never;
    await service.policyMaxDocuments(tx);
    expect(findByKey).toHaveBeenCalledWith(VERIFICATION_POLICY_MAX_DOCUMENTS_KEY, tx);
  });

  it('does not cache between calls', async () => {
    // No cache means no invalidation bug: an admin change takes effect on the
    // next read. If a cache is ever added it needs an invalidation story, and
    // this test is where that decision gets made deliberately.
    const { service, findByKey } = build({
      key: VERIFICATION_POLICY_MAX_DOCUMENTS_KEY,
      value: 3,
    });
    await service.policyMaxDocuments();
    await service.policyMaxDocuments();
    expect(findByKey).toHaveBeenCalledTimes(2);
  });
});

describe('an absent or unusable row falls back to the schema default', () => {
  it('falls back when the row does not exist', async () => {
    const { service } = build(null);
    await expect(service.policyMaxDocuments()).resolves.toBe(schemaDefault);
  });

  it.each([
    ['a string', '5'],
    ['null', null],
    ['a boolean', true],
    ['an object', { value: 5 }],
    ['an array', [5]],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a fraction', 2.5],
  ])('falls back when the stored value is %s', async (_label, value) => {
    const { service } = build({ key: VERIFICATION_POLICY_MAX_DOCUMENTS_KEY, value });
    await expect(service.policyMaxDocuments()).resolves.toBe(schemaDefault);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('falls back when the stored value is %s', async (_label, value) => {
    // The admin path rejects these via the schema min, so a row like this means
    // the value was written by something that bypassed validation. Honouring it
    // would make every verifying policy unpublishable.
    const { service } = build({ key: VERIFICATION_POLICY_MAX_DOCUMENTS_KEY, value });
    await expect(service.policyMaxDocuments()).resolves.toBe(schemaDefault);
  });

  it('clamps a value above the declared maximum rather than honouring it', async () => {
    // Same reasoning in the other direction: out-of-band writes must not widen
    // a ceiling past what the schema says is reviewable.
    const field = ADMIN_SETTINGS_SCHEMA.find(
      (f) => f.key === VERIFICATION_POLICY_MAX_DOCUMENTS_KEY,
    );
    const { service } = build({
      key: VERIFICATION_POLICY_MAX_DOCUMENTS_KEY,
      value: (field?.max as number) + 500,
    });
    await expect(service.policyMaxDocuments()).resolves.toBe(field?.max);
  });

  it('survives a repository failure by using the default', async () => {
    // A settings outage must not stop an admin publishing a policy. The value
    // can only REFUSE a publish, so falling back is the safe direction.
    const findByKey = jest.fn().mockRejectedValue(new Error('db down'));
    const service = new VerificationSettingsService({ findByKey } as never);
    await expect(service.policyMaxDocuments()).resolves.toBe(schemaDefault);
  });
});

// ── Sprint 9B.3 — evidence upload limits ──────────────────────────────────

import {
  EVIDENCE_MAX_BYTES_KEY,
  EVIDENCE_MAX_DOCUMENTS_PER_CASE_KEY,
  EVIDENCE_UPLOAD_TTL_SECONDS_KEY,
} from './verification-settings.service';

const EVIDENCE_KEYS = [
  EVIDENCE_MAX_BYTES_KEY,
  EVIDENCE_MAX_DOCUMENTS_PER_CASE_KEY,
  EVIDENCE_UPLOAD_TTL_SECONDS_KEY,
];

function buildByKey(rows: Record<string, unknown>) {
  const findByKey = jest.fn(async (key: string) =>
    key in rows ? { key, value: rows[key] } : null,
  );
  return { service: new VerificationSettingsService({ findByKey } as never), findByKey };
}

describe('evidence limits come from the canonical schema', () => {
  it.each(EVIDENCE_KEYS)('%s is declared with bounds and a default', (key) => {
    const field = ADMIN_SETTINGS_SCHEMA.find((f) => f.key === key);
    expect(field).toBeDefined();
    expect(field?.type).toBe('integer');
    expect(typeof field?.default).toBe('number');
    expect(field?.min).toBeGreaterThan(0);
    expect(field?.max).toBeGreaterThanOrEqual(field?.min as number);
  });

  it('resolves all three together', async () => {
    // Values chosen INSIDE the declared bounds. 1 KiB would be below the 64 KiB
    // minimum and would correctly fall back — which is a different test.
    const { service } = buildByKey({
      [EVIDENCE_MAX_BYTES_KEY]: 128 * 1024,
      [EVIDENCE_MAX_DOCUMENTS_PER_CASE_KEY]: 3,
      [EVIDENCE_UPLOAD_TTL_SECONDS_KEY]: 120,
    });
    await expect(service.evidenceLimits()).resolves.toEqual({
      maxBytes: 128 * 1024,
      maxDocumentsPerCase: 3,
      uploadTtlSeconds: 120,
    });
  });

  it('falls back per key, so one bad row does not poison the others', async () => {
    // A partially-resolved limit set is the dangerous outcome: a service that
    // silently lost the count ceiling would enforce half the policy.
    const { service } = buildByKey({
      [EVIDENCE_MAX_BYTES_KEY]: 'not a number',
      [EVIDENCE_MAX_DOCUMENTS_PER_CASE_KEY]: 3,
    });
    const limits = await service.evidenceLimits();
    const defaultBytes = ADMIN_SETTINGS_SCHEMA.find((f) => f.key === EVIDENCE_MAX_BYTES_KEY)
      ?.default as number;
    const defaultTtl = ADMIN_SETTINGS_SCHEMA.find((f) => f.key === EVIDENCE_UPLOAD_TTL_SECONDS_KEY)
      ?.default as number;
    expect(limits.maxBytes).toBe(defaultBytes);
    expect(limits.maxDocumentsPerCase).toBe(3);
    expect(limits.uploadTtlSeconds).toBe(defaultTtl);
  });

  it('clamps an out-of-band oversized ceiling to the declared maximum', async () => {
    // An upload ceiling written past the schema max would widen the attack
    // surface every parser and scanner downstream has to handle.
    const max = ADMIN_SETTINGS_SCHEMA.find((f) => f.key === EVIDENCE_MAX_BYTES_KEY)?.max as number;
    const { service } = buildByKey({ [EVIDENCE_MAX_BYTES_KEY]: max * 10 });
    await expect(service.evidenceLimits()).resolves.toMatchObject({ maxBytes: max });
  });

  it('rejects a zero or negative ceiling in favour of the default', async () => {
    const def = ADMIN_SETTINGS_SCHEMA.find((f) => f.key === EVIDENCE_MAX_BYTES_KEY)
      ?.default as number;
    for (const bad of [0, -1]) {
      const { service } = buildByKey({ [EVIDENCE_MAX_BYTES_KEY]: bad });
      await expect(service.evidenceLimits()).resolves.toMatchObject({ maxBytes: def });
    }
  });
});
