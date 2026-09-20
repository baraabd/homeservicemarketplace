import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../../lib/api';
import { usePrivateDraft } from '../workspace/usePrivateDraft';
import type { DisputeDraftView } from '@homeservicemarketplace/contracts';
const initial: DisputeDraftView = {
  version: 0,
  content: { issueCode: '', requestedOutcome: '', statement: '', step: 0 },
  savedAt: null,
  expiresAt: null,
};
let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  mock.restore();
  vi.useRealTimers();
});
const path = '/v1/me/disputes/drafts/booking-1';
function respond() {
  mock.onPost(path).reply((request) => {
    const p = JSON.parse(request.data);
    return [
      200,
      {
        version: p.version + 1,
        content: p.content,
        savedAt: '2026-09-20T10:00:00Z',
        expiresAt: '2026-09-21T10:00:00Z',
      },
    ];
  });
}
describe('Private draft real API-client integration', () => {
  it('debounces edits then POSTs to the declared controller route without browser persistence', async () => {
    respond();
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const { result, rerender } = renderHook(
      ({ statement }) =>
        usePrivateDraft('booking-1', initial, { ...initial.content, statement }, false),
      { initialProps: { statement: '' } },
    );
    rerender({ statement: 'Private draft sentence' });
    expect(result.current.state).toBe('dirty');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(599);
    });
    expect(mock.history.post).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.state).toBe('saved');
    expect(JSON.parse(mock.history.post[0].data)).toEqual({
      version: 0,
      content: { ...initial.content, statement: 'Private draft sentence' },
    });
    expect(mock.history.put).toHaveLength(0);
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });
  it('keeps input unsaved after transport failure until a deliberate retry', async () => {
    mock.onPost(path).networkError();
    const { result } = renderHook(() =>
      usePrivateDraft(
        'booking-1',
        initial,
        { ...initial.content, statement: 'My local private draft' },
        false,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.state).toBe('error');
    expect(result.current.unsaved).toBe(true);
    respond();
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.state).toBe('saved');
    expect(mock.history.post).toHaveLength(2);
    expect(mock.history.post[0].data).toBe(mock.history.post[1].data);
  });
  it('cancels pending autosave after authority is lost and on unmount', async () => {
    respond();
    const { result, rerender, unmount } = renderHook(
      ({ paused }) =>
        usePrivateDraft(
          'booking-1',
          initial,
          { ...initial.content, statement: 'Private draft' },
          paused,
        ),
      { initialProps: { paused: false } },
    );
    rerender({ paused: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mock.history.post).toHaveLength(0);
    expect(await result.current.flush()).toBe(false);
    rerender({ paused: false });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mock.history.post).toHaveLength(0);
  });
});
