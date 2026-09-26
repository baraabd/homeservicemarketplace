import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import type { AdminPortfolioItem } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { usePrivatePortfolioImage } from '../evidence/usePrivatePortfolioImage';

const item: AdminPortfolioItem = {
  id: 'photo', title: null, description: null, serviceCategoryId: null, position: 0,
  moderationState: 'PENDING', moderationReason: null, revision: 1,
  media: { url: '/unused-public-url', contentType: 'image/png' },
  createdAt: '2026-09-26T00:00:00Z', updatedAt: '2026-09-26T00:00:00Z', moderatedAt: null,
  reviewBlockedReason: null, availableActions: ['APPROVE', 'REJECT'], history: [],
};
const PATH = '/v1/admin/providers/provider/portfolio/photo/media';
let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:review-only');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { mock.restore(); vi.unstubAllGlobals(); });

describe('private portfolio media recovery', () => {
  it('does not fetch unselected items or use public metadata URLs', () => {
    renderHook(() => usePrivatePortfolioImage('provider', null, 1));
    expect(mock.history.get).toHaveLength(0);
  });
  it('recovers a failed read only through an explicit fresh authenticated attempt', async () => {
    mock.onGet(PATH).replyOnce(503, {}).onGet(PATH).reply(200, new Blob(['fixture'], { type: 'image/png; charset=binary' }));
    const hook = renderHook(({ attempt }) => usePrivatePortfolioImage('provider', item, attempt), { initialProps: { attempt: 1 } });
    await waitFor(() => expect(hook.result.current?.failed).toBe(true));
    hook.rerender({ attempt: 2 });
    expect(hook.result.current?.url).toBeUndefined();
    await waitFor(() => expect(hook.result.current?.url).toBe('blob:review-only'));
    expect(mock.history.get.map((request) => request.url)).toEqual([PATH, PATH]);
    expect(api.defaults.withCredentials).toBe(true);
    hook.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:review-only');
  });
  it('revokes resident bytes immediately when the session expires', async () => {
    mock.onGet(PATH).reply(200, new Blob(['fixture'], { type: 'image/png' }));
    const hook = renderHook(() => usePrivatePortfolioImage('provider', item, 1));
    await waitFor(() => expect(hook.result.current?.url).toBe('blob:review-only'));
    act(() => { window.dispatchEvent(new Event('auth:session-expired')); });
    expect(hook.result.current?.url).toBeUndefined();
    expect(hook.result.current?.failed).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:review-only');
  });
  it.each(['text/html', 'image/svg+xml', 'application/json'])('refuses active or unexpected response type %s', async (type) => {
    mock.onGet(PATH).reply(200, new Blob(['fixture'], { type }));
    const hook = renderHook(() => usePrivatePortfolioImage('provider', item, 1));
    await waitFor(() => expect(hook.result.current?.failed).toBe(true));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('never exposes an old provider preview while the next provider is loading', async () => {
    mock.onGet(PATH).reply(200, new Blob(['fixture'], { type: 'image/png' }));
    mock.onGet('/v1/admin/providers/other/portfolio/photo/media').reply(404, {});
    const hook = renderHook(({ provider }) => usePrivatePortfolioImage(provider, item, 1), { initialProps: { provider: 'provider' } });
    await waitFor(() => expect(hook.result.current?.url).toBe('blob:review-only'));
    hook.rerender({ provider: 'other' });
    expect(hook.result.current?.url).toBeUndefined();
    await waitFor(() => expect(hook.result.current?.failed).toBe(true));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:review-only');
  });
});
