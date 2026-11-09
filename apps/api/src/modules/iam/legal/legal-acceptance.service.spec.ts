import {
  CURRENT_LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KINDS,
  type LegalDocumentStatus,
} from '@homeservicemarketplace/contracts';
import type { AppConfigService } from '../../../config/app-config.service';
import { LegalAcceptanceService } from './legal-acceptance.service';

// A test-local registry allows approval scenarios without editing any policy.
jest.mock('@homeservicemarketplace/contracts', () => {
  const actual = jest.requireActual<typeof import('@homeservicemarketplace/contracts')>(
    '@homeservicemarketplace/contracts',
  );
  return { ...actual, CURRENT_LEGAL_DOCUMENTS: { ...actual.CURRENT_LEGAL_DOCUMENTS } };
});

const approvedVersions = {
  TERMS_OF_SERVICE: 'test-terms-v2',
  PRIVACY_NOTICE: 'test-privacy-v2',
};

function currentInput() {
  return {
    termsVersion: CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version,
    privacyVersion: CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version,
    locale: 'ar' as const,
  };
}

function service(nodeEnv: string, appEnv?: string, rehearsal?: boolean) {
  const values: Record<string, unknown> = {
    NODE_ENV: nodeEnv,
    APP_ENV: appEnv,
    LEGAL_DRAFT_ACCEPTANCE_ALLOWED: rehearsal,
  };
  return new LegalAcceptanceService({ get: (key: string) => values[key] } as AppConfigService);
}

function documents(status: LegalDocumentStatus, approvalReference: string | null) {
  for (const kind of LEGAL_DOCUMENT_KINDS) {
    jest.replaceProperty(CURRENT_LEGAL_DOCUMENTS, kind, {
      ...CURRENT_LEGAL_DOCUMENTS[kind],
      status,
      approvalReference,
      version: status === 'APPROVED' ? approvedVersions[kind] : `${approvedVersions[kind]}.draft-1`,
    });
  }
}

function expectGate(target: LegalAcceptanceService, open: boolean) {
  expect(target.documents().acceptanceOpen).toBe(open);
  if (open) expect(() => target.assertAcceptable(currentInput())).not.toThrow();
  else
    expect(() => target.assertAcceptable(currentInput())).toThrow(
      expect.objectContaining({
        status: 409,
        details: { reason: 'LEGAL_ACCEPTANCE_CLOSED' },
      }),
    );
}

afterEach(() => jest.restoreAllMocks());

describe('legal acceptance gate', () => {
  it.each([
    ['production', 'prod', undefined, false],
    ['production', 'prod', true, false],
    ['production', 'prod', false, false],
    ['production', undefined, true, false],
    ['production', 'dev', true, false],
    ['production', 'test', true, false],
    ['production', 'staging', undefined, false],
    ['production', 'staging', false, false],
    ['production', 'staging', true, true],
    ['staging', 'staging', undefined, false],
    ['staging', 'staging', false, false],
    ['staging', 'staging', true, true],
    ['development', 'prod', true, false],
    ['test', 'test', undefined, true],
    ['development', 'dev', undefined, true],
    ['development', 'dev', false, false],
  ] as const)('%s / %s with draft rehearsal %s opens: %s', (runtime, app, flag, open) => {
    documents('DRAFT', null);
    expectGate(service(runtime, app, flag), open);
  });

  it('opens registration for the current approved pair and rejects either stale version', () => {
    documents('APPROVED', 'fixture-approval');
    const target = service('production', 'prod', true);
    expectGate(target, true);
    for (const key of ['termsVersion', 'privacyVersion']) {
      expect(() => target.assertAcceptable({ ...currentInput(), [key]: 'test-old' })).toThrow(
        expect.objectContaining({
          status: 409,
          details: expect.objectContaining({ reason: 'LEGAL_VERSION_STALE' }),
        }),
      );
    }
  });

  it.each([null, '', '  '])('rejects an approved document with unusable reference %p', (ref) => {
    documents('APPROVED', 'fixture-approval');
    jest.replaceProperty(CURRENT_LEGAL_DOCUMENTS, 'PRIVACY_NOTICE', {
      ...CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE,
      approvalReference: ref,
    });
    expectGate(service('production', 'prod', true), false);
    expectGate(service('production', 'staging', true), false);
    expectGate(service('test', 'test', true), false);
  });

  it.each(['', '  ', 'test-privacy-v2.draft-1'])(
    'rejects an approved document without a non-draft release identifier %p',
    (version) => {
      documents('APPROVED', 'fixture-approval');
      jest.replaceProperty(CURRENT_LEGAL_DOCUMENTS, 'PRIVACY_NOTICE', {
        ...CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE,
        version,
      });
      expectGate(service('production', 'prod', true), false);
      expectGate(service('production', 'staging', true), false);
      expectGate(service('test', 'test', true), false);
    },
  );

  it.each(LEGAL_DOCUMENT_KINDS)('requires approval of %s in production', (kind) => {
    documents('APPROVED', 'fixture-approval');
    const target = service('production', 'prod', false);
    expectGate(target, true);
    jest.replaceProperty(CURRENT_LEGAL_DOCUMENTS, kind, {
      ...CURRENT_LEGAL_DOCUMENTS[kind],
      status: 'DRAFT',
      approvalReference: null,
    });
    expectGate(target, false);
  });
});
