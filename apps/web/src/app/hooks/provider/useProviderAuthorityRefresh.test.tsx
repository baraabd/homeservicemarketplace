import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import {
  dropWithdrawnReads,
  isProviderAuthorityLoss,
  useProviderAuthorityRefresh,
} from './useProviderAuthorityRefresh';

// R17-E (E-5) — an open workspace follows the server's authority decision.

const forbidden = (url: string) => ({ response: { status: 403 }, config: { url } });

describe('isProviderAuthorityLoss', () => {
  it.each([
    '/v1/provider/available-requests',
    '/v1/provider/bookings/bk-1/start',
    '/v1/me/provider/jobs/available',
  ])('a 403 from %s means the decision changed', (url) => {
    expect(isProviderAuthorityLoss(forbidden(url))).toBe(true);
  });

  it('ignores the capability endpoint itself, other statuses and other surfaces', () => {
    expect(isProviderAuthorityLoss(forbidden('/v1/me/provider/capabilities'))).toBe(false);
    expect(
      isProviderAuthorityLoss({ response: { status: 409 }, config: { url: '/v1/provider/bids' } }),
    ).toBe(false);
    expect(isProviderAuthorityLoss(forbidden('/v1/admin/settings'))).toBe(false);
    expect(isProviderAuthorityLoss(null)).toBe(false);
  });
});

describe('dropWithdrawnReads', () => {
  it('drops exactly the data a withdrawn capability was the only reader of', () => {
    const qc = new QueryClient();
    qc.setQueryData(providerQueryKeys.availableRequests.list(), { items: [1] });
    qc.setQueryData(providerQueryKeys.bookings.list(), { items: [2] });
    qc.setQueryData(providerQueryKeys.wallet.summary(), { x: 1 });
    dropWithdrawnReads(
      qc,
      ['VIEW_MARKETPLACE', 'SUBMIT_BID', 'MANAGE_BOOKINGS', 'VIEW_EARNINGS'],
      ['MANAGE_BOOKINGS', 'VIEW_EARNINGS'],
    );
    expect(qc.getQueryData(providerQueryKeys.availableRequests.list())).toBeUndefined();
    // RESTRICTED keeps its existing obligations and their history.
    expect(qc.getQueryData(providerQueryKeys.bookings.list())).toEqual({ items: [2] });
    expect(qc.getQueryData(providerQueryKeys.wallet.summary())).toEqual({ x: 1 });
  });
});

describe('useProviderAuthorityRefresh', () => {
  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return { qc, spy, wrapper };
  }

  it('a provider query answered 403 re-asks for capabilities at once', async () => {
    const { qc, spy, wrapper } = setup();
    renderHook(() => useProviderAuthorityRefresh(['VIEW_MARKETPLACE']), { wrapper });
    await qc
      .fetchQuery({
        queryKey: providerQueryKeys.availableRequests.list(),
        queryFn: () => Promise.reject(forbidden('/v1/provider/available-requests')),
      })
      .catch(() => undefined);
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: providerQueryKeys.capabilities.get() }),
    );
  });

  it('a provider mutation answered 403 re-asks too', async () => {
    const { qc, spy, wrapper } = setup();
    renderHook(() => useProviderAuthorityRefresh(['MANAGE_BOOKINGS']), { wrapper });
    await qc
      .getMutationCache()
      .build(qc, {
        mutationFn: () => Promise.reject(forbidden('/v1/provider/bookings/bk-1/start')),
      })
      .execute(undefined)
      .catch(() => undefined);
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: providerQueryKeys.capabilities.get() }),
    );
  });

  it('drops marketplace reads when a refetched decision withdraws them', () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(providerQueryKeys.availableRequests.list(), { items: [1] });
    const { rerender } = renderHook(({ allowed }) => useProviderAuthorityRefresh(allowed), {
      wrapper,
      initialProps: { allowed: ['VIEW_MARKETPLACE', 'MANAGE_BOOKINGS'] as never[] },
    });
    rerender({ allowed: ['MANAGE_BOOKINGS'] as never[] });
    expect(qc.getQueryData(providerQueryKeys.availableRequests.list())).toBeUndefined();
  });
});
