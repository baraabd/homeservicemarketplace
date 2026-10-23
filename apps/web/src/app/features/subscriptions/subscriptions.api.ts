import type {
  MoneyMyPlanWireV1,
  MoneyPlanCatalogWireV1,
  MoneySubscriptionPageWireV1,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';

// Scope every private cache entry to the authenticated account. The existing
// auth boundary cancels in-flight requests and removes these on sign-out.
export const subscriptionQueryKeys = {
  root: (userId: string) => ['provider', 'subscriptions', userId] as const,
  myPlan: (userId: string, subscriptionId?: string) =>
    [...subscriptionQueryKeys.root(userId), 'my-plan', subscriptionId ?? null] as const,
  purchases: (userId: string) => [...subscriptionQueryKeys.root(userId), 'purchases'] as const,
  plans: (userId: string) => [...subscriptionQueryKeys.root(userId), 'catalog'] as const,
};

export async function getMyPlan(
  subscriptionId?: string,
  signal?: AbortSignal,
): Promise<MoneyMyPlanWireV1> {
  const response = await api.get<MoneyMyPlanWireV1>('/v1/money/my-plan', {
    params: subscriptionId ? { subscriptionId } : undefined,
    signal,
  });
  return response.data;
}

export async function getSubscriptionPage(
  cursor?: string,
  signal?: AbortSignal,
): Promise<MoneySubscriptionPageWireV1> {
  const response = await api.get<MoneySubscriptionPageWireV1>('/v1/money/subscriptions', {
    params: { limit: 20, ...(cursor ? { cursor } : {}) },
    signal,
  });
  return response.data;
}

export async function getPlanCatalog(
  cursor?: string,
  signal?: AbortSignal,
): Promise<MoneyPlanCatalogWireV1> {
  const response = await api.get<MoneyPlanCatalogWireV1>('/v1/money/plans', {
    params: { limit: 20, ...(cursor ? { cursor } : {}) },
    signal,
  });
  return response.data;
}

export function subscriptionErrorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}
