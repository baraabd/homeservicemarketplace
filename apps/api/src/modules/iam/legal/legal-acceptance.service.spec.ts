import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';
import type { AppConfigService } from '../../../config/app-config.service';
import { LegalAcceptanceService } from './legal-acceptance.service';

// This suite can exercise a future approved pair without changing the release registry.
jest.mock('@homeservicemarketplace/contracts', () => {
  const actual = jest.requireActual<typeof import('@homeservicemarketplace/contracts')>(
    '@homeservicemarketplace/contracts',
  );
  return {
    ...actual,
    CURRENT_LEGAL_DOCUMENTS: {
      TERMS_OF_SERVICE: { ...actual.CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE },
      PRIVACY_NOTICE: { ...actual.CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE },
    },
  };
});

const { TERMS_OF_SERVICE: terms, PRIVACY_NOTICE: privacy } = CURRENT_LEGAL_DOCUMENTS;
const input = {
  termsVersion: 'test-terms-v2',
  privacyVersion: 'test-privacy-v2',
  locale: 'ar' as const,
};
const settings: Record<string, unknown> = {
  NODE_ENV: 'production',
  LEGAL_DRAFT_ACCEPTANCE_ALLOWED: true,
};
const production = new LegalAcceptanceService({
  get: (key: string) => settings[key],
} as AppConfigService);

beforeEach(() => {
  Object.assign(terms, {
    status: 'APPROVED',
    version: input.termsVersion,
    approvalReference: 'test-terms-decision',
  });
  Object.assign(privacy, {
    status: 'APPROVED',
    version: input.privacyVersion,
    approvalReference: 'test-privacy-decision',
  });
});

it('opens registration for the current approved pair only', () => {
  expect(production.documents().acceptanceOpen).toBe(true);
  expect(() => production.assertAcceptable(input)).not.toThrow();
  for (const key of ['termsVersion', 'privacyVersion']) {
    expect(() => production.assertAcceptable({ ...input, [key]: 'test-old' })).toThrow(
      expect.objectContaining({
        status: 409,
        details: expect.objectContaining({ reason: 'LEGAL_VERSION_STALE' }),
      }),
    );
  }
});

it.each([{ status: 'DRAFT' }, { approvalReference: null }, { approvalReference: '  ' }])(
  'closes both the public status and signup when one approval is incomplete',
  (override) => {
    Object.assign(privacy, override);
    expect(production.documents().acceptanceOpen).toBe(false);
    expect(() => production.assertAcceptable(input)).toThrow(
      expect.objectContaining({ status: 409, details: { reason: 'LEGAL_ACCEPTANCE_CLOSED' } }),
    );
  },
);
