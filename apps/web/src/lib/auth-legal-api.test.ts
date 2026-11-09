import MockAdapter from 'axios-mock-adapter';
import { afterEach, describe, expect, it } from 'vitest';
import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';
import { api } from './api';
import { getLegalDocuments } from './auth-api';

const mock = new MockAdapter(api);
afterEach(() => mock.reset());

describe('public legal document response', () => {
  it('preserves the server versions and closed acceptance state', async () => {
    const response = {
      documents: Object.values(CURRENT_LEGAL_DOCUMENTS),
      acceptanceOpen: false,
    };
    mock.onGet('/v1/legal/documents').reply(200, response);
    await expect(getLegalDocuments()).resolves.toEqual(response);
  });

  it.each([
    null,
    '<html>old deployment</html>',
    { items: [] },
    { documents: [CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE], acceptanceOpen: true },
    { documents: Array(2).fill(CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE), acceptanceOpen: true },
    {
      documents: [null],
      acceptanceOpen: true,
    },
  ])('rejects malformed data so signup can render its retry state: %j', async (response) => {
    mock.onGet('/v1/legal/documents').reply(200, response);
    await expect(getLegalDocuments()).rejects.toThrow('Legal policy information is unavailable');
  });
});
