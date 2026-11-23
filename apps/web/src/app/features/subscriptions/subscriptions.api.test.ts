import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../lib/api';
import {
  getMyPlan,
  getPlanCatalog,
  getSubscriptionPage,
  subscriptionQueryKeys,
} from './subscriptions.api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

describe('subscription reads through the authenticated API client', () => {
  it('passes only the selected subscription, with cancellation, and preserves server data', async () => {
    const signal = new AbortController().signal;
    const view = {
      contractVersion: 'hsm.money.v1',
      status: 'ACTIVE',
      payment: { status: 'PROCESSING', latestAttemptStatus: 'FAILED' },
    };
    mock.onGet('/v1/money/my-plan').reply(200, view);
    expect(await getMyPlan('owned-subscription', signal)).toEqual(view);
    expect(mock.history.get[0].params).toEqual({ subscriptionId: 'owned-subscription' });
    expect(mock.history.get[0].signal).toBe(signal);
    expect(mock.history.post).toHaveLength(0);
  });

  it('leaves default selection to the server and does not turn a redirect into a command', async () => {
    mock.onGet('/v1/money/my-plan').reply(200, { status: 'NONE' });
    await getMyPlan();
    expect(mock.history.get[0].params).toBeUndefined();
    expect(mock.history.post).toHaveLength(0);
  });

  it('uses bounded cursor pages for purchases and preserves exact catalog money strings', async () => {
    mock.onGet('/v1/money/subscriptions').reply(200, { items: [], nextCursor: 'next-owned-page' });
    mock.onGet('/v1/money/plans').reply(200, {
      contractVersion: 'hsm.money.v1',
      items: [{ price: { amountMinor: '9223372036854775807', currency: 'XXX' } }],
      nextCursor: null,
    });
    const signal = new AbortController().signal;
    await getSubscriptionPage('owned-cursor', signal);
    const plans = await getPlanCatalog('catalog-cursor', signal);
    expect(mock.history.get.map((request) => request.params)).toEqual([
      { limit: 20, cursor: 'owned-cursor' },
      { limit: 20, cursor: 'catalog-cursor' },
    ]);
    expect(plans.items[0].price.amountMinor).toBe('9223372036854775807');
    expect(mock.history.get.every((request) => request.signal === signal)).toBe(true);
  });

  it('keeps account and selected subscription caches separate', () => {
    expect(subscriptionQueryKeys.myPlan('account-a')).not.toEqual(
      subscriptionQueryKeys.myPlan('account-b'),
    );
    expect(subscriptionQueryKeys.myPlan('account-a', 'purchase-a')).not.toEqual(
      subscriptionQueryKeys.myPlan('account-a', 'purchase-b'),
    );
    expect(subscriptionQueryKeys.purchases('account-a')).not.toEqual(
      subscriptionQueryKeys.purchases('account-b'),
    );
    expect(subscriptionQueryKeys.plans('account-a')).not.toEqual(
      subscriptionQueryKeys.plans('account-b'),
    );
  });
});
