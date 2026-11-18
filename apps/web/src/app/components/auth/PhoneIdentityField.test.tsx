import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reverseGeocodeViaNominatim } from '../../../lib/reverse-geocode';
import { PhoneIdentityField } from './PhoneIdentityField';

vi.mock('../../../lib/reverse-geocode', () => ({ reverseGeocodeViaNominatim: vi.fn() }));

function Harness() {
  const [countryCode, setCountryCode] = useState('');
  const [number, setNumber] = useState('');
  return (
    <PhoneIdentityField
      countryCode={countryCode}
      onCountryChange={setCountryCode}
      localNumber={number}
      onNumberChange={setNumber}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('explicit phone country selection', () => {
  it('requests no location on mount and starts with an empty country', () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { language: 'en-US', geolocation: { getCurrentPosition } });
    render(<Harness />);
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('');
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(reverseGeocodeViaNominatim).not.toHaveBeenCalled();
  });

  it('fills the actual country after an explicit location request', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: { latitude: 36.20123, longitude: 37.16123 } } as GeolocationPosition),
    );
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    vi.mocked(reverseGeocodeViaNominatim).mockResolvedValue({
      status: 'ok',
      countryCode: 'SY',
      country: 'Syria',
      city: 'Aleppo',
      formattedAddress: 'Aleppo',
      lat: 36.2,
      lng: 37.16,
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Country and calling code')).toHaveValue('SY'),
    );
    expect(reverseGeocodeViaNominatim).toHaveBeenCalledWith(
      36.2,
      37.16,
      'en',
      expect.any(AbortSignal),
    );
  });

  it('retains manual selection when permission is denied', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, failure: PositionErrorCallback) =>
      failure({ code: 1 } as GeolocationPositionError),
    );
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Country and calling code'), {
      target: { value: 'SA' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SA');
    expect(screen.getByRole('status')).toHaveTextContent('Choose your country manually');
    expect(reverseGeocodeViaNominatim).not.toHaveBeenCalled();
  });

  it('does not overwrite a manual choice made while a geocoder request is pending', async () => {
    let resolve: (value: Awaited<ReturnType<typeof reverseGeocodeViaNominatim>>) => void = () => {};
    vi.mocked(reverseGeocodeViaNominatim).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { latitude: 36.2, longitude: 37.16 } } as GeolocationPosition),
      },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    fireEvent.change(screen.getByLabelText('Country and calling code'), {
      target: { value: 'SE' },
    });
    await act(async () =>
      resolve({
        status: 'ok',
        countryCode: 'SY',
        country: 'Syria',
        city: 'Aleppo',
        formattedAddress: 'Aleppo',
        lat: 36.2,
        lng: 37.16,
      }),
    );
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SE');
  });

  it('filters country choices by Arabic text and returns the ISO identity', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Search countries' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'الجزائر' } });
    expect(screen.getByRole('option', { name: /Algeria/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /United States/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Country and calling code'), {
      target: { value: 'DZ' },
    });
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('DZ');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});
