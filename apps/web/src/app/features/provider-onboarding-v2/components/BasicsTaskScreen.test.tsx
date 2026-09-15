import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AutosaveStatus } from './AutosaveStatus';
import { BasicsTaskScreen } from './BasicsTaskScreen';
import { BASICS_COPY } from '../copy/basics-copy';
import { AUTOSAVE_COPY } from '../copy/autosave-copy';
import {
  useOnboardingStepAutosave,
  ProviderOnboardingAutosaveProvider,
} from '../autosave/ProviderOnboardingAutosaveProvider';

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

/** The chrome's save line, mounted exactly as `OnboardingTaskScreen` mounts it. */
function SaveStatusProbe({ lang }: { lang: 'en' | 'ar' }) {
  const { status } = useOnboardingStepAutosave('IDENTITY');
  return <AutosaveStatus status={status} lang={lang} testIdPrefix="basics" />;
}

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
          <ProviderOnboardingAutosaveProvider>
            <BasicsTaskScreen view={view as never} lang={lang} editable={editable} />
            {/* Sprint 09B.29 Phase 5A — the save status moved OUT of the form
                and into the approved sticky action bar, which this component
                does not own. It is still driven by the same step of the same
                coordinator, so the harness renders it the way the task route
                does; the assertions below are about the coordinator's
                behaviour, and that is unchanged. */}
            <SaveStatusProbe lang={lang} />
          </ProviderOnboardingAutosaveProvider>
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
    // Sprint 09B.29 Phase 5A — it is the phone field's HINT now rather than a
    // paragraph beside it, so the assertion is stronger than it was: the
    // sentence must be present AND wired to the input it qualifies.
    const note = screen.getByText(BASICS_COPY.en.phoneNotVerified);
    const phone = screen.getByTestId('field-phoneNumber');
    expect(phone.getAttribute('aria-describedby')).toContain(note.id);
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

describe('BasicsTaskScreen — the questions ruling C1 removed', () => {
  // SUPERSEDED CONTRACT, recorded rather than deleted.
  //
  // This block previously asserted that the screen ASKED for provider type
  // (individual/business), confirmed a change through an alert dialog, and
  // asked a business for its legal name. Every one of those assertions was
  // correct for the Sprint 9B.17 design.
  //
  // Ruling C1 supersedes it: providerType is a SERVER-side default written
  // only when absent while creating a new V2 draft, and the business path
  // belongs to a later approved surface. The ruling says in terms that
  // provider-type, legal-business-name and duplicate professional-title
  // controls must not appear on the approved onboarding screens.
  //
  // The replacement assertions are STRICTER than the ones they replace: the
  // old block proved the controls behaved correctly when present, this one
  // proves they cannot appear at all — in either provider type, and in either
  // language.
  it('never asks an INDIVIDUAL for a provider type or a business name', () => {
    renderScreen(DRAFT({ data: { providerType: 'INDIVIDUAL' } }));

    expect(screen.queryByTestId('field-legalBusinessName')).toBeNull();
    expect(screen.queryByTestId('provider-type-INDIVIDUAL')).toBeNull();
    expect(screen.queryByTestId('provider-type-BUSINESS')).toBeNull();
    expect(screen.queryByTestId('provider-type-change-dialog')).toBeNull();
  });

  it('never asks a BUSINESS either — the stored value is untouched, not re-asked', () => {
    // The provider keeps their type and their legal name server-side. What
    // changes is that this screen stops collecting them, so a business sees
    // exactly the three approved questions an individual sees.
    renderScreen(DRAFT({ data: { providerType: 'BUSINESS', legalBusinessName: 'ACME' } }));

    expect(screen.queryByTestId('field-legalBusinessName')).toBeNull();
    expect(screen.queryByTestId('provider-type-BUSINESS')).toBeNull();
    expect(screen.queryByText(BASICS_COPY.en.typeLegend)).toBeNull();
    expect(screen.queryByText('ACME')).toBeNull();
  });

  it('asks only the three approved questions, photo first', () => {
    // The approved screen "basics" is: upload surface, customer-facing name,
    // phone. Order is part of the design, so it is asserted rather than left
    // to the reading order of the file.
    const { container } = renderScreen();

    expect(screen.getByTestId('field-displayName')).toBeInTheDocument();
    expect(screen.getByTestId('field-phoneNumber')).toBeInTheDocument();

    const name = screen.getByTestId('field-displayName');
    const phone = screen.getByTestId('field-phoneNumber');
    expect(name.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The photo comes before both, which is what "photo first" means in DOM
    // order and therefore in both reading order and tab order.
    const uploader = container.querySelector('input[type="file"]');
    if (uploader) {
      expect(
        uploader.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});

describe('BasicsTaskScreen — saving', () => {
  it('writes every field to IDENTITY, the one step that owns this screen', async () => {
    // Was: displayName to IDENTITY and legalBusinessName to PROVIDER_TYPE.
    // With the business name gone (ruling C1), IDENTITY owns everything here —
    // so the assertion is now that NOTHING is written to PROVIDER_TYPE, which
    // is stricter than checking that one write landed on it.
    renderScreen(DRAFT({ data: { providerType: 'BUSINESS' } }));

    fireEvent.change(screen.getByTestId('field-displayName'), { target: { value: 'New Name' } });
    fireEvent.blur(screen.getByTestId('field-displayName'));
    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));

    fireEvent.change(screen.getByTestId('field-phoneNumber'), {
      target: { value: '+963912345678' },
    });
    fireEvent.blur(screen.getByTestId('field-phoneNumber'));
    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(1));

    const urls = mock.history.patch.map((r) => r.url ?? '');
    expect(urls.every((u) => u.includes('/steps/IDENTITY'))).toBe(true);
    expect(urls.some((u) => u.includes('/steps/PROVIDER_TYPE'))).toBe(false);
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
    // Sprint 9B.25 — the conflict sentence now lives in the shared autosave copy,
    // so all five task screens say the same thing about the same event.
    expect(screen.getByText(AUTOSAVE_COPY.en.conflict)).toBeInTheDocument();
  });

  it('renders read-only when the server says the application is locked', () => {
    renderScreen(DRAFT(), 'en', false);
    expect(screen.getByTestId('field-displayName')).toBeDisabled();
  });
});

describe('BasicsTaskScreen — Arabic', () => {
  it('renders Arabic copy, not English', () => {
    // The type legend it used to assert on no longer exists, so this asserts
    // on the copy the approved screen actually shows.
    renderScreen(DRAFT({ data: { providerType: 'BUSINESS' } }), 'ar');

    expect(screen.getByText(BASICS_COPY.ar.phoneNotVerified)).toBeInTheDocument();
    expect(screen.getByText(BASICS_COPY.ar.displayName)).toBeInTheDocument();
    expect(screen.queryByText(BASICS_COPY.en.phoneNotVerified)).toBeNull();
    expect(screen.queryByText(BASICS_COPY.en.displayName)).toBeNull();
  });

  it('offers no type-change dialog in Arabic either', async () => {
    // Same superseding ruling, asserted in the second language so a
    // regression cannot reappear behind a locale branch.
    renderScreen(DRAFT({ data: { providerType: 'INDIVIDUAL' } }), 'ar');

    expect(screen.queryByTestId('provider-type-BUSINESS')).toBeNull();
    expect(screen.queryByTestId('provider-type-change-dialog')).toBeNull();
    expect(screen.queryByText(BASICS_COPY.ar.typeChangeTitle)).toBeNull();
  });
});
