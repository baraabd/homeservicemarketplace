import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../lib/api';
import {
  exportFinancialPage,
  financialErrorStatus,
  financialOperationsKeys,
  getFinancialDetail,
  getFinancialException,
  getFinancialReconciliation,
  getFinancialRecords,
  getFinancialSummary,
} from './financial-operations.api';

describe('financial read API transport (HTTP contract doubles)', () => {
  let mock: MockAdapter;
  beforeEach(() => {
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
  });
  it.each(['admin', 'provider'] as const)(
    'uses the authenticated %s scope without a client owner override',
    async (audience) => {
      const base = '/v1/money/' + (audience === 'admin' ? 'operations' : 'history');
      mock.onGet(base + '/records').reply(200, { items: [] });
      await getFinancialRecords(audience, {
        kind: 'ATTEMPT',
        currency: 'EUR',
        limit: 20,
        cursor: 'stable-cursor',
      });
      expect(mock.history.get[0].params).toEqual({
        kind: 'ATTEMPT',
        currency: 'EUR',
        limit: 20,
        cursor: 'stable-cursor',
      });
      expect(mock.history.get.every((request) => !request.params?.providerProfileId)).toBe(true);
    },
  );
  it('encodes untrusted path segments and sends the abort signal', async () => {
    const controller = new AbortController();
    mock.onGet('/v1/money/history/records/PAYMENT/id%2F%3F%23').reply(200, { record: {} });
    await getFinancialDetail('provider', 'PAYMENT', 'id/?#', controller.signal);
    expect(mock.history.get[0].signal).toBe(controller.signal);
  });
  it('keeps reconciliation behind the administrative read routes', async () => {
    mock
      .onGet('/v1/money/operations/reconciliation')
      .reply(200, { status: { state: 'UNAVAILABLE' } });
    mock
      .onGet('/v1/money/operations/reconciliation/exceptions/e%2F1')
      .reply(200, { exception: {} });
    await getFinancialReconciliation('cursor');
    await getFinancialException('e/1');
    expect(mock.history.get[0].params).toEqual({ limit: 20, cursor: 'cursor' });
    expect(mock.history.post).toHaveLength(0);
  });
  it('exports only the selected bounded page and keeps the server more-pages flag', async () => {
    mock
      .onGet('/v1/money/operations/export')
      .reply(200, 'id,currency\r\n1,EUR\r\n', { 'x-export-has-more': 'true' });
    expect(
      await exportFinancialPage({ kind: 'REFUND', limit: 20, currency: 'EUR', cursor: 'next' }),
    ).toEqual({
      csv: 'id,currency\r\n1,EUR\r\n',
      hasMore: true,
    });
    expect(mock.history.get[0].params).toEqual({
      kind: 'REFUND',
      limit: 20,
      currency: 'EUR',
      cursor: 'next',
    });
    expect(mock.history.get[0].responseType).toBe('text');
  });
  it('does not turn denied or failed reads into successful empty results', async () => {
    mock
      .onGet('/v1/money/operations/summary')
      .reply(403, { error: { message: 'private database detail' } });
    await expect(getFinancialSummary()).rejects.toMatchObject({
      response: { status: 403 },
    });
    mock.onGet('/v1/money/history/records').networkError();
    await expect(getFinancialRecords('provider', {})).rejects.toThrow();
  });
  it('scopes query identities by the authenticated actor and audience', () => {
    expect(financialOperationsKeys.actor('admin', 'one')).not.toEqual(
      financialOperationsKeys.actor('admin', 'two'),
    );
    expect(financialOperationsKeys.actor('admin', 'one')).not.toEqual(
      financialOperationsKeys.actor('provider', 'one'),
    );
    expect(financialErrorStatus({ response: { status: 403 } })).toBe(403);
    expect(financialErrorStatus({ response: 'private error' })).toBeUndefined();
  });
});
