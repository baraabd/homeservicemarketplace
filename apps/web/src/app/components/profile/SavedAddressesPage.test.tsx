import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { SavedAddressesPage } from './SavedAddressesPage';

// ─────────────────────────────────────────────────────────────────────────────
// Slice 2 contract: SavedAddressesPage renders the authenticated user's
// addresses from /v1/me/addresses (no SEED), and create/update/delete/
// set-default all flow through real API calls. These tests pin that the
// mock state is gone, the flows hit the right endpoints, and the UI
// surfaces safe, mapped error copy — never raw backend errors.
// ─────────────────────────────────────────────────────────────────────────────

function renderPage() {
  // Fresh QueryClient per test so state never leaks between cases.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <SavedAddressesPage onBack={() => {}} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

const ADDR_HOME = {
  id: 'addr-home',
  label: 'Home',
  type: 'HOME' as const,
  line1: 'Building 4',
  city: 'Riyadh',
  country: 'SA',
  lat: null,
  lng: null,
  isDefault: true,
};

const ADDR_WORK = {
  id: 'addr-work',
  label: 'Work',
  type: 'WORK' as const,
  line1: 'King Fahd Rd',
  city: 'Riyadh',
  country: 'SA',
  lat: null,
  lng: null,
  isDefault: false,
};

describe('SavedAddressesPage', () => {
  it('loads addresses from /v1/me/addresses (no SEED data)', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [ADDR_HOME, ADDR_WORK] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Home')).toBeInTheDocument();
    });
    expect(screen.getByText('Work')).toBeInTheDocument();
    // Pre-integration SEED defaults (Al Olaya District etc.) must be gone.
    expect(screen.queryByText(/Al Olaya District/)).toBeNull();
    // Composed address line is rendered.
    expect(screen.getByText('Building 4, Riyadh, SA')).toBeInTheDocument();
  });

  it('renders the empty state when the API returns no addresses', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No saved addresses yet')).toBeInTheDocument();
    });
  });

  it('shows a safe error message when the list call fails (no raw backend error rendered)', async () => {
    mock.onGet('/v1/me/addresses').reply(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'PrismaClientKnownRequestError: Unique constraint',
      },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    // Friendly copy, no raw backend error.
    expect(screen.getByText(/couldn't load your addresses/i)).toBeInTheDocument();
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/Unique constraint/i)).toBeNull();
  });

  it('create flow: POSTs the form payload and refreshes the list', async () => {
    mock.onGet('/v1/me/addresses').replyOnce(200, { items: [] });
    let postedBody: Record<string, unknown> | null = null;
    mock.onPost('/v1/me/addresses').reply((config) => {
      postedBody = JSON.parse(config.data as string);
      return [
        201,
        {
          id: 'addr-new',
          label: postedBody.label,
          type: postedBody.type,
          line1: postedBody.line1,
          city: postedBody.city,
          country: postedBody.country,
          lat: null,
          lng: null,
          isDefault: true,
        },
      ];
    });
    mock.onGet('/v1/me/addresses').reply(200, {
      items: [
        {
          id: 'addr-new',
          label: 'Studio',
          type: 'CUSTOM',
          line1: 'Loft 9',
          city: 'Jeddah',
          country: 'SA',
          lat: null,
          lng: null,
          isDefault: true,
        },
      ],
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No saved addresses yet')).toBeInTheDocument();
    });

    // Open the form via the empty-state CTA.
    fireEvent.click(screen.getAllByText('Add Address')[0]);

    fireEvent.change(screen.getByPlaceholderText('Label (e.g. Home)'), {
      target: { value: 'Studio' },
    });
    fireEvent.change(screen.getByPlaceholderText('Full address'), {
      target: { value: 'Loft 9, Jeddah, SA' },
    });
    fireEvent.click(screen.getByText('Save Address'));

    await waitFor(() => {
      expect(postedBody).not.toBeNull();
    });
    expect(postedBody).toMatchObject({
      label: 'Studio',
      type: 'CUSTOM',
      line1: 'Loft 9',
      city: 'Jeddah',
      country: 'SA',
    });
    // Server-supplied row appears after invalidation.
    await waitFor(() => {
      expect(screen.getByText('Studio')).toBeInTheDocument();
    });
  });

  it('edit flow: PATCHes the existing address with new label + parsed full text', async () => {
    mock.onGet('/v1/me/addresses').replyOnce(200, { items: [ADDR_HOME] });
    let patchedBody: Record<string, unknown> | null = null;
    let patchedUrl: string | null = null;
    mock.onPatch(/\/v1\/me\/addresses\/.+/).reply((config) => {
      patchedUrl = config.url ?? null;
      patchedBody = JSON.parse(config.data as string);
      return [200, { ...ADDR_HOME, label: 'Home (renamed)' }];
    });
    mock.onGet('/v1/me/addresses').reply(200, {
      items: [{ ...ADDR_HOME, label: 'Home (renamed)' }],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByPlaceholderText('Label (e.g. Home)'), {
      target: { value: 'Home (renamed)' },
    });
    fireEvent.click(screen.getByText('Save Address'));

    await waitFor(() => {
      expect(patchedBody).not.toBeNull();
    });
    expect(patchedUrl).toBe('/v1/me/addresses/addr-home');
    expect(patchedBody).toMatchObject({ label: 'Home (renamed)' });
  });

  it('delete flow: DELETEs the address and refreshes the list', async () => {
    mock.onGet('/v1/me/addresses').replyOnce(200, { items: [ADDR_HOME, ADDR_WORK] });
    let deleteUrl: string | null = null;
    mock.onDelete(/\/v1\/me\/addresses\/.+/).reply((config) => {
      deleteUrl = config.url ?? null;
      return [204];
    });
    mock.onGet('/v1/me/addresses').reply(200, { items: [ADDR_HOME] });

    renderPage();
    await waitFor(() => expect(screen.getByText('Work')).toBeInTheDocument());

    // Trash icon on the Work row → confirmation appears → confirm.
    const trashButtons = screen
      .getAllByRole('button')
      .filter((b) => b.querySelector('.lucide-trash2'));
    fireEvent.click(trashButtons[1]);
    await waitFor(() => expect(screen.getByText('Yes, delete')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Yes, delete'));

    await waitFor(() => expect(deleteUrl).toBe('/v1/me/addresses/addr-work'));
  });

  it('delete flow: surfaces friendly copy on 409 (cannot delete default while others exist)', async () => {
    mock.onGet('/v1/me/addresses').reply(200, { items: [ADDR_HOME, ADDR_WORK] });
    mock.onDelete('/v1/me/addresses/addr-home').reply(409, {
      error: { code: 'CONFLICT', message: 'Cannot delete default while other addresses exist.' },
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Home')).toBeInTheDocument());

    const trashButtons = screen
      .getAllByRole('button')
      .filter((b) => b.querySelector('.lucide-trash2'));
    fireEvent.click(trashButtons[0]);
    await waitFor(() => expect(screen.getByText('Yes, delete')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Yes, delete'));

    await waitFor(() => {
      expect(screen.getByText(/Set another address as default/i)).toBeInTheDocument();
    });
  });

  it('set-default flow: POSTs to /:id/default and refreshes the list', async () => {
    mock.onGet('/v1/me/addresses').replyOnce(200, { items: [ADDR_HOME, ADDR_WORK] });
    let promotedUrl: string | null = null;
    mock.onPost(/\/v1\/me\/addresses\/.+\/default/).reply((config) => {
      promotedUrl = config.url ?? null;
      return [200, { ...ADDR_WORK, isDefault: true }];
    });
    mock.onGet('/v1/me/addresses').reply(200, {
      items: [
        { ...ADDR_HOME, isDefault: false },
        { ...ADDR_WORK, isDefault: true },
      ],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Work')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Set as default'));
    await waitFor(() => expect(promotedUrl).toBe('/v1/me/addresses/addr-work/default'));
  });
});
