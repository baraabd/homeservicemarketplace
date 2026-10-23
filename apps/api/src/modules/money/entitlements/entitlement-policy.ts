import type {
  EntitlementDecision,
  PlanEntitlementContract,
} from '@homeservicemarketplace/contracts';

import { AppError } from '../../../shared/errors/app-error';
import { decideEntitlement } from '../money-domain';

export const SUBSCRIPTION_CLOCK = Symbol('SUBSCRIPTION_CLOCK');
export interface SubscriptionClock {
  now(): Date;
}
export const systemSubscriptionClock: SubscriptionClock = { now: () => new Date() };

const KEY = /^[a-z][a-z0-9_.:-]{1,63}$/u;

/** The purchased snapshot is the only paid-capability authority. It is never
 * interpreted as identity verification, work eligibility or account standing.
 * Invalid stored data fails closed instead of silently becoming unlimited. */
export function parsePlanEntitlements(value: unknown): PlanEntitlementContract[] {
  if (!Array.isArray(value) || value.length > 100) throw invalidStoredEntitlements();
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (
      !record(entry) ||
      Object.keys(entry).sort().join(',') !== 'key,value' ||
      typeof entry.key !== 'string' ||
      !KEY.test(entry.key) ||
      seen.has(entry.key) ||
      !record(entry.value)
    )
      throw invalidStoredEntitlements();
    seen.add(entry.key);
    const data = entry.value;
    if (
      data.kind === 'BOOLEAN' &&
      Object.keys(data).sort().join(',') === 'enabled,kind' &&
      typeof data.enabled === 'boolean'
    ) {
      return { key: entry.key, value: { kind: 'BOOLEAN', enabled: data.enabled } };
    }
    if (
      data.kind === 'LIMIT' &&
      Object.keys(data).sort().join(',') === 'kind,limit' &&
      (data.limit === null ||
        (typeof data.limit === 'number' && Number.isSafeInteger(data.limit) && data.limit >= 0))
    ) {
      return { key: entry.key, value: { kind: 'LIMIT', limit: data.limit } };
    }
    throw invalidStoredEntitlements();
  });
}

export function entitlementDecision(
  definitions: readonly PlanEntitlementContract[],
  key: string,
  used: number,
  active: boolean,
): EntitlementDecision {
  const definition = definitions.find((item) => item.key === key);
  return decideEntitlement({
    key,
    active,
    enabled: definition?.value.kind === 'LIMIT' || definition?.value.enabled === true,
    limit: definition?.value.kind === 'LIMIT' ? definition.value.limit : null,
    used,
  });
}

export function validEntitlementKey(value: string): boolean {
  return typeof value === 'string' && KEY.test(value);
}

export function subscriptionNow(clock: SubscriptionClock): Date {
  const now = clock.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new AppError('INTERNAL_ERROR', 'The subscription clock is unavailable.', 500);
  }
  return new Date(now.getTime());
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidStoredEntitlements(): AppError {
  return new AppError('INTERNAL_ERROR', 'The purchased entitlement snapshot is invalid.', 500);
}
