import {
  MONEY_CONTRACT_VERSION,
  type MoneyCommandAcceptedV1,
  type MoneyStripeSessionV1,
  type PaymentIntentStatus,
  type PaymentIntentWireV1,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
const version = { contractVersion: MONEY_CONTRACT_VERSION };
export type StripePurchaseKeys = { intent: string; attempt: string; resume: string };
const storageKeyFor = (userId: string, planId: string) => `hsm:stripe-purchase:${userId}:${planId}`;
function storedKeys(storageKey: string): StripePurchaseKeys | null {
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
      return {
        intent: saved.intent,
        attempt: saved.attempt,
        resume: saved.resume,
      } as StripePurchaseKeys;
  } catch {
    /* No authority is read from browser storage. */
  }
  return null;
}
function freshKeys(storageKey: string): StripePurchaseKeys {
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
export function stripePurchaseKeys(userId: string, planId: string): StripePurchaseKeys {
  const storageKey = storageKeyFor(userId, planId);
  return storedKeys(storageKey) ?? freshKeys(storageKey);
}
/**
 * Server-read intent status → whether the external outcome is settled.
 * PROCESSING may only become SUCCEEDED or FAILED on the server, so EXPIRED and
 * CANCELLED are reachable only before any external operation was dispatched.
 * A client clock (expiresAt) never settles anything: an expired quote whose
 * intent is still PROCESSING may already have been charged.
 */
export function stripePurchaseResolution(
  status: PaymentIntentStatus,
): 'CONFIRMED' | 'CLOSED' | 'OPEN' {
  if (status === 'SUCCEEDED') return 'CONFIRMED';
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') return 'CLOSED';
  return 'OPEN';
}
/**
 * Explicit new purchase after the server settled the previous one. Rotates only
 * the identities that were actually used; if this tab already rotated them
 * (for example, before a reload), the unused successor identities are kept.
 */
export function rotateStripePurchaseKeys(
  userId: string,
  planId: string,
  used: StripePurchaseKeys,
): StripePurchaseKeys {
  const storageKey = storageKeyFor(userId, planId);
  const current = storedKeys(storageKey);
  if (current && current.intent !== used.intent) return current;
  return freshKeys(storageKey);
}
export async function readStripePurchaseIntent(intentId: string) {
  // An idempotent create replays its stored snapshot; current status needs a fresh owner read.
  return (await api.get<PaymentIntentWireV1>(`/v1/money/intents/${encodeURIComponent(intentId)}`))
    .data;
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
