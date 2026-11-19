import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reverseGeocodeViaNominatim } from '../../../lib/reverse-geocode';
import { toE164Phone } from '../../../lib/phone-identity';
import { PhoneIdentityField } from './PhoneIdentityField';

vi.mock('../../../lib/reverse-geocode', () => ({ reverseGeocodeViaNominatim: vi.fn() }));

function Harness() {
  const [countryCode, setCountryCode] = useState('');
  const [number, setNumber] = useState('');
  return (
    <>
      <PhoneIdentityField
        countryCode={countryCode}
        onCountryChange={setCountryCode}
        localNumber={number}
        onNumberChange={setNumber}
      />
      <span data-testid="submitted-phone">{toE164Phone(countryCode, number)}</span>
    </>
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

  it.each(['+963 944123456', '00963 944123456', '+٩٦٣ ٩٤٤١٢٣٤٥٦', '٠۰۹۶۳ ۹٤۴۱۲۳٤۵۶'])(
    'replaces an incompatible Saudi display with Syria without rewriting the pasted number %s',
    (number) => {
      render(<Harness />);
      const country = screen.getByLabelText('Country and calling code');
      const phone = screen.getByLabelText('WhatsApp phone number');
      fireEvent.change(country, { target: { value: 'SA' } });
      fireEvent.change(phone, { target: { value: number } });
      expect(country).toHaveValue('SY');
      expect(screen.getByRole('option', { name: /🇸🇾.*Syria.*\+963/u })).toBeInTheDocument();
      expect(country).toBeDisabled();
      expect(phone).toHaveValue(number);
      expect(phone.parentElement).not.toHaveTextContent('+963');
      expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+963944123456');
      expect(screen.queryByRole('option', { name: /Saudi Arabia/u })).not.toBeInTheDocument();
    },
  );

  it('changes country only through a changed full number, and restores manual choice for national input', () => {
    render(<Harness />);
    const country = screen.getByLabelText('Country and calling code');
    const phone = screen.getByLabelText('WhatsApp phone number');
    fireEvent.change(phone, { target: { value: '+963944123456' } });
    fireEvent.change(country, { target: { value: 'SA' } });
    expect(phone).toHaveValue('+963944123456');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+963944123456');
    fireEvent.change(phone, { target: { value: '+966501234567' } });
    expect(country).toHaveValue('SA');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+966501234567');
    fireEvent.change(phone, { target: { value: '0501234567' } });
    expect(country).toBeEnabled();
    fireEvent.change(country, { target: { value: 'SY' } });
    expect(phone).toHaveValue('0501234567');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+963501234567');
  });

  it('leaves +1 unresolved until a compatible country is explicitly selected', () => {
    render(<Harness />);
    const country = screen.getByLabelText('Country and calling code');
    const phone = screen.getByLabelText('WhatsApp phone number');
    fireEvent.change(country, { target: { value: 'SA' } });
    fireEvent.change(phone, { target: { value: '+1 4165550123' } });
    expect(country).toHaveValue('');
    expect(country).toBeEnabled();
    expect(screen.getByText(/calling code is shared/u)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Saudi Arabia/u })).not.toBeInTheDocument();
    fireEvent.change(country, { target: { value: 'CA' } });
    expect(country).toHaveValue('CA');
    expect(phone).toHaveValue('+1 4165550123');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+14165550123');
    fireEvent.change(phone, { target: { value: '+1 4165550456' } });
    expect(country).toHaveValue('CA');
    fireEvent.change(phone, { target: { value: '+' } });
    expect(country).toHaveValue('');
    expect(screen.getByTestId('submitted-phone')).toBeEmptyDOMElement();
  });

  it('does not request location after a full international number has been entered', () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('WhatsApp phone number'), {
      target: { value: '+963944123456' },
    });
    const locate = screen.getByRole('button', { name: 'Use my location' });
    expect(locate).toBeDisabled();
    fireEvent.click(locate);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(reverseGeocodeViaNominatim).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SY');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+963944123456');
  });

  it('never calls a country or number change callback for an incompatible manual or location override', () => {
    const onCountryChange = vi.fn();
    const onNumberChange = vi.fn();
    const getCurrentPosition = vi.fn();
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    render(
      <PhoneIdentityField
        countryCode="SA"
        localNumber="+963944123456"
        onCountryChange={onCountryChange}
        onNumberChange={onNumberChange}
      />,
    );
    const country = screen.getByLabelText('Country and calling code');
    expect(country).toHaveValue('SY');
    expect(country).toBeDisabled();
    fireEvent.change(country, { target: { value: 'SA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(onCountryChange).not.toHaveBeenCalled();
    expect(onNumberChange).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('cancels a pending browser location lookup on every phone edit before coordinates are shared', () => {
    let locate: PositionCallback = () => {};
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) => {
          locate = success;
        },
      },
    });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Country and calling code'), {
      target: { value: 'SA' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    fireEvent.change(screen.getByLabelText('WhatsApp phone number'), {
      target: { value: '0501234567' },
    });
    act(() => locate({ coords: { latitude: 36.2, longitude: 37.16 } } as GeolocationPosition));
    expect(reverseGeocodeViaNominatim).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SA');
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+966501234567');
  });

  it('ignores a stale geocoder response after an international number is pasted', async () => {
    let resolve: (value: Awaited<ReturnType<typeof reverseGeocodeViaNominatim>>) => void = () => {};
    vi.mocked(reverseGeocodeViaNominatim).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { latitude: 24.7, longitude: 46.67 } } as GeolocationPosition),
      },
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    const signal = vi.mocked(reverseGeocodeViaNominatim).mock.calls[0]![3] as AbortSignal;
    fireEvent.change(screen.getByLabelText('WhatsApp phone number'), {
      target: { value: '+963944123456' },
    });
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolve({
        status: 'ok',
        countryCode: 'SA',
        country: 'Saudi Arabia',
        city: 'Riyadh',
        formattedAddress: 'Riyadh',
        lat: 24.7,
        lng: 46.67,
      }),
    );
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SY');
    expect(screen.getByLabelText('WhatsApp phone number')).toHaveValue('+963944123456');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+963944123456');
  });
});
