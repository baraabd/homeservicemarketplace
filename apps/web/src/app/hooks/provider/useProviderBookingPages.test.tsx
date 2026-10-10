import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { api } from '../../../lib/api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';
import { flattenBookingPages, useProviderBookingPages } from './useProviderBookings';

// R17-E closure — the cursor walk behind the bookings list: one list per
// filter, and a refetch that re-derives every cursor from fresh pages.

const item = (id: string, status = 'SCHEDULED') => ({ id, status });
const sent = (mock: MockAdapter) =>
  mock.history.get.map((r) => {
    const p = r.params as { status?: string; cursor?: string };
    return `${p.status ?? '-'}:${p.cursor ?? '-'}`;
  });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let mock: MockAdapter;
let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
beforeEach(() => {
  mock = new MockAdapter(api);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => mock.restore());

describe('useProviderBookingPages', () => {
  it('a filter change mid-page starts its own list; the late page stays with its filter', async () => {
    const late = deferred<[number, unknown]>();
    mock.onGet('/v1/provider/bookings').reply((config) => {
      const { status, cursor } = config.params as { status?: string; cursor?: string };
      if (status === 'SCHEDULED' && !cursor)
        return [200, { items: [item('s1'), item('s2')], nextCursor: 's2' }];
      if (status === 'SCHEDULED') return late.promise;
      return [200, { items: [item('c1', 'COMPLETED')], nextCursor: null }];
    });
    const { result, rerender } = renderHook(
      ({ status }: { status: 'SCHEDULED' | 'COMPLETED' }) => useProviderBookingPages({ status }),
      { wrapper, initialProps: { status: 'SCHEDULED' } },
    );
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    act(() => void result.current.fetchNextPage());
    await waitFor(() => expect(sent(mock)).toContain('SCHEDULED:s2'));

    rerender({ status: 'COMPLETED' });
    await waitFor(() =>
      expect(flattenBookingPages(result.current.data?.pages).map((b) => b.id)).toEqual(['c1']),
    );
    await act(async () => late.resolve([200, { items: [item('s3')], nextCursor: null }]));
    // The abandoned SCHEDULED page was cancelled with its last observer: it
    // reached neither list.
    expect(flattenBookingPages(result.current.data?.pages).map((b) => b.id)).toEqual(['c1']);
    expect(
      qc
        .getQueryData<{
          pages: { items: { id: string }[] }[];
        }>(providerQueryKeys.bookings.pages({ status: 'SCHEDULED' }))
        ?.pages.flatMap((p) => p.items.map((i) => i.id)),
    ).toEqual(['s1', 's2']);
  });

  it('a transition invalidation re-walks every loaded page from fresh cursors', async () => {
    // Before: [b1 b2] [b3]. After a booking lands on top: [b0 b1] [b2 b3].
    let after = false;
    mock.onGet('/v1/provider/bookings').reply((config) => {
      const { cursor } = config.params as { cursor?: string };
      if (!after)
        return cursor
          ? [200, { items: [item('b3')], nextCursor: null }]
          : [200, { items: [item('b1'), item('b2')], nextCursor: 'b2' }];
      return cursor === 'b1'
        ? [200, { items: [item('b2'), item('b3')], nextCursor: null }]
        : [200, { items: [item('b0'), item('b1')], nextCursor: 'b1' }];
    });
    const { result } = renderHook(() => useProviderBookingPages(), { wrapper });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    act(() => void result.current.fetchNextPage());
    await waitFor(() =>
      expect(flattenBookingPages(result.current.data?.pages).map((b) => b.id)).toEqual([
        'b1',
        'b2',
        'b3',
      ]),
    );

    after = true;
    await act(async () => qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root }));
    await waitFor(() =>
      expect(flattenBookingPages(result.current.data?.pages).map((b) => b.id)).toEqual([
        'b0',
        'b1',
        'b2',
        'b3',
      ]),
    );
    // The second page was asked for with the FRESH first page's cursor.
    expect(sent(mock).slice(-2)).toEqual(['-:-', '-:b1']);
  });
});
