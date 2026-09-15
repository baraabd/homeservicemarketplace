import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useAdminHeaderOffset } from './useAdminHeaderOffset';

function Shell() {
  const { shellRef, headerRef } = useAdminHeaderOffset();
  return (
    <div ref={shellRef} data-testid="shell">
      <header ref={headerRef}>Admin header</header>
      <main>Review</main>
    </div>
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('tracks header wrapping and releases its observer and offset on unmount', () => {
  let height = 80;
  let changed: ResizeObserverCallback | undefined;
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ height }) as DOMRect,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        changed = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const view = render(<Shell />);
  const shell = screen.getByTestId('shell');
  expect(shell.style.getPropertyValue('--admin-header-offset')).toBe('96px');
  height = 124;
  act(() => changed?.([], {} as ResizeObserver));
  expect(shell.style.getPropertyValue('--admin-header-offset')).toBe('140px');
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(shell.style.getPropertyValue('--admin-header-offset')).toBe('');
});
