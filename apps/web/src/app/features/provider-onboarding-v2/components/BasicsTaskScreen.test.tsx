import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { BasicsTaskScreen } from './BasicsTaskScreen';
import { BASICS_COPY } from '../copy/basics-copy';

// Sprint 9B.17 — V2 Task 1.
//
// The acceptance criteria this file exists to pin, in the order they matter:
//
//   - no image URL input survives anywhere on this screen
//   - no exact address is asked for
//   - phone verification is neither faked nor demanded
//   - individual and business are asked DIFFERENT questions
//   - changing type warns before it changes, and does not claim data is lost

const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/(PROVIDER_TYPE|IDENTITY)/;

const DRAFT = (over: Record<string, unknown> = {}) => ({
  state: 'DRAFT',
  currentStep: 'PROVIDER_TYPE',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP', step: 'PROVIDER_TYPE' },
  complete: false,
  missing: [],
  version: 3,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
  data: {
    providerType: null,
    legalBusinessName: null,
    displayName: 'Pat Provider',
    profileImageUrl: null,
    phoneNumber: null,
    ...((over.data as Record<string, unknown>) ?? {}),
  },
  ...over,
});

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onPatch(PATCH).reply(200, DRAFT());
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
  vi.useRealTimers();
});

function renderScreen(
  view: ReturnType<typeof DRAFT> = DRAFT(),
  lang: 'en' | 'ar' = 'en',
  editable = true,
) {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The autosave hook reads the CURRENT version from the cache rather than
  // from a prop, so that a save started before another write landed still
  // sends the version the client last actually saw. In the app the container
  // fetches the draft into this slot; here the harness seeds it, because
  // without it every save correctly refuses to send an unversioned write.
  client.setQueryData(providerQueryKeys.onboarding.draft(), view);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <BasicsTaskScreen view={view as never} lang={lang} editable={editable} />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('BasicsTaskScreen — what it must NOT ask', () => {
  it('has no image URL input anywhere', async () => {
    renderScreen();
    // The Sprint 8 wizard asked providers to paste a hosted image URL. The
    // acceptance criterion is that nothing like it survives here.
    const inputs = Array.from(document.querySelectorAll('input'));
    for (const input of inputs) {
      expect(input.type).not.toBe('url');
    }
    expect(screen.queryByLabelText(/image url/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/https?:/i)).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/https?:\/\//);
  });

  it('does not ask for an address', async () => {
    renderScreen();
    const text = document.body.textContent ?? '';
    for (const word of [/street/i, /address/i, /postcode/i, /post code/i, /zip/i]) {
      expect(text).not.toMatch(word);
    }
  });
});

describe('BasicsTaskScreen — phone', () => {
  it('collects a number without demanding verification', () => {
    renderScreen();
    // Neither falsely passed nor unsatisfiably required: the note says the
    // number will be confirmed later and that continuing does not need it.
    const note = screen.getByTestId('phone-verification-note');
    expect(note.textContent).toBe(BASICS_COPY.en.phoneNotVerified);
    expect(screen.queryByRole('button', { name: /verify/i })).toBeNull();
  });

  it('rejects a malformed number inline, and does not send it', async () => {
    renderScreen();
    const field = screen.getByTestId('field-phoneNumber');
    fireEvent.change(field, { target: { value: '12345' } });
    fireEvent.blur(field);

    expect(await screen.findByText(BASICS_COPY.en.phoneInvalid)).toBeInTheDocument();
    // A round-trip whose only outcome is a 400 teaches nothing the inline
    // message has not already said.
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.history.patch).toHaveLength(0);
  });

  it('accepts and saves a well-formed international number', async () => {
    renderScreen();
    const field = screen.getByTestId('field-phoneNumber');
    fireEvent.change(field, { target: { value: '+963912345678' } });
    fireEvent.blur(field);

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(body.phoneNumber).toBe('+963912345678');
    // The version handshake travels with every write.
    expect(body.version).toBe(3);
  });
});

describe('BasicsTaskScreen — individual vs business', () => {
  it('does not ask an individual for a business name', () => {
    renderScreen(DRAFT({ data: { providerType: 'INDIVIDUAL' } }));
    expect(screen.queryByTestId('field-legalBusinessName')).toBeNull();
  });

  it('asks a business for one', () => {
    renderScreen(DRAFT({ data: { providerType: 'BUSINESS' } }));
    expect(screen.getByTestId('field-legalBusinessName')).toBeInTheDocument();
  });

  it('saves the first choice immediately, with no dialog', async () => {
    // Choosing on an empty form is not a CHANGE, and a confirmation there is
    // friction for nothing.
    renderScreen();
    fireEvent.click(screen.getByTestId('provider-type-BUSINESS').querySelector('input')!);

    expect(screen.queryByTestId('provider-type-change-dialog')).toBeNull();
    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).providerType).toBe('BUSINESS');
  });

  it('warns before CHANGING an existing type, and does not save until confirmed', async () => {
    renderScreen(DRAFT({ data: { providerType: 'INDIVIDUAL' } }));
    fireEvent.click(screen.getByTestId('provider-type-BUSINESS').querySelector('input')!);

    const dialog = await screen.findByTestId('provider-type-change-dialog');
    expect(dialog).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.history.patch).toHaveLength(0);
  });

  it('promises that nothing already sent is deleted', () => {
    // The consequence a provider actually needs: requirements change, evidence
    // and decisions stay on the record.
    renderScreen(DRAFT({ data: { providerType: 'INDIVIDUAL' } }));
    fireEvent.click(screen.getByTestId('provider-type-BUSINESS').querySelector('input')!);
    expect(screen.getByTestId('provider-type-change-dialog').textContent).toContain(
      'Nothing you have already sent us is deleted',
    );
  });

  it('saves once the change is confirmed', async () => {
    renderScreen(DRAFT({ data: { providerType: 'INDIVIDUAL' } }));
    fireEvent.click(screen.getByTestId('provider-type-BUSINESS').querySelector('input')!);
    fireEvent.click(await screen.findByTestId('provider-type-change-confirm'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).providerType).toBe('BUSINESS');
  });

  it('cancelling leaves the type alone', async () => {
    renderScreen(DRAFT({ data: { providerType: 'INDIVIDUAL' } }));
    fireEvent.click(screen.getByTestId('provider-type-BUSINESS').querySelector('input')!);
    fireEvent.click(await screen.findByTestId('provider-type-change-cancel'));

    expect(screen.queryByTestId('provider-type-change-dialog')).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.history.patch).toHaveLength(0);
  });
});

describe('BasicsTaskScreen — saving', () => {
  it('writes each field to the step that owns it', async () => {
    renderScreen(DRAFT({ data: { providerType: 'BUSINESS' } }));

    fireEvent.change(screen.getByTestId('field-displayName'), { target: { value: 'New Name' } });
    fireEvent.blur(screen.getByTestId('field-displayName'));
    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));

    // displayName belongs to IDENTITY; the server refuses it on any other step.
    expect(mock.history.patch[0].url).toContain('/steps/IDENTITY');

    fireEvent.change(screen.getByTestId('field-legalBusinessName'), { target: { value: 'ACME' } });
    fireEvent.blur(screen.getByTestId('field-legalBusinessName'));
    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(1));
    expect(mock.history.patch[1].url).toContain('/steps/PROVIDER_TYPE');
  });

  it('never sends an empty display name', async () => {
    // The column is NOT NULL, so sending it turns a blank field into an error
    // banner the provider cannot act on.
    renderScreen();
    const field = screen.getByTestId('field-displayName');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.blur(field);

    await new Promise((r) => setTimeout(r, 50));
    expect(mock.history.patch).toHaveLength(0);
  });

  it('shows a truthful failure with a retry, not a silent drop', async () => {
    mock.reset();
    mock.onPatch(PATCH).reply(500);
    renderScreen();

    fireEvent.change(screen.getByTestId('field-displayName'), { target: { value: 'New Name' } });
    fireEvent.blur(screen.getByTestId('field-displayName'));

    const status = await screen.findByTestId('basics-save-status', {}, { timeout: 4000 });
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'error'));
    expect(screen.getByTestId('basics-save-retry')).toBeInTheDocument();
  });

  it('surfaces a conflict as a conflict, not as a generic error', async () => {
    // Another tab won. Telling the provider to "try again" would invite them
    // to overwrite work they have not seen.
    mock.reset();
    mock.onPatch(PATCH).reply(409, { error: { details: { expectedVersion: 9 } } });
    renderScreen();

    fireEvent.change(screen.getByTestId('field-displayName'), { target: { value: 'New Name' } });
    fireEvent.blur(screen.getByTestId('field-displayName'));

    const status = await screen.findByTestId('basics-save-status', {}, { timeout: 4000 });
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'conflict'));
    expect(screen.getByText(BASICS_COPY.en.saveConflict)).toBeInTheDocument();
  });

  it('renders read-only when the server says the application is locked', () => {
    renderScreen(DRAFT(), 'en', false);
    expect(screen.getByTestId('field-displayName')).toBeDisabled();
  });
});

describe('BasicsTaskScreen — Arabic', () => {
  it('renders Arabic copy, not English', () => {
    renderScreen(DRAFT({ data: { providerType: 'BUSINESS' } }), 'ar');

    expect(screen.getByText(BASICS_COPY.ar.typeLegend)).toBeInTheDocument();
    expect(screen.getByText(BASICS_COPY.ar.phoneNotVerified)).toBeInTheDocument();
    expect(screen.queryByText(BASICS_COPY.en.typeLegend)).toBeNull();
  });

  it('warns about a type change in Arabic too', async () => {
    renderScreen(DRAFT({ data: { providerType: 'INDIVIDUAL' } }), 'ar');
    fireEvent.click(screen.getByTestId('provider-type-BUSINESS').querySelector('input')!);

    const dialog = await screen.findByTestId('provider-type-change-dialog');
    expect(dialog.textContent).toContain(BASICS_COPY.ar.typeChangeTitle);
  });
});
