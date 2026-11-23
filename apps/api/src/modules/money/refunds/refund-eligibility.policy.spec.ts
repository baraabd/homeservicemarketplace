import { toMoneyWire } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';

import type { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import type { MoneyRefundPolicyPort } from '../ports/refund.port';
import {
  RefundEligibilityPolicy,
  UnavailableRefundPolicySource,
  type ApprovedRefundPolicy,
  type RefundPolicyScope,
  type RefundPolicySourcePort,
} from './refund-eligibility.policy';

// Synthetic contract components only. These rules do not approve a currency,
// commercial policy or entitlement consequence. R32's PostgreSQL suite proves
// reservation locking and transaction rollback with the real authorities.
const NOW = new Date('2026-10-23T12:00:00.000Z');

function approvedPolicy(): ApprovedRefundPolicy {
  return {
    version: 'r32-synthetic-refund-v1',
    approvalReference: 'r32-unit-fixture-only',
    mode: 'SANDBOX',
    planVersionId: 'captured-plan-version',
    method: 'STRIPE',
    currency: 'XTS',
    reasonCodes: ['DUPLICATE_PURCHASE'],
    refundWindowSeconds: 3_600,
    allowPartial: true,
    requireRequesterReviewerSeparation: true,
    requireOriginalReviewerSeparation: true,
    feeTreatment: 'NO_DEDUCTION',
    taxTreatment: 'NO_ADJUSTMENT',
    proRataTreatment: 'NONE',
    entitlementPolicyVersion: 'r32-synthetic-consequence-v1',
  };
}

function harness() {
  const input: Parameters<MoneyRefundPolicyPort['authorizeReservation']>[0] = {
    refundRequestId: 'request-1',
    paymentConfirmationId: 'confirmation-1',
    providerProfileId: 'provider-1',
    requestedByUserId: 'payer',
    reviewerUserId: 'reviewer',
    amount: toMoneyWire({ amountMinor: 250n, currency: 'XTS' }),
    reasonCode: 'DUPLICATE_PURCHASE',
  };
  const binding = {
    paymentIntentId: 'intent-1',
    currency: 'XTS',
    mode: 'SANDBOX',
  };
  const intent = {
    id: 'intent-1',
    providerProfileId: 'provider-1',
    planVersionId: 'captured-plan-version',
    status: 'SUCCEEDED',
    totalMinor: 1_000n,
    currency: 'XTS',
    method: 'STRIPE',
    binding: binding as typeof binding | null,
  };
  const posting = {
    id: 'posting-1',
    status: 'POSTED',
    currency: 'XTS',
    reversedBy: null as { id: string } | null,
  };
  const period = {
    id: 'period-1',
    paymentConfirmationId: 'confirmation-1',
    subscription: {
      providerProfileId: 'provider-1',
      planVersionId: 'captured-plan-version',
    },
  };
  const confirmation = {
    id: 'confirmation-1',
    paymentIntentId: 'intent-1',
    amountMinor: 1_000n,
    currency: 'XTS',
    confirmedAt: new Date(NOW.getTime() - 1_800_000),
    ledgerTransactionId: 'posting-1',
    reviewerUserId: null as string | null,
    paymentIntent: intent,
    ledgerTransaction: posting,
    period: period as typeof period | null,
  };
  const request = {
    id: 'request-1',
    paymentConfirmationId: 'confirmation-1',
    providerProfileId: 'provider-1',
    requestedByUserId: 'payer',
    reasonCode: 'DUPLICATE_PURCHASE',
    amountMinor: 250n,
    currency: 'XTS',
    status: 'PENDING_POLICY',
    refundId: null as string | null,
    paymentConfirmation: confirmation,
  };
  const provider = {
    id: 'provider-1',
    userId: 'payer',
    status: 'ACTIVE',
    deletedAt: null as Date | null,
  };
  const state = {
    request: request as typeof request | null,
    provider: provider as typeof provider | null,
    policy: approvedPolicy() as unknown,
    reserved: null as bigint | null,
    exception: null as { id: string } | null,
    now: NOW,
  };
  const activeUsers = new Set(['payer', 'reviewer']);
  const roles = new Map([
    ['payer', new Set(['provider'])],
    ['reviewer', new Set(['admin'])],
  ]);
  const rights = new Map([
    ['payer', new Set(['money:refund:request:self'])],
    ['reviewer', new Set(['money:refund:review'])],
  ]);
  const db = {
    moneyRefundRequest: { findUnique: jest.fn(async () => state.request) },
    providerProfile: { findUnique: jest.fn(async () => state.provider) },
    user: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id: string; userRoles: { some: { role: { name: string } } } };
        }) =>
          activeUsers.has(where.id) && roles.get(where.id)?.has(where.userRoles.some.role.name)
            ? { id: where.id }
            : null,
      ),
    },
    moneyReconciliationException: { findFirst: jest.fn(async () => state.exception) },
    moneyRefund: {
      aggregate: jest.fn(async () => ({ _sum: { amountMinor: state.reserved } })),
    },
    $queryRaw: jest.fn(async () => [{ now: state.now }]),
  };
  const tx = db as unknown as PrismaTx;
  const source = {
    resolve: jest.fn<Promise<ApprovedRefundPolicy | null>, [RefundPolicyScope, PrismaTx]>(
      async () => state.policy as ApprovedRefundPolicy | null,
    ),
  } satisfies RefundPolicySourcePort;
  const permissions = {
    resolveFreshForUser: jest.fn(async (userId: string) => rights.get(userId) ?? new Set<string>()),
  };
  const service = new RefundEligibilityPolicy(
    source,
    permissions as unknown as PermissionResolverService,
  );
  return {
    input,
    state,
    request,
    confirmation,
    intent,
    binding,
    posting,
    period,
    provider,
    roles,
    rights,
    activeUsers,
    db,
    tx,
    source,
    permissions,
    service,
    run: () => service.authorizeReservation(input, tx),
  };
}

describe('R32 approved refund eligibility', () => {
  it('has an unavailable policy source by default', async () => {
    await expect(new UnavailableRefundPolicySource().resolve()).resolves.toBeNull();
  });

  it('accepts an explicitly approved synthetic partial refund using the captured obligation', async () => {
    const h = harness();
    await expect(h.run()).resolves.toEqual({ policyVersion: 'r32-synthetic-refund-v1' });
    expect(h.source.resolve).toHaveBeenCalledWith(
      {
        planVersionId: 'captured-plan-version',
        method: 'STRIPE',
        currency: 'XTS',
        mode: 'SANDBOX',
      },
      h.tx,
    );
    expect(h.permissions.resolveFreshForUser.mock.calls).toEqual([
      ['payer', h.tx],
      ['reviewer', h.tx],
    ]);
    expect(h.db.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'reviewer',
        status: 'ACTIVE',
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { name: 'admin', deletedAt: null } } },
      },
      select: { id: true },
    });
  });

  it.each([
    ['missing policy', null],
    ['missing approval', { ...approvedPolicy(), approvalReference: undefined }],
    ['missing window decision', { ...approvedPolicy(), refundWindowSeconds: undefined }],
    ['missing consequence', { ...approvedPolicy(), entitlementPolicyVersion: '' }],
    ['altered version identity', { ...approvedPolicy(), version: ' r32-synthetic-refund-v1 ' }],
    ['live policy', { ...approvedPolicy(), mode: 'LIVE' }],
    ['unsupported fees', { ...approvedPolicy(), feeTreatment: 'DEDUCT_FEES' }],
    ['unsupported tax', { ...approvedPolicy(), taxTreatment: 'RECALCULATE' }],
    ['unsupported pro-rata', { ...approvedPolicy(), proRataTreatment: 'BY_DAY' }],
    [
      'missing separation decision',
      { ...approvedPolicy(), requireRequesterReviewerSeparation: undefined },
    ],
    ['fractional window', { ...approvedPolicy(), refundWindowSeconds: 1.5 }],
    ['unsafe window', { ...approvedPolicy(), refundWindowSeconds: Number.MAX_SAFE_INTEGER + 1 }],
    ['unrecognized field', { ...approvedPolicy(), grantWorkAccess: true }],
  ])('fails closed for %s', async (_label, policy) => {
    const h = harness();
    h.state.policy = policy;
    await expect(h.run()).rejects.toMatchObject({
      status: 503,
      details: { reason: 'MONEY_REFUND_POLICY_UNAVAILABLE' },
    });
  });

  it.each([
    ['planVersionId', 'another-plan'],
    ['method', 'CASH_OFFICE'],
    ['currency', 'USD'],
  ])('refuses an approved policy for a different %s', async (field, value) => {
    const h = harness();
    h.state.policy = { ...approvedPolicy(), [field]: value };
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_POLICY_SCOPE_MISMATCH' },
    });
  });

  it('refuses a captured live binding before resolving sandbox policy', async () => {
    const h = harness();
    h.binding.mode = 'LIVE';
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_LIVE_POLICY_BLOCKED' },
    });
    expect(h.source.resolve).not.toHaveBeenCalled();
  });

  it('does not reveal a missing request', async () => {
    const h = harness();
    h.state.request = null;
    await expect(h.run()).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ['paymentConfirmationId', 'other-confirmation'],
    ['providerProfileId', 'other-provider'],
    ['requestedByUserId', 'other-payer'],
    ['reasonCode', 'OTHER_REASON'],
    ['currency', 'USD'],
    ['amountMinor', 251n],
  ])('compares input against the durable request %s', async (field, value) => {
    const h = harness();
    Object.assign(h.request, { [field]: value });
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_REQUEST_MISMATCH' },
    });
  });

  it.each(['AUTHORIZED', 'REJECTED'])('refuses an already %s request', async (status) => {
    const h = harness();
    h.request.status = status;
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_REQUEST_ALREADY_DECIDED' },
    });
  });

  it('refuses a request already linked to a reservation', async () => {
    const h = harness();
    h.request.refundId = 'existing-refund';
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_REQUEST_ALREADY_DECIDED' },
    });
  });

  it.each([
    [
      'unpaid intent',
      (h: ReturnType<typeof harness>) => {
        h.intent.status = 'PROCESSING';
      },
    ],
    [
      'different owner',
      (h: ReturnType<typeof harness>) => {
        h.intent.providerProfileId = 'other';
      },
    ],
    [
      'different captured amount',
      (h: ReturnType<typeof harness>) => {
        h.intent.totalMinor = 999n;
      },
    ],
    [
      'different captured currency',
      (h: ReturnType<typeof harness>) => {
        h.intent.currency = 'USD';
      },
    ],
    [
      'unposted original',
      (h: ReturnType<typeof harness>) => {
        h.posting.status = 'DRAFT';
      },
    ],
    [
      'wrong original posting',
      (h: ReturnType<typeof harness>) => {
        h.posting.id = 'other';
      },
    ],
    [
      'missing binding',
      (h: ReturnType<typeof harness>) => {
        h.intent.binding = null;
      },
    ],
    [
      'wrong binding',
      (h: ReturnType<typeof harness>) => {
        h.binding.paymentIntentId = 'other';
      },
    ],
    [
      'missing subscription period',
      (h: ReturnType<typeof harness>) => {
        h.confirmation.period = null;
      },
    ],
    [
      'another subscription owner',
      (h: ReturnType<typeof harness>) => {
        h.period.subscription.providerProfileId = 'other';
      },
    ],
    [
      'another subscription plan',
      (h: ReturnType<typeof harness>) => {
        h.period.subscription.planVersionId = 'other';
      },
    ],
  ])('refuses an invalid original obligation: %s', async (_label, mutate) => {
    const h = harness();
    mutate(h);
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_ORIGINAL_OBLIGATION_INVALID' },
    });
  });

  it('refuses a reversed original without changing posted history', async () => {
    const h = harness();
    h.posting.reversedBy = { id: 'full-reversal' };
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_ORIGINAL_REVERSED' },
    });
  });

  it.each([
    [
      'missing provider',
      (h: ReturnType<typeof harness>) => {
        h.state.provider = null;
      },
    ],
    [
      'changed payer',
      (h: ReturnType<typeof harness>) => {
        h.provider.userId = 'different-payer';
      },
    ],
    [
      'deleted provider',
      (h: ReturnType<typeof harness>) => {
        h.provider.deletedAt = NOW;
      },
    ],
    [
      'suspended provider',
      (h: ReturnType<typeof harness>) => {
        h.provider.status = 'SUSPENDED';
      },
    ],
  ])('refuses invalid current ownership: %s', async (_label, mutate) => {
    const h = harness();
    mutate(h);
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_OWNER_MISMATCH' },
    });
  });

  it.each(['payer', 'reviewer'])('requires fresh permission for %s', async (actor) => {
    const h = harness();
    h.rights.get(actor)!.clear();
    await expect(h.run()).rejects.toMatchObject({ status: 403 });
  });

  it.each(['payer', 'reviewer'])('requires an active account for %s', async (actor) => {
    const h = harness();
    h.activeUsers.delete(actor);
    await expect(h.run()).rejects.toMatchObject({ status: 403 });
  });

  it.each(['payer', 'reviewer'])('requires the current base role for %s', async (actor) => {
    const h = harness();
    h.roles.get(actor)!.clear();
    await expect(h.run()).rejects.toMatchObject({ status: 403 });
  });

  it('enforces approved requester/reviewer separation even when both permissions exist', async () => {
    const h = harness();
    h.input.reviewerUserId = 'payer';
    h.roles.get('payer')!.add('admin');
    h.rights.get('payer')!.add('money:refund:review');
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_ACTOR_SEPARATION_REQUIRED' },
    });
  });

  it('enforces separately configured original-payment-reviewer separation', async () => {
    const h = harness();
    h.confirmation.reviewerUserId = 'reviewer';
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_ACTOR_SEPARATION_REQUIRED' },
    });
  });

  it('does not invent separation when the approved synthetic policy explicitly disables it', async () => {
    const h = harness();
    h.input.reviewerUserId = 'payer';
    h.confirmation.reviewerUserId = 'payer';
    h.roles.get('payer')!.add('admin');
    h.rights.get('payer')!.add('money:refund:review');
    h.state.policy = {
      ...approvedPolicy(),
      requireRequesterReviewerSeparation: false,
      requireOriginalReviewerSeparation: false,
    };
    await expect(h.run()).resolves.toHaveProperty('policyVersion');
  });

  it('rejects a reason outside the approved policy', async () => {
    const h = harness();
    h.state.policy = { ...approvedPolicy(), reasonCodes: ['DIFFERENT_REASON'] };
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_REASON_NOT_APPROVED' },
    });
  });

  it('rejects partial refunds when only a full captured refund is approved', async () => {
    const h = harness();
    h.state.policy = { ...approvedPolicy(), allowPartial: false };
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_PARTIAL_NOT_APPROVED' },
    });
    h.request.amountMinor = 1_000n;
    h.input.amount = toMoneyWire({ amountMinor: 1_000n, currency: 'XTS' });
    await expect(h.run()).resolves.toHaveProperty('policyVersion');
  });

  it('uses the transaction clock and honors the exact approved window boundary', async () => {
    const h = harness();
    h.confirmation.confirmedAt = new Date(NOW.getTime() - 3_600_000);
    await expect(h.run()).resolves.toHaveProperty('policyVersion');
    h.state.now = new Date(NOW.getTime() + 1);
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_WINDOW_CLOSED' },
    });
  });

  it('accepts an unlimited window only when null was explicitly approved', async () => {
    const h = harness();
    h.state.policy = { ...approvedPolicy(), refundWindowSeconds: null };
    h.confirmation.confirmedAt = new Date('2001-01-01T00:00:00Z');
    await expect(h.run()).resolves.toHaveProperty('policyVersion');
  });

  it('refuses a future-dated confirmation even with an unlimited window', async () => {
    const h = harness();
    h.state.policy = { ...approvedPolicy(), refundWindowSeconds: null };
    h.confirmation.confirmedAt = new Date(NOW.getTime() + 1);
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_WINDOW_CLOSED' },
    });
  });

  it('blocks an unresolved exception on the original financial obligation', async () => {
    const h = harness();
    h.state.exception = { id: 'exception-1' };
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_ORIGINAL_EXCEPTION' },
    });
    expect(h.db.moneyReconciliationException.findFirst).toHaveBeenCalledWith({
      where: {
        resolvedAt: null,
        OR: [
          { subjectType: 'PaymentConfirmation', subjectId: 'confirmation-1' },
          { subjectType: 'LedgerTransaction', subjectId: 'posting-1' },
          { subjectType: 'SubscriptionPeriod', subjectId: 'period-1' },
        ],
      },
      select: { id: true },
    });
  });

  it('counts unknown/pending reservations and successful refunds against capacity', async () => {
    const h = harness();
    h.state.reserved = 751n;
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_RESERVATION_EXCEEDED' },
    });
    expect(h.db.moneyRefund.aggregate).toHaveBeenCalledWith({
      where: {
        paymentConfirmationId: 'confirmation-1',
        status: { in: ['RESERVED', 'DISPATCHED', 'SUCCEEDED'] },
      },
      _sum: { amountMinor: true },
    });
    h.state.reserved = 750n;
    await expect(h.run()).resolves.toHaveProperty('policyVersion');
  });

  it('refuses an already fully refunded obligation', async () => {
    const h = harness();
    h.state.reserved = 1_000n;
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_RESERVATION_EXCEEDED' },
    });
  });

  it('preserves exact amounts above the JavaScript safe-integer range', async () => {
    const h = harness();
    const original = 9_007_199_254_740_993n;
    h.intent.totalMinor = original;
    h.confirmation.amountMinor = original;
    h.request.amountMinor = original - 1n;
    h.input.amount = toMoneyWire({ amountMinor: original - 1n, currency: 'XTS' });
    h.state.reserved = 1n;
    await expect(h.run()).resolves.toHaveProperty('policyVersion');
    h.state.reserved = 2n;
    await expect(h.run()).rejects.toMatchObject({
      details: { reason: 'MONEY_REFUND_RESERVATION_EXCEEDED' },
    });
  });

  it('rejects zero amounts and reason codes too short for the existing reservation constraint', async () => {
    const h = harness();
    h.input.amount = toMoneyWire({ amountMinor: 0n, currency: 'XTS' });
    await expect(h.run()).rejects.toMatchObject({ status: 400 });
    h.input.amount = toMoneyWire({ amountMinor: 250n, currency: 'XTS' });
    h.input.reasonCode = 'AB';
    await expect(h.run()).rejects.toMatchObject({ status: 400 });
    expect(h.db.moneyRefundRequest.findUnique).not.toHaveBeenCalled();
  });
});
