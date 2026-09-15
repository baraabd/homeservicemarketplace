import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ServiceAreaTaskScreen } from './ServiceAreaTaskScreen';
import { SERVICE_AREA_COPY } from '../copy/service-area-copy';

const EN = SERVICE_AREA_COPY.en;

// Parent interaction tests isolate the map. Real Leaflet gestures are covered
// by the real-browser suite rather than a jsdom geometry approximation.
vi.mock('./ServiceAreaMap', () => ({
  default: ({ radiusKm }: { radiusKm: number }) => (
    <div data-testid="service-area-map" data-radius={radiusKm} />
  ),
}));
import {
  ProviderOnboardingAutosaveProvider,
  useOnboardingAutosave,
} from '../autosave/ProviderOnboardingAutosaveProvider';

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

function FlushButton() {
  const { flushAll } = useOnboardingAutosave();
  return (
    <button type="button" onClick={() => void flushAll()}>
      Flush location
    </button>
  );
}

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
            <FlushButton />
          </ProviderOnboardingAutosaveProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// The user-requested repair adds explicit device location and a private map
// editor. Country and radius remain server-owned; clearing a draft city must
// clear the stored value rather than silently retain an older answer.

describe('the work area editor', () => {
  it('confirms timezone through AVAILABILITY, never the LOCATION field guard', async () => {
    const view = DRAFT({ data: { serviceAreaCountryCode: 'CA', serviceAreaRadiusKm: 25 } });
    mock.onGet('/v1/me/provider/onboarding/markets').reply(200, {
      selectedCountryCode: 'CA',
      markets: [
        {
          countryCode: 'CA',
          displayNameKey: 'CA',
          timezone: { kind: 'ASK', allowedIds: ['America/Toronto', 'America/Vancouver'] },
        },
      ],
    });
    mock.onPatch(/\/steps\/AVAILABILITY$/).reply(200, { ...view, version: 6 });
    let flush!: ReturnType<typeof useOnboardingAutosave>['flushAll'];
    function FlushProbe() {
      const { flushAll } = useOnboardingAutosave();
      useEffect(() => {
        flush = flushAll;
      }, [flushAll]);
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(providerQueryKeys.onboarding.draft(), view);
    render(
      <QueryClientProvider client={client}>
        <ProviderOnboardingAutosaveProvider>
          <ServiceAreaTaskScreen view={view as never} lang="en" editable />
          <FlushProbe />
        </ProviderOnboardingAutosaveProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByTestId('market-timezone-select'), {
      target: { value: 'America/Toronto' },
    });
    await act(async () => {
      await flush();
    });
    expect(mock.history.patch).toHaveLength(1);
    expect(mock.history.patch[0].url).toMatch(/\/steps\/AVAILABILITY$/);
    expect(JSON.parse(mock.history.patch[0].data)).toEqual({
      version: 5,
      timezone: 'America/Toronto',
    });
  });

  it('offers a city and explicit device location without inventing a radius slider', async () => {
    renderScreen();

    expect(await screen.findByTestId('service-area-city')).toBeInTheDocument();
    // The server-driven market picker is separate; the radius stays server-owned.
    expect(screen.queryByTestId('service-area-country')).toBeNull();
    expect(screen.getByTestId('service-area-locate')).toHaveTextContent(EN.useMyLocation);
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

  it('clears the persisted draft city with null instead of retaining a hidden older city', async () => {
    renderScreen(DRAFT({ data: { serviceAreaCity: 'Aleppo' } }));

    fireEvent.change(await screen.findByTestId('service-area-city'), { target: { value: '  ' } });
    fireEvent.blur(screen.getByTestId('service-area-city'));

    fireEvent.click(screen.getByRole('button', { name: 'Flush location' }));
    await waitFor(() => expect(mock.history.patch.length).toBeGreaterThan(0));
    const cityWrites = mock.history.patch.filter((r) => 'serviceAreaCity' in JSON.parse(r.data));
    expect(cityWrites).toHaveLength(1);
    expect(JSON.parse(cityWrites[0]!.data).serviceAreaCity).toBeNull();
  });

  it('does not request device location on mount', async () => {
    // Permission is only requested after the provider chooses its button.
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });

    renderScreen();
    await screen.findByTestId('service-area-city');
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('preserves the stored country when only the city changes', async () => {
    // The market picker owns country changes. Typing a city must not alter it.
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
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

  it('distinguishes the private editable pin from the publicly visible approximate area', async () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: 15 } }));
    expect(await screen.findByTestId('service-area-map')).toHaveAttribute('data-radius', '15');
    expect(screen.getByText(EN.privacyPublic)).toBeInTheDocument();
    expect(screen.getByText(EN.mapInstructions)).toBeInTheDocument();
    expect(screen.getByText(EN.locationServiceHint)).toBeInTheDocument();
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
  it('disables the city and device location controls', async () => {
    renderScreen(DRAFT({ data: { serviceAreaCity: 'Aleppo' } }), 'en', false);
    expect(await screen.findByTestId('service-area-city')).toBeDisabled();
    expect(screen.getByTestId('service-area-locate')).toBeDisabled();
  });

  it('writes nothing, not even the radius suggestion', async () => {
    renderScreen(DRAFT({ data: { serviceAreaRadiusKm: null } }), 'en', false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mock.history.patch).toHaveLength(0);
  });
});
