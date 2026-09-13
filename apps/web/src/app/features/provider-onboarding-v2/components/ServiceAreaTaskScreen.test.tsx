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

const EN = SERVICE_AREA_COPY.en;
import { ProviderOnboardingAutosaveProvider } from '../autosave/ProviderOnboardingAutosaveProvider';

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
      // Sprint 9B.20 — the default-off answer, which is what every
      // assertion in this file predates and must keep passing against.
      serviceAreaExpansion: {
        show: false,
        allowedMaxKm: 100,
        baseMaxKm: 100,
        currentTier: null,
        nextTier: null,
        progress: [],
        reasonCodes: ['FEATURE_DISABLED'],
        policyVersion: null,
      },
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

// The geolocation stub and its restore hook stay: the approved screen asks the
// device for nothing, and "asks the device for nothing at all" installs a spy
// to PROVE it rather than to drive a flow. The helper that used to build a
// permission outcome has no caller left.

function renderScreen(view = DRAFT(), lang: 'en' | 'ar' = 'en', editable = true) {
  window.localStorage.setItem('hsm.lang', lang);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(providerQueryKeys.onboarding.draft(), view);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ProviderOnboardingAutosaveProvider>
            <ServiceAreaTaskScreen view={view as never} lang={lang} editable={editable} />
          </ProviderOnboardingAutosaveProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// Sprint 09B.29 Phase 5A — the approved screen is three things: one field, a
// described area, and the sentence explaining why the radius is what it is.
//
// RECORDED FOR PHASE 5B, because each was a real affordance and none of them
// is on the approved screen:
//
//   the country       `serviceAreaCountry` is REQUIRED by the completeness
//                     policy, and there is now no control to set it. A stored
//                     country is preserved — nothing here writes null over it
//                     — but a provider starting fresh cannot supply one from
//                     this screen. This is the sharpest of the recorded gaps.
//   device location   the "use my location" button and its permission states.
//                     Nothing requests geolocation any more, which is why the
//                     "completable with the permission refused" criterion is
//                     now satisfied by construction.
//   the radius slider the approved screen STATES the radius and says it
//                     follows the transport answer. The number still comes
//                     from the server.
//   the area preview  replaced by the map band, which says the same thing.

describe('the one question the approved screen asks', () => {
  it('asks for a city or neighborhood, and nothing else', async () => {
    renderScreen();

    expect(await screen.findByTestId('service-area-city')).toBeInTheDocument();
    // No country picker, no "use my location", no slider.
    expect(screen.queryByTestId('service-area-country')).toBeNull();
    expect(screen.queryByTestId('use-my-location')).toBeNull();
    expect(screen.queryByTestId('radius-slider')).toBeNull();
  });

  it('saves the city to the LOCATION step', async () => {
    renderScreen();

    fireEvent.change(await screen.findByTestId('service-area-city'), {
      target: { value: 'Aleppo, Al-Furqan' },
    });

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const sent = mock.history.patch.find((r) => r.url?.includes('LOCATION'));
    expect(sent, 'the write goes to the LOCATION step').toBeTruthy();
    expect(JSON.parse(sent!.data).serviceAreaCity).toBe('Aleppo, Al-Furqan');
  });

  it('never writes an empty city, which the server refuses', async () => {
    renderScreen(DRAFT({ data: { serviceAreaCity: 'Aleppo' } }));

    fireEvent.change(await screen.findByTestId('service-area-city'), { target: { value: '  ' } });
    fireEvent.blur(screen.getByTestId('service-area-city'));

    await new Promise((resolve) => setTimeout(resolve, 50));
    const cityWrites = mock.history.patch.filter((r) => 'serviceAreaCity' in JSON.parse(r.data));
    expect(cityWrites).toHaveLength(0);
  });

  it('asks the device for nothing at all', async () => {
    // The old screen offered geolocation behind an explicit button. The
    // approved one has no such control, so the strongest form of "completable
    // with location refused" now holds: there is nothing to refuse.
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    renderScreen();
    await screen.findByTestId('service-area-city');
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('preserves a stored country rather than clearing it — RECORDED 5B GAP', async () => {
    // The screen cannot SET a country any more. It must not unset one either:
    // `serviceAreaCountry` is required for submission, and a write that
    // cleared it would turn a missing control into data loss.
    renderScreen(
      DRAFT({
        data: {
          serviceAreaCity: 'Aleppo',
          serviceAreaCountry: 'Syria',
          serviceAreaCountryCode: 'SY',
        },
      }),
    );

    fireEvent.change(await screen.findByTestId('service-area-city'), {
      target: { value: 'Aleppo, Al-Furqan' },
    });
    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));

    for (const request of mock.history.patch) {
      const body = JSON.parse(request.data) as Record<string, unknown>;
      expect(body).not.toHaveProperty('serviceAreaCountry');
      expect(body).not.toHaveProperty('serviceAreaCountryCode');
    }
  });
});

describe('the radius comes from server policy', () => {
  it('states the radius the server granted', async () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: 15 } }));
    expect(await screen.findByTestId('service-area-radius')).toHaveTextContent('15');
  });

  it('falls back to the suggestion, never to a number of its own', async () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: null } }));
    // `radiusPolicy.suggestedKm` is 25 in this draft. "Walking is 3 km" is a
    // market judgement an operator tunes; a constant here would be one the
    // save refuses.
    expect(await screen.findByTestId('service-area-radius')).toHaveTextContent('25');
  });

  it('commits the suggestion once when nothing is stored, so the task can complete', async () => {
    // Without a slider there is otherwise no way for `serviceAreaRadiusKm` to
    // become non-null, and the completeness policy requires it — the task
    // would look finished and never be.
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: null } }));

    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const sent = mock.history.patch.map((r) => JSON.parse(r.data));
    expect(sent.some((b) => b.serviceAreaRadiusKm === 25)).toBe(true);
  });

  it('writes nothing when a radius is already stored', async () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: 15 } }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mock.history.patch).toHaveLength(0);
  });
});

describe('the reward sentence is the server’s, never the client’s', () => {
  const ladder = {
    show: true,
    allowedMaxKm: 15,
    baseMaxKm: 15,
    currentTier: null,
    nextTier: { key: 'tier-2', maxKm: 25 },
    progress: [{ key: 'RATING_SAMPLE', met: false, progress: 0, current: 0, target: 3 }],
    reasonCodes: [],
    policyVersion: 'ladder-1',
  };

  it('says nothing at all when the server says not to', async () => {
    // `show: false` is the default. With no answer there is no card, and the
    // client never computes eligibility of its own.
    renderScreen();
    await screen.findByTestId('service-area-city');
    expect(screen.queryByTestId('expansion-reward-card')).toBeNull();
  });

  it('names the radius, the transport it came from, and what widens it', async () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: 15, serviceAreaExpansion: ladder } }));

    const card = await screen.findByTestId('expansion-reward-card');
    expect(card).toHaveTextContent('15 km');
    expect(card).toHaveTextContent('car');
    expect(card).toHaveTextContent('3 excellent ratings');
    expect(card).toHaveTextContent('25 km');
  });

  it('shortens rather than guesses when the ladder withholds a number', async () => {
    // The anti-abuse criteria deliberately publish no target. A sentence that
    // invented one would be publishing a threshold the platform chose not to.
    renderScreen(
      DRAFT({
        data: {
          serviceAreaRadiusKm: 15,
          serviceAreaExpansion: { ...ladder, progress: [] },
        },
      }),
    );

    const card = await screen.findByTestId('expansion-reward-card');
    expect(card).toHaveTextContent('15 km');
    expect(card).not.toHaveTextContent('excellent ratings');
  });
});

describe('privacy is stated on the screen', () => {
  it('promises the starting point is not a published address, beside the question', async () => {
    renderScreen();

    // Moved from a panel of its own into the field's own hint, which is where
    // it does its work: a provider decides how honestly to answer while
    // reading the field, not while reading a card above it.
    const hint = screen.getByText(EN.areaHint);
    expect(hint).toBeInTheDocument();

    const city = await screen.findByTestId('service-area-city');
    expect(city.getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('draws an AREA, not a pin', async () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: 15 } }));

    // A map with a marker on the provider's base would show them exactly the
    // thing the hint promises nobody else can see, and would teach them the
    // pin is what gets published. The accessible name states the radius,
    // which is all a customer gets.
    const map = await screen.findByTestId('service-area-map');
    expect(map).toHaveAttribute('role', 'img');
    expect(map.getAttribute('aria-label')).toContain('15');
  });
});

describe('Arabic', () => {
  it('renders the approved Arabic copy', async () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: 15 } }), 'ar');

    expect(await screen.findByText(SERVICE_AREA_COPY.ar.areaLabel)).toBeInTheDocument();
    expect(screen.getByText(SERVICE_AREA_COPY.ar.areaHint)).toBeInTheDocument();
    expect(screen.queryByText(EN.areaLabel)).toBeNull();
  });
});

describe('a locked application', () => {
  it('disables the one field it has', async () => {
    renderScreen(DRAFT({ data: { serviceAreaCity: 'Aleppo' } }), 'en', false);
    expect(await screen.findByTestId('service-area-city')).toBeDisabled();
  });

  it('writes nothing, not even the radius suggestion', async () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: null } }), 'en', false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mock.history.patch).toHaveLength(0);
  });
});
