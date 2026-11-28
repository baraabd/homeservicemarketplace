import { StrictMode, useState, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function setDeviceTimezone(timeZone: string) {
  const options = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...options,
    timeZone,
  });
}

beforeEach(() => {
  // Locale fallback tests must not depend on the test runner's local timezone.
  setDeviceTimezone('UTC');
});

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
  it('uses the device locale when the timezone is unknown without location or network', () => {
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
    setDeviceTimezone(timeZone);
    render(<Harness />);
    expect(screen.getByLabelText('Country and calling code')).toHaveValue(country);
  });

  it.each(
    (['seeker', 'provider', 'admin'] as const).flatMap((experience) =>
      (['en', 'ar'] as const).map((lang) => [experience, lang] as const),
    ),
  )(
    'suggests Sweden without a location card or external lookup for %s / %s',
    (experience, lang) => {
      const getCurrentPosition = vi.fn();
      const watchPosition = vi.fn();
      const fetch = vi.fn();
      vi.stubGlobal('navigator', {
        language: 'en-US',
        languages: ['en-US', 'sv-SE'],
        geolocation: { getCurrentPosition, watchPosition },
      });
      vi.stubGlobal('fetch', fetch);
      setDeviceTimezone('Europe/Stockholm');
      localStorage.setItem('hsm.lang', lang);
      render(
        <LanguageProvider>
          <Harness experience={experience} />
        </LanguageProvider>,
      );
      const country = screen.getByTestId('dial-code-select');
      const phone = screen.getByLabelText(
        lang === 'ar' ? 'رقم الهاتف المسجل في واتساب' : 'WhatsApp phone number',
      );
      expect(country).toHaveValue('SE');
      expect(country).toBeEnabled();
      expect(screen.getByTestId('selected-country-flag')).toHaveAttribute('data-country', 'SE');
      expect(phone.parentElement).toHaveTextContent('+46');
      expect(
        screen.queryByRole('button', { name: /Use my location|استخدم موقعي/u }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/OpenStreetMap/u)).not.toBeInTheDocument();

      fireEvent.change(phone, { target: { value: '0701234567' } });
      expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+46701234567');
      fireEvent.change(country, { target: { value: 'SY' } });
      expect(country).toHaveValue('SY');
      expect(phone).toHaveValue('0701234567');
      fireEvent.click(
        screen.getByRole('button', {
          name: lang === 'ar' ? 'ابحث عن الدولة' : 'Search countries',
        }),
      );
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'SE' } });
      fireEvent.change(country, { target: { value: 'SE' } });
      expect(country).toHaveValue('SE');
      expect(phone).toHaveValue('0701234567');
      expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+46701234567');
      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(watchPosition).not.toHaveBeenCalled();
      expect(reverseGeocodeViaNominatim).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

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
    setDeviceTimezone('America/New_York');
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

  it('never calls change callbacks for an incompatible manual override of a full number', () => {
    const onCountryChange = vi.fn();
    const onNumberChange = vi.fn();
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
    expect(onCountryChange).not.toHaveBeenCalled();
    expect(onNumberChange).not.toHaveBeenCalled();
  });

  it('does not invent a country for an unsupported shared international calling code', () => {
    render(<Harness initialCountry="SE" />);
    const country = screen.getByLabelText('Country and calling code');
    const phone = screen.getByLabelText('WhatsApp phone number');
    fireEvent.change(phone, { target: { value: '+7 701 123 4567' } });
    expect(country).toHaveValue('');
    expect(screen.getByTestId('selected-country-flag')).toHaveAttribute('data-country', '');
    expect(screen.getByText(/No country is assumed for this prefix/u)).toBeInTheDocument();
    expect(phone).toHaveValue('+7 701 123 4567');
    expect(screen.getByTestId('submitted-phone')).toHaveTextContent('+77011234567');
  });

  it('preserves country and number values restored by the parent after mount', () => {
    const callbacks = { onCountryChange: vi.fn(), onNumberChange: vi.fn() };
    const { rerender } = render(
      <PhoneIdentityField countryCode="SA" localNumber="" {...callbacks} />,
    );
    rerender(<PhoneIdentityField countryCode="SE" localNumber="0701234567" {...callbacks} />);
    expect(callbacks.onCountryChange).not.toHaveBeenCalled();
    expect(callbacks.onNumberChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Country and calling code')).toHaveValue('SE');
    expect(screen.getByLabelText('WhatsApp phone number')).toHaveValue('0701234567');
  });
});
