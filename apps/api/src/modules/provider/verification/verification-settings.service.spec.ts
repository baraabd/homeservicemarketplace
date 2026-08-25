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
