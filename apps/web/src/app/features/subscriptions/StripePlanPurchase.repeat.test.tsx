import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  MoneyPlanVersionWireV1,
  PaymentIntentStatus,
  PaymentIntentWireV1,
} from '@homeservicemarketplace/contracts';
import { StripePlanPurchase } from './StripePlanPurchase';
import * as requests from './stripe-purchase.api';

// K07 same-tab repeat-purchase regression. Only HTTP is doubled: identity
// storage, rotation and resolution are the real implementation. The fake
// server mirrors the real idempotency contract: a replayed key returns the
// stored snapshot (original status), while GET returns the current status.
// Component evidence only; not sandbox, real-API or browser evidence.
vi.mock('./stripe-purchase.api', async (actual) => {
  const real = await actual<typeof import('./stripe-purchase.api')>();
  return {
    ...real,
    createStripePurchase: vi.fn(),
    readStripePurchaseIntent: vi.fn(),
    startStripePurchase: vi.fn(),
    resumeStripePurchase: vi.fn(),
    stripePurchaseSession: vi.fn(),
  };
});

const plan = { id: 'plan-v1', planKey: 'Synthetic plan', version: 1 } as MoneyPlanVersionWireV1;
const OWNER = 'synthetic-owner';
const KEY_PATTERN = /^checkout_[a-f0-9-]{36}$/u;

class NotPayable extends Error {
  status = 409;
}

function fakeServer() {
  const intents = new Map<string, { snapshot: PaymentIntentWireV1; status: PaymentIntentStatus }>();
  const intentByKey = new Map<string, string>();
  const attemptByKey = new Map<string, { attempt: string; intent: string }>();
  const resumes: string[] = [];
  const wire = (id: string, status: PaymentIntentStatus) =>
    ({
      contractVersion: 'hsm.money.v1',
      id,
      status,
      planVersionId: plan.id,
      total: { amountMinor: '1500', currency: 'XTS' },
      expiresAt: '2026-11-03T00:00:00.000Z',
    }) as unknown as PaymentIntentWireV1;
  vi.mocked(requests.createStripePurchase).mockImplementation(async (_plan, key) => {
    const existing = intentByKey.get(key);
    if (existing) return intents.get(existing)!.snapshot; // replay: stored snapshot
    const id = `intent-${intents.size + 1}`;
    intents.set(id, { snapshot: wire(id, 'CREATED'), status: 'CREATED' });
    intentByKey.set(key, id);
    return wire(id, 'CREATED');
  });
  vi.mocked(requests.readStripePurchaseIntent).mockImplementation(async (id) =>
    wire(id, intents.get(id)!.status),
  );
  vi.mocked(requests.startStripePurchase).mockImplementation(async (intentId, key) => {
    const existing = attemptByKey.get(key);
    if (existing) return { status: 'ACCEPTED', resourceId: existing.attempt } as never;
    const record = intents.get(intentId)!;
    if (record.status === 'EXPIRED' || record.status === 'CANCELLED') throw new NotPayable();
    const attempt = `attempt-${attemptByKey.size + 1}`;
    attemptByKey.set(key, { attempt, intent: intentId });
    record.status = 'PROCESSING';
    return { status: 'ACCEPTED', resourceId: attempt } as never;
  });
  const intentOf = (attempt: string) =>
    [...attemptByKey.values()].find((entry) => entry.attempt === attempt)!.intent;
  const expiredQuotes = new Set<string>();
  vi.mocked(requests.stripePurchaseSession).mockImplementation(async (attempt) => {
    const id = intentOf(attempt);
    const status = intents.get(id)!.status;
    if (status === 'SUCCEEDED') return { state: 'CONFIRMED', clientSecret: null } as never;
    if (status !== 'PROCESSING' || expiredQuotes.has(id)) throw new NotPayable();
    return { state: 'PROCESSING', clientSecret: null } as never;
  });
  vi.mocked(requests.resumeStripePurchase).mockImplementation(async (attempt, key) => {
    resumes.push(key);
    return { status: 'ACCEPTED', resourceId: attempt } as never;
  });
  return {
    /** Authoritative server-side outcome (webhook or manual review), never the browser. */
    settle(id: string, status: PaymentIntentStatus) {
      intents.get(id)!.status = status;
    },
    expireQuote(id: string) {
      expiredQuotes.add(id);
    },
    intentKeys: () => [...intentByKey.keys()],
    attemptKeys: () => [...attemptByKey.keys()],
    intentIds: () => [...intents.keys()],
    resumes,
  };
}

function mount(userId = OWNER) {
  return render(<StripePlanPurchase plan={plan} userId={userId} lang="en" />);
}
async function reviewAndContinue() {
  fireEvent.click(screen.getByRole('button', { name: 'Review sandbox purchase' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue with this amount' }));
  await screen.findByText(/pending confirmation/);
}
async function check() {
  fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }));
  await waitFor(() => expect(screen.queryByText('Loading payment…')).not.toBeInTheDocument());
}

let server: ReturnType<typeof fakeServer>;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  server = fakeServer();
});
afterEach(cleanup);

describe('K07 repeat purchase of the same plan version in one browser tab', () => {
  it('offers an explicit new purchase only after server confirmation and uses new identities', async () => {
    mount();
    await reviewAndContinue();
    expect(screen.queryByRole('button', { name: 'Start a new purchase' })).not.toBeInTheDocument();
    server.settle('intent-1', 'SUCCEEDED');
    await check();
    expect(await screen.findByText(/confirmed by the server/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start a new purchase' }));
    await reviewAndContinue();

    const [firstIntentKey, secondIntentKey] = server.intentKeys();
    const [firstAttemptKey, secondAttemptKey] = server.attemptKeys();
    expect(server.intentIds()).toEqual(['intent-1', 'intent-2']);
    expect(secondIntentKey).toMatch(KEY_PATTERN);
    expect(secondIntentKey).not.toBe(firstIntentKey);
    expect(secondAttemptKey).not.toBe(firstAttemptKey);
    expect(requests.stripePurchaseSession).toHaveBeenLastCalledWith('attempt-2');
  });

  it('detects a confirmed purchase after reload from the replayed key and still allows a new one', async () => {
    const first = mount();
    await reviewAndContinue();
    server.settle('intent-1', 'SUCCEEDED');
    first.unmount(); // reload before the browser observed the confirmation

    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Review sandbox purchase' }));
    // Replay returns the stored CREATED snapshot; only the fresh read shows SUCCEEDED.
    expect(await screen.findByText(/confirmed by the server/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with this amount' })).toBeNull();
    expect(server.intentIds()).toEqual(['intent-1']);
    expect(requests.startStripePurchase).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Start a new purchase' }));
    await reviewAndContinue();
    expect(server.intentIds()).toEqual(['intent-1', 'intent-2']);
  });

  it('keeps rotated, still unused identities across reload and logout/login of the same account', async () => {
    const first = mount();
    await reviewAndContinue();
    server.settle('intent-1', 'SUCCEEDED');
    await check();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new purchase' }));
    const rotated = requests.stripePurchaseKeys(OWNER, plan.id);
    first.unmount(); // reload, or sign-out followed by sign-in in this tab

    const second = mount();
    expect(requests.stripePurchaseKeys(OWNER, plan.id)).toEqual(rotated);
    await reviewAndContinue();
    expect(server.intentKeys()[1]).toBe(rotated.intent);
    expect(server.attemptKeys()[1]).toBe(rotated.attempt);
    second.unmount();

    // A different account in the same tab never inherits these identities.
    expect(requests.stripePurchaseKeys('synthetic-other', plan.id).intent).not.toBe(rotated.intent);
  });

  it('never offers a new purchase or rotates identities while the outcome is pending', async () => {
    const first = mount();
    await reviewAndContinue();
    const original = requests.stripePurchaseKeys(OWNER, plan.id);
    await check();
    await check();
    expect(screen.queryByRole('button', { name: 'Start a new purchase' })).toBeNull();
    expect(server.resumes).toEqual([original.resume, original.resume]);
    first.unmount();

    mount();
    await reviewAndContinue();
    expect(server.intentIds()).toEqual(['intent-1']);
    expect(server.attemptKeys()).toEqual([original.attempt]);
    expect(requests.stripePurchaseKeys(OWNER, plan.id)).toEqual(original);
  });

  it('recovers an expired quote with an unresolved external outcome without rotating identities', async () => {
    mount();
    await reviewAndContinue();
    const original = requests.stripePurchaseKeys(OWNER, plan.id);
    server.expireQuote('intent-1'); // timer elapsed; intent is still PROCESSING
    await check();

    expect(await screen.findByText(/result is not recorded yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a new purchase' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(server.resumes).toEqual([original.resume]);
    expect(requests.stripePurchaseKeys(OWNER, plan.id)).toEqual(original);

    // The late authoritative outcome is still observed through the same attempt.
    server.settle('intent-1', 'SUCCEEDED');
    await check();
    expect(await screen.findByText(/confirmed by the server/)).toBeInTheDocument();
    expect(server.intentIds()).toEqual(['intent-1']);
  });

  it('offers a new purchase after a definitive server failure', async () => {
    mount();
    await reviewAndContinue();
    server.settle('intent-1', 'FAILED');
    await check();
    expect(await screen.findByText(/closed this purchase without confirming/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a new purchase' }));
    await reviewAndContinue();
    expect(server.intentKeys()[1]).not.toBe(server.intentKeys()[0]);
  });

  it('offers a new purchase when the server expired the intent before any dispatch', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Review sandbox purchase' }));
    await screen.findByRole('button', { name: 'Continue with this amount' });
    server.settle('intent-1', 'EXPIRED');
    fireEvent.click(screen.getByRole('button', { name: 'Continue with this amount' }));
    expect(await screen.findByText(/closed this purchase without confirming/)).toBeInTheDocument();
    expect(server.attemptKeys()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Start a new purchase' }));
    await reviewAndContinue();
    expect(server.intentIds()).toEqual(['intent-1', 'intent-2']);
  });

  it('still reports an unexpected failure on an open intent as retryable with the same identity', async () => {
    mount();
    vi.mocked(requests.startStripePurchase).mockRejectedValueOnce(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: 'Review sandbox purchase' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with this amount' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start a new purchase' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with this amount' }));
    await screen.findByText(/pending confirmation/);
    const keys = vi.mocked(requests.startStripePurchase).mock.calls.map((call) => call[1]);
    expect(new Set(keys).size).toBe(1);
  });
});

describe('K07 identity rotation helpers', () => {
  it('rotates only used identities and keeps an unused successor', () => {
    const used = requests.stripePurchaseKeys(OWNER, plan.id);
    const next = requests.rotateStripePurchaseKeys(OWNER, plan.id, used);
    expect(next.intent).not.toBe(used.intent);
    expect(next.attempt).not.toBe(used.attempt);
    expect(next.resume).not.toBe(used.resume);
    expect(requests.rotateStripePurchaseKeys(OWNER, plan.id, used)).toEqual(next);
    expect(requests.stripePurchaseKeys(OWNER, plan.id)).toEqual(next);
  });

  it.each([
    ['SUCCEEDED', 'CONFIRMED'],
    ['FAILED', 'CLOSED'],
    ['CANCELLED', 'CLOSED'],
    ['EXPIRED', 'CLOSED'],
    ['CREATED', 'OPEN'],
    ['AWAITING_PAYMENT', 'OPEN'],
    ['PROCESSING', 'OPEN'],
  ] as const)('maps server status %s to %s', (status, expected) => {
    expect(requests.stripePurchaseResolution(status)).toBe(expected);
  });
});
