import {
  MONEY_CONTRACT_VERSION,
  type MoneyCommandAcceptedV1,
  type MoneyStripeSessionV1,
  type PaymentIntentWireV1,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
const version = { contractVersion: MONEY_CONTRACT_VERSION };
export function stripePurchaseKeys(userId: string, planId: string) {
  const storageKey = `hsm:stripe-purchase:${userId}:${planId}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Record<
      string,
      unknown
    > | null;
    if (
      saved &&
      ['intent', 'attempt', 'resume'].every(
        (key) =>
          typeof saved[key] === 'string' && /^checkout_[a-f0-9-]{36}$/u.test(saved[key] as string),
      )
    )
      return saved as { intent: string; attempt: string; resume: string };
  } catch {
    /* No authority is read from browser storage. */
  }
  const keys = {
    intent: `checkout_${crypto.randomUUID()}`,
    attempt: `checkout_${crypto.randomUUID()}`,
    resume: `checkout_${crypto.randomUUID()}`,
  };
  // Only opaque command identities survive a refresh, never amounts or secrets.
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(keys));
  } catch {
    /* Component still preserves keys for retries. */
  }
  return keys;
}
export async function createStripePurchase(planVersionId: string, key: string) {
  return (
    await api.post<PaymentIntentWireV1>(
      '/v1/money/intents',
      { ...version, planVersionId, method: 'STRIPE' },
      { headers: { 'Idempotency-Key': key } },
    )
  ).data;
}
export async function startStripePurchase(intentId: string, key: string) {
  return (
    await api.post<MoneyCommandAcceptedV1>(
      `/v1/money/intents/${encodeURIComponent(intentId)}/attempts`,
      version,
      { headers: { 'Idempotency-Key': key } },
    )
  ).data;
}
export async function resumeStripePurchase(attemptId: string, key: string) {
  return (
    await api.post<MoneyCommandAcceptedV1>(
      `/v1/money/attempts/${encodeURIComponent(attemptId)}/resume`,
      version,
      { headers: { 'Idempotency-Key': key } },
    )
  ).data;
}
export async function stripePurchaseSession(attemptId: string) {
  // Deliberately outside query caching; secret exists only in component memory.
  return (
    await api.get<MoneyStripeSessionV1>(
      `/v1/money/stripe/attempts/${encodeURIComponent(attemptId)}/session`,
    )
  ).data;
}
