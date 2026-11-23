import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type {
  MoneyMyPlanWireV1,
  MoneyPlanVersionWireV1,
  MoneySubscriptionSummaryWireV1,
  MoneyWire,
  PaymentAttemptStatus,
  PaymentIntentStatus,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { MyPlanScreen } from './MyPlanScreen';
import { SUBSCRIPTION_COPY } from './subscriptions.copy';

const identity = vi.hoisted(() => ({ user: { id: 'account-1' } as { id: string } | null }));
vi.mock('../../../lib/auth-provider', () => ({ useAuth: () => ({ user: identity.user }) }));

const MY_PLAN = '/v1/money/my-plan';
const PURCHASES = '/v1/money/subscriptions';
const CATALOG = '/v1/money/plans';
const period = {
  contractVersion: 'hsm.money.v1' as const,
  id: 'period-1',
  subscriptionId: 'subscription-1',
  paymentConfirmationId: 'confirmation-1',
  billingInterval: 'MONTHLY' as const,
  // Deliberately past: the client must render the server's status rather than
  // running its own expiry or entitlement state machine.
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: '2020-02-01T00:00:00.000Z',
};
const version: MoneyPlanVersionWireV1 = {
  contractVersion: 'hsm.money.v1',
  id: 'version-1',
  planKey: 'Component fixture plan',
  version: 1,
  billingInterval: 'MONTHLY',
  price: { amountMinor: '9223372036854775807' as MoneyWire['amountMinor'], currency: 'XXX' },
  entitlements: [{ key: 'requests', value: { kind: 'LIMIT', limit: 5 } }],
  publishedAt: '2019-12-01T00:00:00.000Z',
  retiredAt: null,
};

function view(status: MoneyMyPlanWireV1['status'] = 'ACTIVE'): MoneyMyPlanWireV1 {
  return {
    contractVersion: 'hsm.money.v1',
    asOf: '2026-10-23T09:00:00.000Z',
    status,
    subscription: {
      id: 'subscription-1',
      status: 'ACTIVE',
      plan: version,
      currentPeriod: period,
      nextPeriod: null,
    },
    entitlements: [{ key: 'requests', allowed: true, limit: 5, used: 2, remaining: 3 }],
    history: [period],
    historyHasMore: false,
    payment: null,
    policy: {
      state: 'POLICY_BLOCKED',
      blockers: ['COMMERCIAL_POLICY_UNAPPROVED'],
      canCancel: false,
      canRenew: false,
      canApplyCoupon: false,
    },
    grantsIdentityVerification: false,
    grantsWorkAccess: false,
  };
}

function purchase(id: string): MoneySubscriptionSummaryWireV1 {
  return {
    contractVersion: 'hsm.money.v1',
    id,
    providerProfileId: 'provider-1',
    planVersionId: version.id,
    status: 'ACTIVE',
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  };
}

function payment(
  status: PaymentIntentStatus = 'FAILED',
  latestAttemptStatus: PaymentAttemptStatus | null = 'FAILED',
): NonNullable<MoneyMyPlanWireV1['payment']> {
  return {
    contractVersion: 'hsm.money.v1',
    id: 'renewal',
    providerProfileId: 'provider-1',
    planVersionId: version.id,
    method: 'STRIPE',
    status,
    latestAttemptStatus,
    subtotal: version.price,
    discount: { ...version.price, amountMinor: '0' as MoneyWire['amountMinor'] },
    total: version.price,
    createdAt: '2026-10-23T08:00:00.000Z',
    expiresAt: '2026-10-24T08:00:00.000Z',
  };
}

let mock: MockAdapter;
let client: QueryClient;
beforeEach(() => {
  identity.user = { id: 'account-1' };
  onlineManager.setOnline(true);
  localStorage.setItem('hsm.lang', 'en');
  mock = new MockAdapter(api);
  mock.onGet(MY_PLAN).reply(200, view());
  mock.onGet(PURCHASES).reply(200, { items: [purchase('subscription-1')], nextCursor: null });
  mock.onGet(CATALOG).reply(200, { contractVersion: 'hsm.money.v1', items: [], nextCursor: null });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  mock.restore();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}
function tree(path = '/provider/my-plan') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <MyPlanScreen />
          <LocationProbe />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
async function refresh() {
  await waitFor(() => expect(screen.getByTestId('my-plan-refresh')).not.toBeDisabled());
  fireEvent.click(screen.getByTestId('my-plan-refresh'));
}

describe('server-authoritative My Plan', () => {
  it.each(Object.keys(SUBSCRIPTION_COPY.en.states) as MoneyMyPlanWireV1['status'][])(
    'renders %s exactly as returned by the server without inferring expiry from the browser clock',
    async (status) => {
      mock.onGet(MY_PLAN).reply(200, view(status));
      render(tree());
      expect(await screen.findByTestId('my-plan-status')).toHaveTextContent(
        SUBSCRIPTION_COPY.en.states[status],
      );
      expect(screen.getByText(SUBSCRIPTION_COPY.en.authority)).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(mock.history.post).toHaveLength(0);
    },
  );

  it('a success redirect cannot activate an unpaid subscription', async () => {
    mock.onGet(MY_PLAN).reply(200, {
      ...view('PENDING_PAYMENT'),
      subscription: null,
      history: [],
      entitlements: [],
    });
    render(tree('/provider/my-plan?success=true&payment_status=paid'));
    expect(await screen.findByTestId('my-plan-status')).toHaveTextContent('Payment pending');
    expect(screen.queryByText('Active', { exact: true })).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it('shows a failed renewal separately from current paid access', async () => {
    mock.onGet(MY_PLAN).reply(200, {
      ...view(),
      payment: payment(),
    });
    render(tree());
    expect(await screen.findByTestId('my-plan-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('my-plan-payment-status')).toHaveTextContent('Payment failed');
    expect(screen.getByText(SUBSCRIPTION_COPY.en.paymentPending)).toBeInTheDocument();
  });

  it.each(['ACTIVE', 'FAILED'] as const)(
    'separates a failed latest attempt from a pending payment update while the subscription is %s',
    async (status) => {
      mock.onGet(MY_PLAN).reply(200, {
        ...view(status),
        ...(status === 'FAILED' ? { subscription: null, history: [], entitlements: [] } : {}),
        payment: payment('PROCESSING', 'FAILED'),
      });
      render(tree());
      expect(await screen.findByTestId('my-plan-status')).toHaveTextContent(
        SUBSCRIPTION_COPY.en.states[status],
      );
      expect(screen.getByTestId('my-plan-payment-status')).toHaveTextContent(
        'Payment update pending',
      );
      expect(screen.getByTestId('my-plan-payment-attempt')).toHaveTextContent(
        SUBSCRIPTION_COPY.en.attemptFailed,
      );
      expect(screen.queryByText('Confirmation pending')).not.toBeInTheDocument();
      if (status === 'ACTIVE') expect(screen.getByText('Version 1')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Switch to Arabic' }));
      expect(screen.getByTestId('my-plan-payment-status')).toHaveTextContent(
        SUBSCRIPTION_COPY.ar.payments.PROCESSING,
      );
      expect(screen.getByTestId('my-plan-payment-attempt')).toHaveTextContent(
        SUBSCRIPTION_COPY.ar.attemptFailed,
      );
    },
  );

  it('does not invent an attempt failure from a processing payment', async () => {
    mock.onGet(MY_PLAN).reply(200, { ...view(), payment: payment('PROCESSING', null) });
    render(tree());
    await screen.findByTestId('my-plan-payment-status');
    expect(screen.queryByTestId('my-plan-payment-attempt')).not.toBeInTheDocument();
    expect(screen.getByTestId('my-plan-status')).toHaveTextContent('Active');
  });

  it('does not guess a currency scale or render unsafe BIGINT as a rounded price', async () => {
    render(tree());
    await screen.findByTestId('my-plan-status');
    expect(screen.getByText(SUBSCRIPTION_COPY.en.priceUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(/922337203685/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /buy|renew|cancel|coupon/i }),
    ).not.toBeInTheDocument();
  });

  it('refreshes changed status and usage from the server without changing the purchased version', async () => {
    render(tree());
    await screen.findByText('Remaining: 3');
    mock.onGet(MY_PLAN).reply(200, {
      ...view('EXPIRED'),
      entitlements: [
        {
          key: 'requests',
          allowed: false,
          limit: 5,
          used: 5,
          remaining: 0,
          reason: 'NO_ACTIVE_SUBSCRIPTION',
        },
      ],
    });
    await refresh();
    await waitFor(() => expect(screen.getByTestId('my-plan-status')).toHaveTextContent('Expired'));
    expect(screen.getByText('Remaining: 0')).toBeInTheDocument();
    expect(screen.getByText('Version 1')).toBeInTheDocument();
  });

  it('does not describe an unavailable boolean feature as unlimited usage', async () => {
    mock.onGet(MY_PLAN).reply(200, {
      ...view(),
      entitlements: [
        { key: 'included-feature', allowed: true, limit: null, used: 0, remaining: null },
        {
          key: 'excluded-feature',
          allowed: false,
          limit: null,
          used: 0,
          remaining: null,
          reason: 'NOT_INCLUDED',
        },
      ],
    });
    render(tree());
    const excluded = (await screen.findByText('excluded-feature')).closest('li');
    expect(excluded).not.toBeNull();
    expect(within(excluded!).getByText(SUBSCRIPTION_COPY.en.unavailable)).toBeInTheDocument();
    expect(
      within(excluded!).getByText(SUBSCRIPTION_COPY.en.reasons.NOT_INCLUDED),
    ).toBeInTheDocument();
    expect(
      within(excluded!).queryByText(SUBSCRIPTION_COPY.en.noNumericLimit),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(SUBSCRIPTION_COPY.en.noNumericLimit)).toHaveLength(1);
    expect(screen.queryByText(/unlimited|no usage limit/i)).not.toBeInTheDocument();
  });

  it.each([403, 404])('hides cached private details after a %s refresh refusal', async (status) => {
    render(tree());
    await screen.findByText(version.planKey);
    mock.onGet(MY_PLAN).reply(status, { error: { message: 'private database details' } });
    await refresh();
    await screen.findByText(SUBSCRIPTION_COPY.en.denied);
    expect(screen.queryByText(version.planKey)).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-plan-status')).not.toBeInTheDocument();
    expect(screen.queryByText('private database details')).not.toBeInTheDocument();
  });

  it('labels cached details stale on network failure and recovers via refresh', async () => {
    render(tree());
    await screen.findByTestId('my-plan-status');
    mock.onGet(MY_PLAN).networkError();
    await refresh();
    await screen.findByText(SUBSCRIPTION_COPY.en.stale);
    expect(screen.getByText(version.planKey)).toBeInTheDocument();
    mock.onGet(MY_PLAN).reply(200, view('SUSPENDED'));
    await refresh();
    await waitFor(() =>
      expect(screen.getByTestId('my-plan-status')).toHaveTextContent('Suspended'),
    );
    expect(screen.queryByText(SUBSCRIPTION_COPY.en.stale)).not.toBeInTheDocument();
  });

  it('refreshes on reconnect and reports offline state without inventing payment success', async () => {
    render(tree());
    await screen.findByTestId('my-plan-status');
    act(() => {
      onlineManager.setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(SUBSCRIPTION_COPY.en.offline)).toBeInTheDocument();
    expect(screen.getByTestId('my-plan-refresh')).toBeDisabled();
    mock.onGet(MY_PLAN).reply(200, view('EXPIRED'));
    await act(async () => {
      onlineManager.setOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(screen.getByTestId('my-plan-status')).toHaveTextContent('Expired'));
    expect(screen.queryByText(SUBSCRIPTION_COPY.en.offline)).not.toBeInTheDocument();
  });

  it('keeps selected purchases in the URL and reads their own server projections', async () => {
    mock.onGet(PURCHASES).reply(200, {
      items: [purchase('subscription-1'), purchase('subscription-2')],
      nextCursor: null,
    });
    mock.onGet(MY_PLAN).reply((config) => [
      200,
      config.params?.subscriptionId === 'subscription-2'
        ? {
            ...view('CANCELLED'),
            subscription: {
              ...view().subscription,
              id: 'subscription-2',
              plan: { ...version, planKey: 'Earlier purchased plan' },
            },
          }
        : view(),
    ]);
    render(tree());
    await screen.findByTestId('my-plan-status');
    fireEvent.change(screen.getByRole('combobox', { name: 'Purchased subscription' }), {
      target: { value: 'subscription-2' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('my-plan-status')).toHaveTextContent('Cancelled'),
    );
    expect(screen.getByTestId('location')).toHaveTextContent('subscriptionId=subscription-2');
    expect(screen.getByText('Earlier purchased plan')).toBeInTheDocument();
    expect(screen.queryByText(version.planKey)).not.toBeInTheDocument();
  });

  it('honors a deep link after a fresh mount and supports additional purchase/catalog pages', async () => {
    mock
      .onGet(PURCHASES)
      .reply((config) => [
        200,
        config.params?.cursor
          ? { items: [purchase('subscription-2')], nextCursor: null }
          : { items: [purchase('subscription-1')], nextCursor: 'purchase-cursor' },
      ]);
    mock.onGet(CATALOG).reply((config) => [
      200,
      {
        contractVersion: 'hsm.money.v1',
        items: [
          {
            ...version,
            id: config.params?.cursor ? 'new-version' : 'version-1',
            planKey: config.params?.cursor ? 'Second catalog plan' : 'First catalog plan',
          },
        ],
        nextCursor: config.params?.cursor ? null : 'catalog-cursor',
      },
    ]);
    render(tree('/provider/my-plan?subscriptionId=subscription-1'));
    await screen.findByTestId('my-plan-status');
    expect(mock.history.get.find((request) => request.url === MY_PLAN)?.params).toEqual({
      subscriptionId: 'subscription-1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more purchases' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more plans' }));
    await screen.findByRole('option', { name: /subscription-2/ });
    await screen.findByText('Second catalog plan');
    expect(screen.queryByRole('button', { name: 'Load more purchases' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more plans' })).not.toBeInTheDocument();
  });

  it('retains the selected purchase, state and numeric usage order when changing to Arabic', async () => {
    render(tree('/provider/my-plan?subscriptionId=subscription-1'));
    await screen.findByTestId('my-plan-status');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Arabic' }));
    expect(screen.getByRole('heading', { name: 'خطتي', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('my-plan-status')).toHaveTextContent('نشط');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(screen.getByRole('combobox', { name: 'الاشتراك المشترى' })).toHaveValue(
      'subscription-1',
    );
    const number = new Intl.NumberFormat('ar');
    const usage = screen.getByText(`${number.format(2)} / ${number.format(5)}`);
    expect(usage).toHaveAttribute('dir', 'ltr');
    expect(usage.tagName).toBe('BDI');
  });

  it('cannot show a previous account plan when identity changes', async () => {
    const mounted = render(tree());
    await screen.findByText(version.planKey);
    identity.user = { id: 'account-2' };
    mock
      .onGet(MY_PLAN)
      .reply(200, { ...view('NONE'), subscription: null, entitlements: [], history: [] });
    mock.onGet(PURCHASES).reply(200, { items: [], nextCursor: null });
    mounted.rerender(tree());
    await screen.findByText(SUBSCRIPTION_COPY.en.noPlan);
    expect(screen.queryByText(version.planKey)).not.toBeInTheDocument();
  });

  it('reads the API on remount instead of treating cached plan data as persistent authority', async () => {
    const first = render(tree());
    await screen.findByTestId('my-plan-status');
    first.unmount();
    mock.onGet(MY_PLAN).reply(200, view('CANCELLED'));
    render(tree());
    await waitFor(() =>
      expect(screen.getByTestId('my-plan-status')).toHaveTextContent('Cancelled'),
    );
    expect(mock.history.get.filter((request) => request.url === MY_PLAN)).toHaveLength(2);
  });

  it('keeps the subscription history limit visible when the server caps history', async () => {
    mock.onGet(MY_PLAN).reply(200, { ...view(), historyHasMore: true });
    render(tree());
    expect(await screen.findByText(SUBSCRIPTION_COPY.en.historyMore)).toBeInTheDocument();
  });
});
