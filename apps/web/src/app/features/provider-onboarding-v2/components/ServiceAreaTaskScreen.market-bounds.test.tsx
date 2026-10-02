import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import { reverseGeocodeViaNominatim } from '../../../../lib/reverse-geocode';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { ServiceAreaTask } from './ServiceAreaTaskScreen';
import { SERVICE_AREA_COPY } from '../copy/service-area-copy';
import {
  ProviderOnboardingAutosaveProvider,
  useOnboardingAutosave,
} from '../autosave/ProviderOnboardingAutosaveProvider';

// R09 — a starting point must be in the market the provider chose.
//
// The server is the authority (POINT_OUTSIDE_MARKET). What is proved here is
// the screen's half: it explains with the envelope the SERVER sent, it never
// queues a point that envelope excludes, and it holds no geography of its own.
//
// Only the device, the vendor geocoder and map gestures are substitutes. The
// draft query and the serial autosave are real.
vi.mock('../../../../lib/reverse-geocode', () => ({ reverseGeocodeViaNominatim: vi.fn() }));
vi.mock('./ServiceAreaMap', () => ({
  default: ({
    point,
    bounds,
    onSelect,
  }: {
    point: { lat: number; lng: number } | null;
    bounds?: { south: number; west: number; north: number; east: number } | null;
    onSelect: (point: { lat: number; lng: number }) => boolean;
  }) => (
    <div data-testid="map-fixture">
      <output data-testid="map-point">{point ? `${point.lat},${point.lng}` : 'No pin'}</output>
      <output data-testid="map-bounds">{bounds ? JSON.stringify(bounds) : 'No bounds'}</output>
      <output data-testid="map-accepted" />
      <button
        type="button"
        onClick={(event) => {
          (event.currentTarget.parentElement as HTMLElement).dataset.accepted = String(
            onSelect(INSIDE),
          );
        }}
      >
        Select a point inside
      </button>
      <button
        type="button"
        onClick={(event) => {
          (event.currentTarget.parentElement as HTMLElement).dataset.accepted = String(
            onSelect(OUTSIDE),
          );
        }}
      >
        Select a point outside
      </button>
    </div>
  ),
}));

const DRAFT_URL = '/v1/me/provider/onboarding/draft';
const MARKETS_URL = '/v1/me/provider/onboarding/markets';
const LOCATION_URL = '/v1/me/provider/onboarding/steps/LOCATION';
const SY_BOUNDS = { south: 32.3, west: 35.6, north: 37.4, east: 42.4 };
const INSIDE = { lat: 36.2, lng: 37.16 };
const OUTSIDE = { lat: 16.02, lng: 7.03 };
const originalGeolocation = navigator.geolocation;

function draft(over: Record<string, unknown> = {}): ProviderOnboardingDraftView {
  return {
    draftId: 'r09-market-bounds',
    state: 'DRAFT',
    version: 5,
    editable: true,
    data: {
      serviceAreaCity: 'Aleppo',
      serviceAreaCountry: 'Syria',
      serviceAreaCountryCode: 'SY',
      serviceAreaLat: null,
      serviceAreaLng: null,
      serviceAreaRadiusKm: 15,
      radiusPolicy: { suggestedKm: 25, minKm: 1, maxKm: 50, basedOn: 'CAR' },
      serviceAreaExpansion: { show: false },
      timezone: 'Asia/Damascus',
      resolvedTimezone: {
        resolved: 'Asia/Damascus',
        display: { city: 'Damascus', offset: 'UTC+3' },
        needsConfirmation: false,
      },
      ...over,
    },
  } as ProviderOnboardingDraftView;
}

let mock: MockAdapter;
let client: QueryClient;
let stored: ProviderOnboardingDraftView;
let flushAll: ReturnType<typeof useOnboardingAutosave>['flushAll'];
let resolvePosition: PositionCallback | null;

function SaveProbe() {
  const autosave = useOnboardingAutosave();
  useEffect(() => {
    flushAll = autosave.flushAll;
  }, [autosave.flushAll]);
  return null;
}

async function mount(market: Record<string, unknown>, lang: 'en' | 'ar' = 'en') {
  mock.onGet(MARKETS_URL).reply(200, {
    selectedCountryCode: 'SY',
    locationSuggestionAvailable: false,
    markets: [
      {
        countryCode: 'SY',
        displayNameKey: 'SY',
        timezone: { kind: 'RESOLVED', id: 'Asia/Damascus' },
        radius: { minKm: 1, maxKm: 50, defaultKm: 25 },
        ...market,
      },
    ],
  });
  client.setQueryData(providerQueryKeys.onboarding.draft(), stored);
  render(
    <QueryClientProvider client={client}>
      <ProviderOnboardingAutosaveProvider>
        <ServiceAreaTask lang={lang} />
        <SaveProbe />
      </ProviderOnboardingAutosaveProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('map-fixture');
}

async function flush() {
  await act(async () => {
    expect((await flushAll()).ok).toBe(true);
  });
}

const sent = () => mock.history.patch.map((r) => JSON.parse(String(r.data)));
const accepted = () => screen.getByTestId('map-fixture').dataset.accepted;
const feedback = () => screen.getByTestId('service-area-location-feedback');

beforeEach(() => {
  stored = draft();
  resolvePosition = null;
  vi.mocked(reverseGeocodeViaNominatim).mockReset();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((resolve: PositionCallback) => {
        resolvePosition = resolve;
      }),
    },
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  mock = new MockAdapter(api);
  mock.onGet(DRAFT_URL).reply(() => [200, stored]);
  mock.onPatch(LOCATION_URL).reply((config) => {
    const { version, ...patch } = JSON.parse(String(config.data));
    stored = { ...stored, version: version + 1, data: { ...stored.data, ...patch } };
    return [200, stored];
  });
});

afterEach(() => {
  mock.restore();
  client.clear();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: originalGeolocation,
  });
});

describe('the map is opened on the market the server describes', () => {
  it('hands the map the envelope of the selected market', async () => {
    await mount({ bounds: SY_BOUNDS });
    await screen.findByText(JSON.stringify(SY_BOUNDS));
  });

  it('hands the map nothing when the operator has not described the market', async () => {
    await mount({});
    expect(screen.getByTestId('map-bounds')).toHaveTextContent('No bounds');
  });

  it('does not use another market envelope for this provider', async () => {
    stored = draft({ serviceAreaCountryCode: 'SE' });
    await mount({ bounds: SY_BOUNDS });
    expect(screen.getByTestId('map-bounds')).toHaveTextContent('No bounds');
  });
});

describe('a point outside the market is explained and never queued', () => {
  it('saves a point inside the market', async () => {
    await mount({ bounds: SY_BOUNDS });
    await screen.findByText(JSON.stringify(SY_BOUNDS));
    fireEvent.click(screen.getByText('Select a point inside'));
    expect(accepted()).toBe('true');
    await flush();
    expect(sent()).toEqual([
      expect.objectContaining({ serviceAreaLat: INSIDE.lat, serviceAreaLng: INSIDE.lng }),
    ]);
    // Read back from the server's acknowledgement, not from local state.
    await screen.findByText(`${INSIDE.lat},${INSIDE.lng}`);
  });

  it('refuses a point outside the market: no pin, no request, and it says why', async () => {
    await mount({ bounds: SY_BOUNDS });
    await screen.findByText(JSON.stringify(SY_BOUNDS));
    fireEvent.click(screen.getByText('Select a point outside'));
    expect(accepted()).toBe('false');
    expect(feedback()).toHaveTextContent(SERVICE_AREA_COPY.en.pointOutsideMarket);
    expect(screen.getByTestId('map-point')).toHaveTextContent('No pin');
    await flush();
    expect(sent()).toEqual([]);
  });

  it('keeps the pin already stored when a later choice is outside the market', async () => {
    stored = draft({ serviceAreaLat: INSIDE.lat, serviceAreaLng: INSIDE.lng });
    await mount({ bounds: SY_BOUNDS });
    await screen.findByText(JSON.stringify(SY_BOUNDS));
    fireEvent.click(screen.getByText('Select a point outside'));
    expect(screen.getByTestId('map-point')).toHaveTextContent(`${INSIDE.lat},${INSIDE.lng}`);
    await flush();
    expect(sent()).toEqual([]);
  });

  it('does not stop a later city edit from saving', async () => {
    await mount({ bounds: SY_BOUNDS });
    await screen.findByText(JSON.stringify(SY_BOUNDS));
    fireEvent.click(screen.getByText('Select a point outside'));
    fireEvent.change(screen.getByTestId('service-area-city'), { target: { value: 'Hama' } });
    await flush();
    // The refused point is not carried along with the city.
    expect(sent()).toEqual([{ version: 5, serviceAreaCity: 'Hama' }]);
  });

  it('refuses a device position outside the market without touching the city', async () => {
    await mount({ bounds: SY_BOUNDS });
    await screen.findByText(JSON.stringify(SY_BOUNDS));
    fireEvent.click(screen.getByTestId('service-area-locate'));
    await act(async () => {
      resolvePosition!({
        coords: { latitude: OUTSIDE.lat, longitude: OUTSIDE.lng },
      } as GeolocationPosition);
    });
    expect(feedback()).toHaveTextContent(SERVICE_AREA_COPY.en.pointOutsideMarket);
    expect(reverseGeocodeViaNominatim).not.toHaveBeenCalled();
    expect(screen.getByTestId('service-area-city')).toHaveValue('Aleppo');
    await flush();
    expect(sent()).toEqual([]);
  });

  it('leaves the judgement to the server when the market is not described', async () => {
    await mount({});
    fireEvent.click(screen.getByText('Select a point outside'));
    expect(accepted()).toBe('true');
    await flush();
    expect(sent()).toEqual([
      expect.objectContaining({ serviceAreaLat: OUTSIDE.lat, serviceAreaLng: OUTSIDE.lng }),
    ]);
  });

  it('says it in Arabic too', async () => {
    await mount({ bounds: SY_BOUNDS }, 'ar');
    await screen.findByText(JSON.stringify(SY_BOUNDS));
    fireEvent.click(screen.getByText('Select a point outside'));
    expect(feedback()).toHaveTextContent(SERVICE_AREA_COPY.ar.pointOutsideMarket);
  });
});
