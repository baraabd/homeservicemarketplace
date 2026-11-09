import {
  CURRENT_LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KINDS,
  type LegalDocumentStatus,
} from '@homeservicemarketplace/contracts';
import { AppConfigService } from '../../../config/app-config.service';
import { LegalAcceptanceService } from './legal-acceptance.service';

// A test-local registry allows approval scenarios without editing any policy.
jest.mock('@homeservicemarketplace/contracts', () => {
  const actual = jest.requireActual('@homeservicemarketplace/contracts');
  return { ...actual, CURRENT_LEGAL_DOCUMENTS: { ...actual.CURRENT_LEGAL_DOCUMENTS } };
});

const input = {
  termsVersion: CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version,
  privacyVersion: CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version,
  locale: 'ar' as const,
};

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
    });
  }
}

function expectGate(target: LegalAcceptanceService, open: boolean) {
  expect(target.documents().acceptanceOpen).toBe(open);
  if (open) expect(() => target.assertAcceptable(input)).not.toThrow();
  else
    expect(() => target.assertAcceptable(input)).toThrow(
      expect.objectContaining({
        status: 409,
        details: { reason: 'LEGAL_ACCEPTANCE_CLOSED' },
      }),
    );
}

afterEach(() => jest.restoreAllMocks());

describe('legal acceptance gate', () => {
  it.each([
    ['production', 'prod', true, false],
    ['production', undefined, true, false],
    ['production', 'dev', true, false],
    ['production', 'prod', false, false],
    ['production', 'staging', undefined, false],
    ['production', 'staging', true, true],
    ['staging', 'staging', false, false],
    ['test', 'test', undefined, true],
    ['development', 'dev', false, false],
  ] as const)('%s / %s with draft rehearsal %s opens: %s', (runtime, app, flag, open) => {
    documents('DRAFT', null);
    expectGate(service(runtime, app, flag), open);
  });

  it.each([null, '', '  '])('rejects an approved document with unusable reference %p', (ref) => {
    documents('APPROVED', 'fixture-approval');
    jest.replaceProperty(CURRENT_LEGAL_DOCUMENTS, 'PRIVACY_NOTICE', {
      ...CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE,
      approvalReference: ref,
    });
    expectGate(service('production', 'prod', true), false);
    expectGate(service('test', 'test', true), false);
  });

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
