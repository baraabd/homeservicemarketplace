import { StrictMode, useState, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reverseGeocodeViaNominatim } from '../../../lib/reverse-geocode';
import { toE164Phone } from '../../../lib/phone-identity';
import { LanguageProvider, useLang } from '../../i18n/LanguageContext';
import { PhoneIdentityField } from './PhoneIdentityField';

vi.mock('../../../lib/reverse-geocode', () => ({ reverseGeocodeViaNominatim: vi.fn() }));

type HarnessProps = Pick<
  ComponentProps<typeof PhoneIdentityField>,
  'disabled' | 'error' | 'experience'
> & {
  initialCountry?: string;
  initialNumber?: string;
};

function Harness({ initialCountry = '', initialNumber = '', ...props }: HarnessProps = {}) {
  const [countryCode, setCountryCode] = useState(initialCountry);
  const [number, setNumber] = useState(initialNumber);
  return (
    <>
      <PhoneIdentityField
        {...props}
        countryCode={countryCode}
        onCountryChange={setCountryCode}
        localNumber={number}
        onNumberChange={setNumber}
      />
      <span data-testid="submitted-phone">{toE164Phone(countryCode, number)}</span>
    </>
  );
}

function LanguageControl() {
  const { toggleLang } = useLang();
  return <button onClick={toggleLang}>Change language</button>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
});

describe('phone country selection', () => {
  it('suggests the device region on mount without requesting location or network', () => {
    const getCurrentPosition = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal('navigator', { language: 'en-US', geolocation: { getCurrentPosition } });
    vi.stubGlobal('fetch', fetch);
    render(<Harness />);
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('US');
    expect(screen.getByTestId('selected-country-flag')).toHaveAttribute('data-country', 'US');
    expect(screen.getByTestId('selected-country-flag').querySelector('img')).not.toBeNull();
    expect(screen.getByLabelText('WhatsApp phone number').parentElement).toHaveTextContent('+1');
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(reverseGeocodeViaNominatim).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['Europe/Stockholm', 'SE'],
    ['Asia/Damascus', 'SY'],
    ['Etc/UTC', 'SA'],
  ])('falls back from a regionless locale using %s', (timeZone, country) => {
    vi.stubGlobal('navigator', { language: 'ar', languages: ['ar', 'en'] });
    const options = Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...options,
      timeZone,
    });
    render(<Harness />);
    expect(screen.getByLabelText('Country and calling code')).toHaveValue(country);
  });

  it('preserves restored countries and digits instead of reinterpreting them from device hints', () => {
    vi.stubGlobal('navigator', { language: 'ar-SA' });
    render(<Harness initialCountry="SE" initialNumber="0701234567" />);
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SE');
    expect(screen.getByLabelText('WhatsApp phone number')).toHaveValue('0701234567');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+46701234567');
  });

  it('requires an explicit country for restored national digits without a country', () => {
    vi.stubGlobal('navigator', { language: 'ar-SA' });
    render(<Harness initialNumber="0701234567" />);
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('');
    expect(screen.getByLabelText('WhatsApp phone number')).toHaveValue('0701234567');
    expect(screen.getByTestId('submitted-phone')).toBeEmptyDOMElement();
    fireEvent.change(screen.getByLabelText('Country and calling code'), {
      target: { value: 'SE' },
    });
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+46701234567');
  });

  it('initializes only once under StrictMode', () => {
    const onCountryChange = vi.fn();
    vi.stubGlobal('navigator', { language: 'ar-SA' });
    const props = { countryCode: '', localNumber: '', onCountryChange, onNumberChange: vi.fn() };
    const { rerender } = render(
      <StrictMode>
        <PhoneIdentityField {...props} />
      </StrictMode>,
    );
    expect(onCountryChange).toHaveBeenCalledExactlyOnceWith('SA');
    rerender(
      <StrictMode>
        <PhoneIdentityField {...props} experience="provider" />
      </StrictMode>,
    );
    expect(onCountryChange).toHaveBeenCalledTimes(1);
  });

  it('does not restore an automatic hint after the person deliberately clears the country', () => {
    vi.stubGlobal('navigator', { language: 'ar-SA' });
    const { rerender } = render(<Harness />);
    fireEvent.change(screen.getByLabelText('Country and calling code'), { target: { value: '' } });
    vi.stubGlobal('navigator', { language: 'sv-SE' });
    rerender(<Harness experience="provider" />);
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('');
    expect(screen.getByTestId('selected-country-flag')).toHaveAttribute('data-country', '');
  });

  it('waits until a disabled empty field is enabled before initializing', () => {
    vi.stubGlobal('navigator', { language: 'sv-SE' });
    const { rerender } = render(<Harness disabled />);
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('');
    rerender(<Harness />);
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SE');
  });

  it('preserves manual selection and number across language, device hints, and role rerenders', () => {
    vi.stubGlobal('navigator', { language: 'ar-SA' });
    const { rerender } = render(
      <LanguageProvider>
        <LanguageControl />
        <Harness />
      </LanguageProvider>,
    );
    fireEvent.change(screen.getByLabelText('Country and calling code'), {
      target: { value: 'SE' },
    });
    fireEvent.change(screen.getByLabelText('WhatsApp phone number'), {
      target: { value: '٠٧٠١٢٣٤٥٦٧' },
    });
    vi.stubGlobal('navigator', { language: 'en-US' });
    fireEvent.click(screen.getByRole('button', { name: 'Change language' }));
    rerender(
      <LanguageProvider>
        <LanguageControl />
        <Harness experience="admin" />
      </LanguageProvider>,
    );
    expect(screen.getByLabelText('الدولة ومفتاح الاتصال')).toHaveValue('SE');
    expect(screen.getByRole('option', { name: /السويد.*\+46/u })).toBeInTheDocument();
    const phone = screen.getByLabelText('رقم الهاتف المسجل في واتساب');
    expect(phone).toHaveValue('٠٧٠١٢٣٤٥٦٧');
    expect(phone.parentElement).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+46701234567');
    expect(screen.getByTestId('selected-country-flag')).toHaveAttribute('data-country', 'SE');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('shows the validation error with an accessible association and preserves entered digits', () => {
    const { rerender } = render(
      <Harness initialCountry="SA" error="Enter a valid WhatsApp number." />,
    );
    const phone = screen.getByLabelText('WhatsApp phone number');
    fireEvent.change(phone, { target: { value: '٠٥٠١٢٣٤٥٦٧' } });
    expect(phone).toHaveValue('٠٥٠١٢٣٤٥٦٧');
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(phone.getAttribute('aria-describedby')?.split(' ')).toContain(
      screen.getByRole('alert').id,
    );
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+966501234567');
    rerender(<Harness />);
    expect(phone).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['en-US', '+1 4165550123'],
    ['en-GB', '+44 7911123456'],
    ['it-IT', '+39 0612345678'],
    ['en-AU', '+61 412345678'],
    ['ar-MA', '+212 612345678'],
  ])(
    'does not turn the automatic %s hint into a definitive country for a shared prefix',
    (language, number) => {
      vi.stubGlobal('navigator', { language });
      render(<Harness />);
      fireEvent.change(screen.getByLabelText('WhatsApp phone number'), {
        target: { value: number },
      });
      expect(screen.getByLabelText('Country and calling code')).toHaveValue('');
      expect(screen.getByTestId('selected-country-flag')).toHaveAttribute('data-country', '');
      expect(screen.getByLabelText('WhatsApp phone number')).toHaveValue(number);
      expect(screen.getByTestId('submitted-phone')).toHaveTextContent(number.replaceAll(' ', ''));
    },
  );

  it('keeps an explicitly restored country for a compatible shared calling code', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    render(<Harness initialCountry="CA" />);
    fireEvent.change(screen.getByLabelText('WhatsApp phone number'), {
      target: { value: '+1 4165550123' },
    });
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('CA');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+14165550123');
  });

  it('keeps a country explicitly selected by the person, even when it matches the original device hint', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Country and calling code'), {
      target: { value: 'US' },
    });
    fireEvent.change(screen.getByLabelText('WhatsApp phone number'), {
      target: { value: '+1 2025550123' },
    });
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('US');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+12025550123');
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
    await waitFor(() => expect(reverseGeocodeViaNominatim).toHaveBeenCalledTimes(1));
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

  it('does not share coordinates when a manual edit cancels the lazy geocoder import', async () => {
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
    await act(async () => {});
    expect(reverseGeocodeViaNominatim).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SE');
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
  });

  it('filters country choices by Arabic text and returns the ISO identity', () => {
    render(<Harness initialCountry="SA" />);
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
      expect(screen.getByRole('option', { name: /Syria.*\+963/u })).toBeInTheDocument();
      expect(screen.getByTestId('selected-country-flag')).toHaveAttribute('data-country', 'SY');
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
    await waitFor(() => expect(reverseGeocodeViaNominatim).toHaveBeenCalledTimes(1));
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

  it('invalidates pending location work when a parent restores different country and number values', async () => {
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
    const callbacks = { onCountryChange: vi.fn(), onNumberChange: vi.fn() };
    const { rerender } = render(
      <PhoneIdentityField countryCode="SA" localNumber="" {...callbacks} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    await waitFor(() => expect(reverseGeocodeViaNominatim).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(reverseGeocodeViaNominatim).mock.calls[0]![3] as AbortSignal;
    rerender(<PhoneIdentityField countryCode="SE" localNumber="0701234567" {...callbacks} />);
    expect(signal.aborted).toBe(true);
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
    expect(callbacks.onCountryChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SE');
    expect(screen.getByLabelText('WhatsApp phone number')).toHaveValue('0701234567');
  });
});
