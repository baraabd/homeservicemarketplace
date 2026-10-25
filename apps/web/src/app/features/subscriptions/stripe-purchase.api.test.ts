import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../lib/api';
import {
  createStripePurchase,
  startStripePurchase,
  resumeStripePurchase,
  stripePurchaseSession,
  stripePurchaseKeys,
} from './stripe-purchase.api';
let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => mock.restore());
describe('G3 purchase HTTP contract (explicit Axios double)', () => {
  it('sends server-priced intent selection only and preserves stable keys on retry', async () => {
    mock
      .onPost('/v1/money/intents')
      .reply(200, { id: 'intent', total: { amountMinor: '9223372036854775807', currency: 'XTS' } });
    await createStripePurchase('plan', 'same-key');
    await createStripePurchase('plan', 'same-key');
    for (const request of mock.history.post) {
      expect(JSON.parse(request.data)).toEqual({
        contractVersion: 'hsm.money.v1',
        planVersionId: 'plan',
        method: 'STRIPE',
      });
      expect(request.headers?.['Idempotency-Key']).toBe('same-key');
    }
  });
  it('continues the existing attempt for recovery and gets an ephemeral owner session', async () => {
    mock.onAny().reply(200, { status: 'ACCEPTED', resourceId: 'attempt' });
    await startStripePurchase('intent', 'start-key');
    await resumeStripePurchase('attempt', 'resume-key');
    await stripePurchaseSession('attempt');
    expect(mock.history.post.map((x) => x.url)).toEqual([
      '/v1/money/intents/intent/attempts',
      '/v1/money/attempts/attempt/resume',
    ]);
    expect(mock.history.get[0]?.url).toBe('/v1/money/stripe/attempts/attempt/session');
  });
});

it('retains only opaque idempotency identities across refresh and scopes them to the account/plan', () => {
  const first = stripePurchaseKeys('synthetic-owner', 'plan-a');
  expect(stripePurchaseKeys('synthetic-owner', 'plan-a')).toEqual(first);
  expect(stripePurchaseKeys('synthetic-other', 'plan-a')).not.toEqual(first);
  expect(stripePurchaseKeys('synthetic-owner', 'plan-b')).not.toEqual(first);
  expect(Object.keys(first).sort()).toEqual(['attempt', 'intent', 'resume']);
});
