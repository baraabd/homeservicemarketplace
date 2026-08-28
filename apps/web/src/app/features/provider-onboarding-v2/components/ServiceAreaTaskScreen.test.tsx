import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ServiceAreaTaskScreen } from './ServiceAreaTaskScreen';
import { SERVICE_AREA_COPY } from '../copy/service-area-copy';

// Sprint 9B.19 — V2 Task 3.
//
// The acceptance criteria this file pins:
//
//   - the task can be completed with device location REFUSED
//   - no radius number is invented by the client; every bound is the server's
//   - the privacy of the exact location is stated on the screen, not buried
//   - a raw IANA identifier never reaches the UI

const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/LOCATION/;

// `data` is destructured OUT of the overrides before the outer spread.
//
// Spreading `...over` last would re-set `data` to the caller's partial object
// and drop every default under it — so a test overriding one field would
// silently remove `radiusPolicy` and the screen would render against
// undefined. That is a fixture bug that reads exactly like a component bug.
const DRAFT = (over: Record<string, unknown> = {}) => {
  const { data: dataOver, ...rest } = over;
  return {
    state: 'DRAFT',
    currentStep: 'LOCATION',
    steps: [],
    completedSteps: [],
    percentComplete: 0,
    nextAction: { kind: 'COMPLETE_STEP', step: 'LOCATION' },
    complete: false,
    missing: [],
    version: 5,
    policyVersion: 'sprint-08',
    lastSavedAt: null,
    editable: true,
    ...rest,
    data: {
      serviceAreaCity: null,
      serviceAreaCountry: null,
      serviceAreaCountryCode: null,
      serviceAreaLat: null,
      serviceAreaLng: null,
      serviceAreaRadiusKm: null,
      radiusPolicy: { suggestedKm: 25, minKm: 1, maxKm: 100, basedOn: 'CAR' },
      resolvedTimezone: { resolved: null, display: null, needsConfirmation: false },
      ...((dataOver as Record<string, unknown>) ?? {}),
    },
  };
};

let mock: MockAdapter;
const originalGeolocation = navigator.geolocation;

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onPatch(PATCH).reply(200, DRAFT());
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
  Object.defineProperty(navigator, 'geolocation', {
    value: originalGeolocation,
    configurable: true,
  });
});

function stubGeolocation(impl: Partial<Geolocation>) {
  Object.defineProperty(navigator, 'geolocation', { value: impl, configurable: true });
}

function renderScreen(view = DRAFT(), lang: 'en' | 'ar' = 'en', editable = true) {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), view);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ServiceAreaTaskScreen view={view as never} lang={lang} editable={editable} />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the task can be completed WITHOUT device location', () => {
  it('never asks for permission on mount', async () => {
    // Firing a permission prompt at someone who has not been told why is how
    // people learn to hit "block" reflexively.
    const getCurrentPosition = vi.fn();
    stubGeolocation({ getCurrentPosition } as unknown as Geolocation);

    renderScreen();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('offers the manual fields immediately, before any permission decision', () => {
    renderScreen();
    expect(screen.getByTestId('service-area-city')).toBeInTheDocument();
    expect(screen.getByTestId('service-area-country')).toBeInTheDocument();
    expect(screen.getByTestId('radius-slider')).toBeInTheDocument();
  });

  it('saves a typed city and a chosen country with NO location granted', async () => {
    renderScreen();

    const cityField = screen.getByTestId('service-area-city');
    fireEvent.change(cityField, { target: { value: 'Damascus' } });
    fireEvent.blur(cityField);

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).serviceAreaCity).toBe('Damascus');
  });

  it('sends BOTH the display name and the normalised code for the country', async () => {
    // The name is what the provider chose to call it; the code is what a
    // timezone and a market policy are looked up by.
    renderScreen();
    fireEvent.change(screen.getByTestId('service-area-country'), { target: { value: 'SY' } });

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(body.serviceAreaCountryCode).toBe('SY');
    expect(typeof body.serviceAreaCountry).toBe('string');
  });

  it('treats a DENIED permission as a fact with a way forward, not an error', async () => {
    stubGeolocation({
      getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) =>
        fail?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    } as unknown as Geolocation);

    renderScreen();
    fireEvent.click(screen.getByTestId('use-my-location'));

    const fallback = await screen.findByTestId('location-permission-fallback');
    expect(fallback).toHaveTextContent(SERVICE_AREA_COPY.en.permissionDenied);
    // And the manual path is still right there.
    expect(screen.getByTestId('service-area-city')).toBeEnabled();
  });

  it('still saves everything after a refusal', async () => {
    stubGeolocation({
      getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) =>
        fail?.({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    } as unknown as Geolocation);

    renderScreen();
    fireEvent.click(screen.getByTestId('use-my-location'));
    await screen.findByTestId('location-permission-fallback');

    const cityField = screen.getByTestId('service-area-city');
    fireEvent.change(cityField, { target: { value: 'Aleppo' } });
    fireEvent.blur(cityField);

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).serviceAreaCity).toBe('Aleppo');
  });

  it('handles a device with no geolocation API at all', async () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });

    renderScreen();
    fireEvent.click(screen.getByTestId('use-my-location'));

    expect(await screen.findByTestId('location-permission-fallback')).toHaveTextContent(
      SERVICE_AREA_COPY.en.permissionUnavailable,
    );
  });

  it('sends coordinates only when permission is actually GRANTED', async () => {
    stubGeolocation({
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 33.5, longitude: 36.3 } } as GeolocationPosition),
    } as unknown as Geolocation);

    renderScreen();
    fireEvent.click(screen.getByTestId('use-my-location'));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(body.serviceAreaLat).toBe(33.5);
    expect(body.serviceAreaLng).toBe(36.3);
  });
});

describe('the radius comes from server policy', () => {
  it('starts at the SERVER suggestion, not a client constant', () => {
    renderScreen(
      DRAFT({
        data: { radiusPolicy: { suggestedKm: 7, minKm: 1, maxKm: 40, basedOn: 'MOTORCYCLE' } },
      }),
    );
    expect(screen.getByTestId('radius-value')).toHaveTextContent('Up to 7 km');
  });

  it('bounds the control with the SERVER floor and ceiling', () => {
    renderScreen(
      DRAFT({ data: { radiusPolicy: { suggestedKm: 7, minKm: 2, maxKm: 40, basedOn: 'CAR' } } }),
    );
    const slider = screen.getByTestId('radius-slider');
    expect(slider).toHaveAttribute('min', '2');
    expect(slider).toHaveAttribute('max', '40');
    expect(screen.getByTestId('radius-bounds')).toHaveTextContent('Between 2 and 40 km');
  });

  it('says WHY the suggestion is what it is', async () => {
    // An unexplained default looks arbitrary and gets ignored.
    renderScreen(
      DRAFT({
        data: { radiusPolicy: { suggestedKm: 3, minKm: 1, maxKm: 40, basedOn: 'ON_FOOT' } },
      }),
    );
    expect(screen.getByTestId('radius-basis')).toHaveTextContent('you travel by foot');
  });

  it('does not claim a basis when the server reports none', () => {
    renderScreen(
      DRAFT({ data: { radiusPolicy: { suggestedKm: 3, minKm: 1, maxKm: 40, basedOn: null } } }),
    );
    expect(screen.getByTestId('radius-basis')).toHaveTextContent(
      SERVICE_AREA_COPY.en.radiusNoBasis,
    );
  });

  it('lets the provider REDUCE the suggestion', async () => {
    renderScreen();
    const slider = screen.getByTestId('radius-slider');
    fireEvent.change(slider, { target: { value: '5' } });
    fireEvent.blur(slider);

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    expect(JSON.parse(mock.history.patch[0].data).serviceAreaRadiusKm).toBe(5);
  });

  it('prefers a value the provider already saved over the suggestion', () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: 12 } }));
    expect(screen.getByTestId('radius-value')).toHaveTextContent('Up to 12 km');
  });

  it('makes no promise about how much work a larger radius brings', () => {
    // A volume guarantee the marketplace cannot keep, paid for in fuel by the
    // provider who believes it.
    renderScreen();
    const text = document.body.textContent ?? '';
    for (const promise of [/more customers/i, /more jobs/i, /more work/i, /earn more/i]) {
      expect(text).not.toMatch(promise);
    }
  });
});

describe('privacy is stated on the screen', () => {
  it('says the exact location stays private, beside the question', () => {
    renderScreen();
    const note = screen.getByTestId('location-privacy-note');
    expect(note).toHaveTextContent(SERVICE_AREA_COPY.en.privacyTitle);
    expect(note).toHaveTextContent(SERVICE_AREA_COPY.en.privacyBody);
  });

  it('says what IS public', () => {
    renderScreen();
    expect(screen.getByTestId('location-privacy-note')).toHaveTextContent(/approximate area/i);
  });

  it('shows an AREA rather than a pin on the base', async () => {
    // A marker would show the provider exactly the thing the note promises
    // nobody else can see, and would teach them the pin is what is published.
    renderScreen(DRAFT({ data: { serviceAreaCity: 'Damascus', serviceAreaRadiusKm: 10 } }));
    expect(screen.getByTestId('area-preview-approx')).toHaveTextContent('about 20 km across');
  });

  it('asks for no street address anywhere', () => {
    // Asserted on the CONTROLS, not on all page text: the privacy note says
    // the word "street" on purpose — "never your street" — and a naive text
    // scan would forbid the very sentence that makes the promise.
    renderScreen();

    const fields = Array.from(document.querySelectorAll('input, textarea, select'));
    for (const field of fields) {
      const described = [
        field.getAttribute('id') ?? '',
        field.getAttribute('name') ?? '',
        field.getAttribute('placeholder') ?? '',
        field.getAttribute('aria-label') ?? '',
        document.querySelector(`label[for="${field.getAttribute('id')}"]`)?.textContent ?? '',
      ]
        .join(' ')
        .toLowerCase();

      for (const word of ['street', 'postcode', 'zip', 'address']) {
        expect({ field: field.getAttribute('id'), word, asks: described.includes(word) }).toEqual({
          field: field.getAttribute('id'),
          word,
          asks: false,
        });
      }
    }
  });
});

describe('timezone', () => {
  it('shows a city and an offset, never an IANA identifier', () => {
    renderScreen(
      DRAFT({
        data: {
          resolvedTimezone: {
            resolved: 'Asia/Damascus',
            display: { city: 'Damascus', offset: 'UTC+3' },
            needsConfirmation: false,
          },
        },
      }),
    );

    const note = screen.getByTestId('timezone-note');
    expect(note).toHaveTextContent('Damascus time (UTC+3)');
    expect(document.body.textContent ?? '').not.toContain('Asia/Damascus');
  });

  it('defers to the availability step when the country is ambiguous', () => {
    renderScreen(
      DRAFT({
        data: {
          resolvedTimezone: { resolved: null, display: null, needsConfirmation: true },
        },
      }),
    );
    expect(screen.getByTestId('timezone-needs-confirmation')).toBeInTheDocument();
  });

  it('says nothing at all before a country is chosen', () => {
    renderScreen();
    expect(screen.queryByTestId('timezone-note')).toBeNull();
    expect(screen.queryByTestId('timezone-needs-confirmation')).toBeNull();
  });
});

describe('Arabic', () => {
  it('renders Arabic copy', () => {
    renderScreen(DRAFT(), 'ar');
    expect(screen.getByTestId('location-privacy-note')).toHaveTextContent(
      SERVICE_AREA_COPY.ar.privacyTitle,
    );
    expect(screen.queryByText(SERVICE_AREA_COPY.en.privacyTitle)).toBeNull();
  });
});

describe('a locked application', () => {
  it('disables every control', () => {
    renderScreen(DRAFT(), 'en', false);
    expect(screen.getByTestId('service-area-city')).toBeDisabled();
    expect(screen.getByTestId('service-area-country')).toBeDisabled();
    expect(screen.getByTestId('radius-slider')).toBeDisabled();
    expect(screen.getByTestId('use-my-location')).toBeDisabled();
  });
});
