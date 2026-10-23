import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useManualPaymentResource } from './useManualPaymentResource';

describe('R30 private resource isolation', () => {
  it('discards a late response for the previous obligation and aborts its request', async () => {
    let resolveFirst!: (value: string) => void;
    let signalFirst!: AbortSignal;
    const first = vi.fn((signal: AbortSignal) => {
      signalFirst = signal;
      return new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });
    });
    const second = vi.fn(async () => 'second obligation');
    const view = renderHook(({ key, load }) => useManualPaymentResource(key, load), {
      initialProps: { key: 'first', load: first },
    });
    view.rerender({ key: 'second', load: second });
    await waitFor(() => expect(view.result.current.data).toBe('second obligation'));
    await act(async () => {
      resolveFirst('private first receipt');
    });
    expect(view.result.current.data).toBe('second obligation');
    expect(signalFirst.aborted).toBe(true);
  });
  it('clears previously loaded data on a failed refresh', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce('review notes')
      .mockRejectedValueOnce({ response: { status: 403 } });
    const view = renderHook(() => useManualPaymentResource('one', load));
    await waitFor(() => expect(view.result.current.data).toBe('review notes'));
    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.error).not.toBeNull());
    expect(view.result.current.data).toBeNull();
  });
  it('hides private data immediately during refresh and ignores a mutation from the previous view', async () => {
    let complete!: (value: string) => void;
    const load = vi
      .fn()
      .mockResolvedValueOnce('old private note')
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            complete = resolve;
          }),
      );
    const view = renderHook(() => useManualPaymentResource('one', load));
    await waitFor(() => expect(view.result.current.data).toBe('old private note'));
    const obsoleteAccept = view.result.current.accept;
    act(() => view.result.current.refresh());
    expect(view.result.current.loading).toBe(true);
    expect(view.result.current.data).toBeNull();
    act(() => obsoleteAccept('outdated mutation response'));
    expect(view.result.current.data).toBeNull();
    await act(async () => complete('refreshed private note'));
    expect(view.result.current.data).toBe('refreshed private note');
  });
  it('removes resident private metadata on session expiration', async () => {
    const load = vi.fn(async () => 'private metadata');
    const view = renderHook(() => useManualPaymentResource('one', load));
    await waitFor(() => expect(view.result.current.data).toBe('private metadata'));
    act(() => window.dispatchEvent(new Event('auth:session-expired')));
    expect(view.result.current.data).toBeNull();
    expect(view.result.current.error).toEqual({ response: { status: 401 } });
    act(() => view.result.current.accept('late mutation response'));
    expect(view.result.current.data).toBeNull();
  });
  it('cannot repopulate metadata with an in-flight response after session expiry', async () => {
    let complete!: (value: string) => void;
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    );
    const view = renderHook(() => useManualPaymentResource('one', load));
    act(() => window.dispatchEvent(new Event('auth:session-expired')));
    await act(async () => complete('private notes'));
    expect(view.result.current.data).toBeNull();
  });
});
