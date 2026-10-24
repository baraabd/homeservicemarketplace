import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MoneyPlanVersionWireV1 } from '@homeservicemarketplace/contracts';
import { StripePlanPurchase } from './StripePlanPurchase';
import * as requests from './stripe-purchase.api';
vi.mock('./stripe-purchase.api', () => ({
  stripePurchaseKeys: () => ({
    intent: 'stable-intent',
    attempt: 'stable-attempt',
    resume: 'stable-resume',
  }),
  createStripePurchase: vi.fn(),
  startStripePurchase: vi.fn(),
  resumeStripePurchase: vi.fn(),
  stripePurchaseSession: vi.fn(),
}));
const plan = { id: 'plan', planKey: 'Synthetic plan', version: 1 } as MoneyPlanVersionWireV1;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requests.createStripePurchase).mockResolvedValue({
    id: 'intent',
    total: { amountMinor: '9223372036854775807', currency: 'XTS' },
  } as Awaited<ReturnType<typeof requests.createStripePurchase>>);
  vi.mocked(requests.startStripePurchase).mockResolvedValue({ resourceId: 'attempt' } as Awaited<
    ReturnType<typeof requests.startStripePurchase>
  >);
  vi.mocked(requests.stripePurchaseSession).mockResolvedValue({
    state: 'PROCESSING',
    clientSecret: null,
  } as Awaited<ReturnType<typeof requests.stripePurchaseSession>>);
});
afterEach(cleanup);
describe('G3 accessible purchase states (component API doubles, no sandbox claim)', () => {
  it('shows exact integer amount and requires another explicit action before collection', async () => {
    render(<StripePlanPurchase plan={plan} userId="fixture-owner" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Review sandbox purchase' }));
    expect(await screen.findByText('9223372036854775807 XTS')).toBeInTheDocument();
    expect(requests.startStripePurchase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with this amount' }));
    expect(await screen.findByText(/Payment is pending confirmation/)).toBeInTheDocument();
    expect(screen.queryByText(/confirmed by the server/)).not.toBeInTheDocument();
  });
  it('guards concurrent clicks and retries with the same identity', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(requests.createStripePurchase).mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    render(<StripePlanPurchase plan={plan} userId="fixture-owner" lang="en" />);
    const button = screen.getByRole('button', { name: 'Review sandbox purchase' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(requests.createStripePurchase).toHaveBeenCalledTimes(1);
    reject(new Error('network'));
    await screen.findByRole('alert');
    fireEvent.click(button);
    await screen.findByText('9223372036854775807 XTS');
    expect(vi.mocked(requests.createStripePurchase).mock.calls.map((x) => x[1])).toEqual([
      'stable-intent',
      'stable-intent',
    ]);
  });
  it('renders truthful Arabic unavailable feedback and no success', async () => {
    vi.mocked(requests.createStripePurchase).mockRejectedValue(new Error('unconfigured'));
    render(<StripePlanPurchase plan={plan} userId="fixture-owner" lang="ar" />);
    fireEvent.click(screen.getByRole('button', { name: 'مراجعة شراء اختباري' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('الدفع غير متاح');
    expect(requests.startStripePurchase).not.toHaveBeenCalled();
  });
  it('shows confirmed only on the server read and permits status recovery of the same attempt', async () => {
    render(<StripePlanPurchase plan={plan} userId="fixture-owner" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Review sandbox purchase' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with this amount' }));
    await screen.findByText(/pending confirmation/);
    vi.mocked(requests.stripePurchaseSession).mockResolvedValue({
      state: 'CONFIRMED',
      clientSecret: null,
    } as Awaited<ReturnType<typeof requests.stripePurchaseSession>>);
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
    await waitFor(() => expect(requests.stripePurchaseSession).toHaveBeenCalledWith('attempt'));
    expect(requests.resumeStripePurchase).not.toHaveBeenCalled();
    expect(await screen.findByText(/confirmed by the server/)).toBeInTheDocument();
  });
});
