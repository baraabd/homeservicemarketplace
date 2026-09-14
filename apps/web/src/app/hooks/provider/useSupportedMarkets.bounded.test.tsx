import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';

import { api } from '../../../lib/api';
import { useSupportedMarkets } from './useSupportedMarkets';

// Sprint 09B.29 — the repeated markets request, bounded.
//
// Reported from manual testing: the console filled with the same
// `GET /v1/me/provider/onboarding/markets` → 404, over and over. The 404 itself
// was a stale API build — the route entered the repository on 2026-09-11 and the
// container serving the developer's browser was built on 2026-08-30 — but a
// permanent failure repeating without limit is a client defect in its own right.
// It buries the one console line that names the cause.
//
// These tests pin the boundary: a 4xx is asked once and never again, including
// across a remount, while a transient failure keeps its retry.

const MARKETS = /\/v1\/me\/provider\/onboarding\/markets/;

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
});

/** A fresh client per render, so one test cannot warm another's cache. */
function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
}

describe('the supported-markets query, when the answer will not change', () => {
  it('asks ONCE for a 404 — a missing route does not appear by asking again', async () => {
    mock.onGet(MARKETS).reply(404, { success: false, error: { code: 'NOT_FOUND' } });
    const client = newClient();

    const { result } = renderHook(() => useSupportedMarkets(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mock.history.get.filter((c) => MARKETS.test(c.url ?? ''))).toHaveLength(1);
  });

  it('does not ask again when the screen is remounted', async () => {
    // Every trip between the hub and the work area remounted this hook, and
    // React Query re-attempts a failed query on mount by default. That is what
    // turned one missing route into an endless column of identical errors.
    mock.onGet(MARKETS).reply(404, { success: false, error: { code: 'NOT_FOUND' } });
    const client = newClient();

    const first = renderHook(() => useSupportedMarkets(), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.isError).toBe(true));
    first.unmount();

    const second = renderHook(() => useSupportedMarkets(), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.isError).toBe(true));

    expect(mock.history.get.filter((c) => MARKETS.test(c.url ?? ''))).toHaveLength(1);
  });

  it('asks once for a 403 too — a refusal is not a transient fault', async () => {
    mock.onGet(MARKETS).reply(403, { success: false, error: { code: 'FORBIDDEN' } });
    const client = newClient();

    const { result } = renderHook(() => useSupportedMarkets(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mock.history.get.filter((c) => MARKETS.test(c.url ?? ''))).toHaveLength(1);
  });

  it('STILL retries a 500, because that one might succeed', async () => {
    // The bound must not become "never retry". A server that failed once is a
    // different claim from a route that does not exist, and collapsing them
    // would make the screen give up on a blip.
    mock.onGet(MARKETS).reply(500, { success: false, error: { code: 'INTERNAL' } });
    const client = newClient();

    const { result } = renderHook(() => useSupportedMarkets(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mock.history.get.filter((c) => MARKETS.test(c.url ?? ''))).toHaveLength(2);
  });

  it('never turns a missing route into an empty list of markets', async () => {
    // The tempting "fix" for this symptom is to swallow the 404 and report no
    // markets. That reads as "the operator has opened none" — a lie that would
    // send the provider to a dead end with no error at all.
    mock.onGet(MARKETS).reply(404, { success: false, error: { code: 'NOT_FOUND' } });
    const client = newClient();

    const { result } = renderHook(() => useSupportedMarkets(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });
});
