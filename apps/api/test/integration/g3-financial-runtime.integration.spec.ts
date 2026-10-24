import { r24MoneyHttpFixture, type R24MoneyHttpFixture } from '../support/r24-money-http.fixture';
import {
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
} from '../../src/modules/money/ports/collection.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_CONFIRMATION_PARTICIPANT,
} from '../../src/modules/money/ports/refund.port';
import { REFUND_POLICY_SOURCE } from '../../src/modules/money/refunds/refund-eligibility.policy';
import {
  MoneyCollectionRouter,
  MoneyRailConfiguration,
  MoneyRefundRouter,
} from '../../src/modules/money/runtime/money-rail-router';
import { ApprovedRefundParticipant } from '../../src/modules/money/runtime/approved-refund.participant';
import { ApprovedRefundPolicySource } from '../../src/modules/money/runtime/approved-refund-policy.source';

// Boots actual AppModule/HTTP/auth/PostgreSQL/Redis composition without replacing
// any money port. Disposable synthetic actors use normal login/OTP. No external
// provider call or commercial refund policy is claimed by these negative tests.
const db = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
db('G3 mounted financial runtime (real infrastructure)', () => {
  let h: R24MoneyHttpFixture;
  beforeAll(async () => {
    h = await r24MoneyHttpFixture({ isolateRateLimits: true });
  });
  afterAll(async () => {
    await h?.dispose();
  });
  it('binds one shared concrete implementation for every integrated port', () => {
    for (const [token, implementation] of [
      [MONEY_CONFIGURATION, MoneyRailConfiguration],
      [MONEY_COLLECTION_ADAPTER, MoneyCollectionRouter],
      [MONEY_REFUND_ADAPTER, MoneyRefundRouter],
      [MONEY_REFUND_CONFIRMATION_PARTICIPANT, ApprovedRefundParticipant],
      [REFUND_POLICY_SOURCE, ApprovedRefundPolicySource],
    ] as const)
      expect(h.app.get(token)).toBe(h.app.get(implementation));
  });
  it('mounts the private Stripe session route and denies anonymous and unprivileged fresh sessions', async () => {
    expect((await h.session().request('/v1/money/stripe/attempts/absent/session')).status).toBe(
      401,
    );
    const noPermission = await h.login('noPermission');
    expect((await noPermission.request('/v1/money/stripe/attempts/absent/session')).status).toBe(
      403,
    );
  });
  it('rejects client price/currency authority through the actual purchase route', async () => {
    const owner = await h.login('owner');
    const result = await owner.request('/v1/money/intents', {
      method: 'POST',
      idempotencyKey: h.key('tamper'),
      body: {
        contractVersion: 'hsm.money.v1',
        planVersionId: 'absent',
        method: 'STRIPE',
        amountMinor: '1',
        currency: 'USD',
      },
    });
    expect(result.status).toBe(400);
  });
  it('mounts signed ingress and fails closed without a configured Stripe account', async () => {
    const result = await h
      .session()
      .request('/v1/money/webhooks/stripe', { method: 'POST', body: { id: 'synthetic-event' } });
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toMatch(/sk_test_|whsec_/u);
  });
});
