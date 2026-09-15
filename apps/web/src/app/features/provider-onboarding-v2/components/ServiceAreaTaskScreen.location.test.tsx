import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import {
  reverseGeocodeViaNominatim,
  type ReverseGeocodeResult,
} from '../../../../lib/reverse-geocode';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { ServiceAreaTask } from './ServiceAreaTaskScreen';
import { SERVICE_AREA_COPY } from '../copy/service-area-copy';
import {
  ProviderOnboardingAutosaveProvider,
  useOnboardingAutosave,
} from '../autosave/ProviderOnboardingAutosaveProvider';

// Only device/vendor and map gestures are substitutes. The draft query and
// serial autosave are real, and the API stub returns the persisted projection.
vi.mock('../../../../lib/reverse-geocode', () => ({ reverseGeocodeViaNominatim: vi.fn() }));
vi.mock('./ServiceAreaMap', () => ({
  default: ({
    point,
    radiusKm,
    editable,
    onSelect,
  }: {
    point: { lat: number; lng: number } | null;
    radiusKm: number;
    editable: boolean;
    onSelect: (point: { lat: number; lng: number }) => void;
  }) => (
    <div data-testid="location-map-fixture" data-radius={radiusKm}>
      <output data-testid="map-point">{point ? `${point.lat},${point.lng}` : 'No pin'}</output>
      <button
        type="button"
        disabled={!editable}
        onClick={() => onSelect({ lat: 35.15, lng: 36.75 })}
      >
        Select test map point
      </button>
    </div>
  ),
}));

const DRAFT_URL = '/v1/me/provider/onboarding/draft';
const LOCATION_URL = '/v1/me/provider/onboarding/steps/LOCATION';
const EN = SERVICE_AREA_COPY.en;
const originalGeolocation = navigator.geolocation;
const geocode = vi.mocked(reverseGeocodeViaNominatim);

function initialDraft(): ProviderOnboardingDraftView {
  return {
    draftId: 'location-regression-draft',
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
    },
  } as ProviderOnboardingDraftView;
}

function geocodeResult(city = 'Damascus'): ReverseGeocodeResult {
  return {
    status: 'ok',
    city,
    country: 'Syria',
    formattedAddress: `${city}, Syria`,
    lat: 33.51,
    lng: 36.29,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let mock: MockAdapter;
let client: QueryClient;
let stored: ProviderOnboardingDraftView;
let flushAll: ReturnType<typeof useOnboardingAutosave>['flushAll'];
let positions: { resolve: PositionCallback; reject: PositionErrorCallback | null }[];
let getCurrentPosition: ReturnType<typeof vi.fn<Geolocation['getCurrentPosition']>>;

beforeEach(() => {
  stored = initialDraft();
  positions = [];
  geocode.mockReset();
  geocode.mockResolvedValue(geocodeResult());
  getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((resolve, reject) => {
    positions.push({ resolve, reject: reject ?? null });
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  mock = new MockAdapter(api);
  mock.onGet(DRAFT_URL).reply(() => [200, stored]);
  mock.onGet('/v1/me/provider/onboarding/markets').reply(200, {
    selectedCountryCode: 'SY',
    locationSuggestionAvailable: false,
    markets: [
      {
        countryCode: 'SY',
        displayNameKey: 'SY',
        timezone: { kind: 'RESOLVED', id: 'Asia/Damascus' },
        radius: { minKm: 1, maxKm: 50, defaultKm: 25 },
      },
    ],
  });
  mock.onPatch(LOCATION_URL).reply((config) => {
    const { version, ...patch } = JSON.parse(String(config.data));
    if (version !== stored.version)
      return [409, { error: { details: { expectedVersion: stored.version } } }];
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

function SaveProbe() {
  const autosave = useOnboardingAutosave();
  useEffect(() => {
    flushAll = autosave.flushAll;
  }, [autosave.flushAll]);
  return <output data-testid="location-pending">{String(autosave.hasPendingWork)}</output>;
}

async function mount() {
  client.setQueryData(providerQueryKeys.onboarding.draft(), stored);
  const result = render(
    <QueryClientProvider client={client}>
      <ProviderOnboardingAutosaveProvider>
        <ServiceAreaTask lang="en" />
        <SaveProbe />
      </ProviderOnboardingAutosaveProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('location-map-fixture');
  return result;
}

async function flush() {
  await act(async () => {
    expect((await flushAll()).ok).toBe(true);
  });
}

function locate() {
  fireEvent.click(screen.getByTestId('service-area-locate'));
}

async function position(index = 0) {
  await act(async () => {
    positions[index]!.resolve({
      coords: { latitude: 33.51, longitude: 36.29 },
    } as GeolocationPosition);
  });
}

function sent() {
  return mock.history.patch.map((request) => JSON.parse(String(request.data)));
}

describe('explicit GPS and manual location use the same persisted draft', () => {
  it('never requests GPS or city lookup merely by mounting or typing', async () => {
    await mount();
    fireEvent.change(screen.getByTestId('service-area-city'), { target: { value: 'Hama' } });
    await flush();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(geocode).not.toHaveBeenCalled();
    expect(stored.data.serviceAreaCity).toBe('Hama');
  });

  it('requests location on explicit action, then persists city and coordinates without changing country or radius', async () => {
    const lookup = deferred<ReverseGeocodeResult>();
    geocode.mockReturnValueOnce(lookup.promise);
    await mount();
    locate();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0]![2]).toEqual({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    });
    expect(screen.getByTestId('service-area-locate')).toBeDisabled();
    await position();
    expect(geocode).toHaveBeenCalledWith(33.51, 36.29, 'en', expect.any(AbortSignal));
    expect(screen.getByTestId('map-point')).toHaveTextContent('33.51,36.29');
    expect(screen.getByTestId('location-pending')).toHaveTextContent('true');
    await act(async () => lookup.resolve(geocodeResult()));
    await flush();
    expect(screen.getByTestId('service-area-location-feedback')).toHaveTextContent(
      EN.locationSelected,
    );
    expect(screen.getByTestId('service-area-city')).toHaveValue('Damascus');
    expect(stored.data).toMatchObject({
      serviceAreaCity: 'Damascus',
      serviceAreaLat: 33.51,
      serviceAreaLng: 36.29,
      serviceAreaCountryCode: 'SY',
      serviceAreaRadiusKm: 15,
    });
    expect(sent()).toEqual([
      { version: 5, serviceAreaLat: 33.51, serviceAreaLng: 36.29, serviceAreaCity: 'Damascus' },
    ]);
    expect(screen.getByTestId('location-map-fixture')).toHaveAttribute('data-radius', '15');
  });

  it('leaves manual city entry and pin selection usable after permission is denied', async () => {
    await mount();
    locate();
    await act(async () => {
      positions[0]!.reject!({ code: 1 } as GeolocationPositionError);
    });
    expect(screen.getByTestId('service-area-location-feedback')).toHaveTextContent(
      EN.permissionDenied,
    );
    expect(screen.getByTestId('service-area-locate')).toBeEnabled();
    fireEvent.change(screen.getByTestId('service-area-city'), { target: { value: 'Hama' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select test map point' }));
    await flush();
    expect(geocode).not.toHaveBeenCalled();
    expect(stored.data).toMatchObject({
      serviceAreaCity: 'Hama',
      serviceAreaLat: 35.15,
      serviceAreaLng: 36.75,
    });
  });

  it('keeps the chosen coordinates if the city lookup cannot find a name', async () => {
    geocode.mockResolvedValueOnce({
      status: 'partial',
      city: '',
      country: '',
      formattedAddress: '33.51,36.29',
      reason: 'network',
      lat: 33.51,
      lng: 36.29,
    });
    await mount();
    locate();
    await position();
    await flush();
    expect(screen.getByTestId('service-area-location-feedback')).toHaveTextContent(
      EN.cityLookupFailed,
    );
    expect(stored.data).toMatchObject({
      serviceAreaCity: 'Aleppo',
      serviceAreaLat: 33.51,
      serviceAreaLng: 36.29,
    });
  });

  it('clears the actual city with null and preserves country, radius and the selected point', async () => {
    stored.data.serviceAreaLat = 36.2;
    stored.data.serviceAreaLng = 37.16;
    await mount();
    fireEvent.change(screen.getByTestId('service-area-city'), { target: { value: '  ' } });
    fireEvent.blur(screen.getByTestId('service-area-city'));
    await flush();
    expect(sent()).toEqual([{ version: 5, serviceAreaCity: null }]);
    expect(stored.data).toMatchObject({
      serviceAreaCity: null,
      serviceAreaCountryCode: 'SY',
      serviceAreaRadiusKm: 15,
      serviceAreaLat: 36.2,
      serviceAreaLng: 37.16,
    });
  });

  it('hydrates the persisted GPS choice on a fresh task mount', async () => {
    const first = await mount();
    locate();
    await position();
    await flush();
    first.unmount();
    client.clear();
    await mount();
    expect(screen.getByTestId('service-area-city')).toHaveValue('Damascus');
    expect(screen.getByTestId('map-point')).toHaveTextContent('33.51,36.29');
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('does not request GPS or persist edits in a read-only application', async () => {
    stored.editable = false;
    await mount();
    expect(screen.getByTestId('service-area-city')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Select test map point' })).toBeDisabled();
    locate();
    await flush();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(mock.history.patch).toHaveLength(0);
  });
});

describe('late GPS or geocoder results cannot overwrite newer choices', () => {
  it('releases the save-and-exit barrier when a manual city replaces an unanswered permission prompt', async () => {
    await mount();
    locate();
    expect(screen.getByTestId('location-pending')).toHaveTextContent('true');
    fireEvent.change(screen.getByTestId('service-area-city'), { target: { value: 'Hama' } });
    // No success/error callback arrives from the browser. The manual choice
    // itself must settle the tracked operation so Save and continue can leave.
    await flush();
    expect(stored.data.serviceAreaCity).toBe('Hama');
    expect(screen.getByTestId('location-pending')).toHaveTextContent('false');
    expect(geocode).not.toHaveBeenCalled();
    await position();
    expect(stored.data.serviceAreaLat).toBeNull();
    expect(geocode).not.toHaveBeenCalled();
  });

  it('cancels an unanswered permission prompt when the application becomes read-only', async () => {
    await mount();
    locate();
    await act(async () => {
      stored = { ...stored, editable: false, version: stored.version + 1 };
      client.setQueryData(providerQueryKeys.onboarding.draft(), stored);
    });
    await flush();
    expect(screen.getByTestId('location-pending')).toHaveTextContent('false');
    expect(screen.getByTestId('service-area-locate')).toBeDisabled();
    await position();
    expect(geocode).not.toHaveBeenCalled();
    expect(mock.history.patch).toHaveLength(0);
  });

  it('ignores a late GPS fix after the provider types a city', async () => {
    await mount();
    locate();
    fireEvent.change(screen.getByTestId('service-area-city'), { target: { value: 'Hama' } });
    await position();
    await flush();
    expect(geocode).not.toHaveBeenCalled();
    expect(stored.data).toMatchObject({
      serviceAreaCity: 'Hama',
      serviceAreaLat: null,
      serviceAreaLng: null,
    });
  });

  it.each(['city', 'pin'] as const)(
    'ignores a late city lookup after a newer %s choice',
    async (choice) => {
      const lookup = deferred<ReverseGeocodeResult>();
      geocode.mockReturnValueOnce(lookup.promise);
      await mount();
      locate();
      await position();
      const signal = geocode.mock.calls[0]![3]!;
      if (choice === 'city') {
        fireEvent.change(screen.getByTestId('service-area-city'), { target: { value: 'Hama' } });
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Select test map point' }));
      }
      expect(signal.aborted).toBe(true);
      await act(async () => lookup.resolve(geocodeResult('Old GPS city')));
      await flush();
      expect(stored.data.serviceAreaCity).toBe(choice === 'city' ? 'Hama' : 'Aleppo');
      expect(stored.data.serviceAreaLat).toBe(choice === 'city' ? 33.51 : 35.15);
      expect(screen.getByTestId('service-area-city')).not.toHaveValue('Old GPS city');
    },
  );

  it.each(['gps', 'geocoder'] as const)(
    'ignores a late %s response after unmount',
    async (stage) => {
      const lookup = deferred<ReverseGeocodeResult>();
      geocode.mockReturnValueOnce(lookup.promise);
      const mounted = await mount();
      locate();
      if (stage === 'geocoder') await position();
      const signal = geocode.mock.calls[0]?.[3];
      mounted.unmount();
      if (stage === 'gps') await position();
      else {
        expect(signal?.aborted).toBe(true);
        await act(async () => lookup.resolve(geocodeResult('Old GPS city')));
      }
      expect(mock.history.patch).toHaveLength(0);
      expect(stored.data.serviceAreaCity).toBe('Aleppo');
      if (stage === 'gps') expect(geocode).not.toHaveBeenCalled();
    },
  );
});
