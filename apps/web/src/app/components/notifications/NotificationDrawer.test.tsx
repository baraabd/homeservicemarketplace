import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationDrawer } from './NotificationDrawer';

const props = () => ({
  notifications: [], onClose: vi.fn(), onMarkAllRead: vi.fn(),
  onMarkRead: vi.fn(), onOpenSettings: vi.fn(),
});

describe('closed notification drawer accessibility', () => {
  it('does not expose hidden Settings alongside the visible profile action', () => {
    render(<><button>Settings</button><NotificationDrawer {...props()} isOpen={false} /></>);
    const drawer = screen.getByTestId('notification-drawer');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(drawer).toHaveAttribute('inert');
    expect(within(drawer).queryByRole('button', { name: 'Settings', exact: true })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Settings', exact: true })).toHaveLength(1);
  });

  it('restores real controls only while open and removes them again on close', () => {
    const handlers = props();
    const view = render(<NotificationDrawer {...handlers} isOpen={false} />);
    view.rerender(<NotificationDrawer {...handlers} isOpen />);
    const drawer = screen.getByTestId('notification-drawer');
    expect(drawer).not.toHaveAttribute('inert');
    expect(drawer).toHaveAttribute('aria-hidden', 'false');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Settings', exact: true }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
    view.rerender(<NotificationDrawer {...handlers} isOpen={false} />);
    expect(drawer).toHaveAttribute('inert');
    expect(within(drawer).queryByRole('button', { name: 'Settings', exact: true })).toBeNull();
  });
});
