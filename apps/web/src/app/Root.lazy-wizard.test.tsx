import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// One entry keeps Vitest's externalized router contexts consistent. The real
// application's /dom (flushSync) wiring is covered by App.router.test.tsx.
import { createMemoryRouter, RouterProvider } from 'react-router';

const state = vi.hoisted(() => {
  let releaseModule!: () => void;
  const moduleReady = new Promise<void>((resolve) => {
    releaseModule = resolve;
  });
  return {
    auth: { user: { id: 'customer-a' } as { id: string } | null },
    listeners: new Set<() => void>(),
    moduleLoads: 0,
    instances: 0,
    failRender: false,
    moduleReady,
    releaseModule,
  };
});

vi.mock('../lib/auth-provider', () => ({
  useAuth: () =>
    useSyncExternalStore(
      (listener) => {
        state.listeners.add(listener);
        return () => {
          state.listeners.delete(listener);
        };
      },
      () => state.auth,
    ),
}));
vi.mock('./context/EcosystemContext', () => ({
  EcosystemProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('./components/ds/Snackbar', () => ({ Snackbar: () => null }));
vi.mock('./components/auth/AuthSessionNotice', () => ({ AuthSessionNotice: () => null }));
vi.mock('./components/wizard/JobWizardModal', async () => {
  state.moduleLoads++;
  await state.moduleReady;
  return {
    JobWizardModal: function WizardProbe({
      isOpen,
      onClose,
      service,
      categoryId,
    }: {
      isOpen: boolean;
      onClose: () => void;
      service: string;
      categoryId: string | null;
    }) {
      const [instance] = useState(() => ++state.instances);
      const [draft, setDraft] = useState('');
      if (state.failRender) throw new Error('private module diagnostic');
      return (
        <section
          data-testid="wizard-probe"
          data-open={isOpen}
          data-instance={instance}
          hidden={!isOpen}
        >
          <p>
            {service}|{categoryId}
          </p>
          <input
            aria-label="Request draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button onClick={onClose}>Close request form</button>
        </section>
      );
    },
  };
});

import { Root, useRootContext } from './Root';

function HomeProbe() {
  const { openWizard } = useRootContext();
  return (
    <>
      <h1>Seeker page remains usable</h1>
      <button onClick={() => openWizard('Plumbing', 'cat-plumbing')}>Open request form</button>
    </>
  );
}
function changeIdentity(id: string | null) {
  act(() => {
    state.auth = { user: id ? { id } : null };
    for (const listener of state.listeners) listener();
  });
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Root request form deferred lifetime', () => {
  it('imports only on intent, permits dismissal during loading, and isolates retained form state by identity', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    const router = createMemoryRouter(
      [{ Component: Root, children: [{ path: '/home', Component: HomeProbe }] }],
      { initialEntries: ['/home'] },
    );
    try {
      render(<RouterProvider router={router} />);
      expect(screen.getByRole('heading', { name: 'Seeker page remains usable' })).toBeVisible();
      expect(state.moduleLoads).toBe(0);
      expect(screen.queryByTestId('wizard-probe')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Open request form' }));
      expect(await screen.findByRole('status')).toHaveTextContent('جارٍ تحميل نموذج الطلب…');
      await waitFor(() => expect(state.moduleLoads).toBe(1));
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'إغلاق', exact: true }));
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByRole('button', { name: 'Open request form' })).toBeEnabled();

      await act(async () => {
        state.releaseModule();
        await state.moduleReady;
      });
      const firstWizard = await screen.findByTestId('wizard-probe');
      expect(firstWizard).toHaveAttribute('data-open', 'false');
      expect(firstWizard).not.toBeVisible();

      fireEvent.click(screen.getByRole('button', { name: 'Open request form' }));
      expect(firstWizard).toBeVisible();
      expect(firstWizard).toHaveTextContent('Plumbing|cat-plumbing');
      fireEvent.change(screen.getByRole('textbox', { name: 'Request draft' }), {
        target: { value: 'account A private draft' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Close request form' }));
      fireEvent.click(screen.getByRole('button', { name: 'Open request form' }));
      expect(screen.getByTestId('wizard-probe')).toBe(firstWizard);
      expect(screen.getByRole('textbox', { name: 'Request draft' })).toHaveValue(
        'account A private draft',
      );
      expect(state.moduleLoads).toBe(1);

      changeIdentity('customer-b');
      expect(screen.queryByTestId('wizard-probe')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Open request form' }));
      const secondWizard = await screen.findByTestId('wizard-probe');
      expect(secondWizard).not.toBe(firstWizard);
      expect(screen.getByRole('textbox', { name: 'Request draft' })).toHaveValue('');
      expect(state.moduleLoads).toBe(1);

      // Rejections and render failures use the same boundary recovery. The
      // lazy-page suite separately supplies an actual rejected import promise.
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {});
      state.failRender = true;
      changeIdentity('customer-b');
      expect(await screen.findByRole('alert')).toHaveTextContent('تعذّر تحميل نموذج الطلب');
      expect(screen.queryByText('private module diagnostic')).toBeNull();
      expect(screen.getByRole('button', { name: 'إعادة تحميل الصفحة', exact: true })).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'إغلاق', exact: true }));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('button', { name: 'Open request form' })).toBeEnabled();
      expect(diagnostics).toHaveBeenCalled();

      changeIdentity(null);
      expect(screen.queryByTestId('wizard-probe')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      router.dispose();
    }
  });
});
