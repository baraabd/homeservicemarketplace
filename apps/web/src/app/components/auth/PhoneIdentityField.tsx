import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { MapPin, Phone, Search } from 'lucide-react';
import { COUNTRY_DIAL_CODES } from '../../../lib/country-dial-codes';
import { countryFlag } from '../../../lib/phone-identity';
import { reverseGeocodeViaNominatim } from '../../../lib/reverse-geocode';
import { useLang } from '../../i18n/LanguageContext';

interface PhoneIdentityFieldProps {
  countryCode: string;
  onCountryChange: (iso2: string) => void;
  localNumber: string;
  onNumberChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}

const ARABIC_COUNTRIES: Readonly<Record<string, string>> = {
  AE: 'الإمارات العربية المتحدة',
  AU: 'أستراليا',
  BH: 'البحرين',
  BR: 'البرازيل',
  CA: 'كندا',
  CH: 'سويسرا',
  DE: 'ألمانيا',
  DJ: 'جيبوتي',
  DZ: 'الجزائر',
  EG: 'مصر',
  ES: 'إسبانيا',
  FR: 'فرنسا',
  GB: 'المملكة المتحدة',
  IN: 'الهند',
  IQ: 'العراق',
  IT: 'إيطاليا',
  JO: 'الأردن',
  KM: 'جزر القمر',
  KW: 'الكويت',
  LB: 'لبنان',
  LY: 'ليبيا',
  MA: 'المغرب',
  MR: 'موريتانيا',
  NL: 'هولندا',
  OM: 'عُمان',
  PS: 'فلسطين',
  QA: 'قطر',
  SA: 'السعودية',
  SD: 'السودان',
  SE: 'السويد',
  SO: 'الصومال',
  SY: 'سوريا',
  TN: 'تونس',
  TR: 'تركيا',
  US: 'الولايات المتحدة',
  YE: 'اليمن',
};

const COPY = {
  en: {
    country: 'Country and calling code',
    choose: 'Choose country',
    search: 'Search countries',
    number: 'WhatsApp phone number',
    hint: 'Use the number registered with WhatsApp. You can also paste a full number starting with +.',
    locate: 'Use my location',
    locating: 'Finding your country…',
    privacy:
      'Only if you choose this option, your location is shared with OpenStreetMap to find your country. You can select it manually instead.',
    denied: 'Location was not available. Choose your country manually to continue.',
    failed: 'We could not identify your country. Choose it manually to continue.',
    found: 'Country selected from your location. Check the calling code before continuing.',
    noMatches: 'No matching countries. Clear the search or enter the full international number.',
  },
  ar: {
    country: 'الدولة ومفتاح الاتصال',
    choose: 'اختر الدولة',
    search: 'ابحث عن الدولة',
    number: 'رقم الهاتف المسجل في واتساب',
    hint: 'استخدم الرقم المسجل في واتساب. يمكنك أيضاً لصق الرقم الدولي كاملاً ابتداءً بعلامة +.',
    locate: 'استخدم موقعي',
    locating: 'جارٍ تحديد الدولة…',
    privacy:
      'عند اختيار هذا الخيار فقط، تتم مشاركة موقعك مع OpenStreetMap لتحديد الدولة. يمكنك اختيار الدولة يدوياً بدلاً من ذلك.',
    denied: 'لم يتوفر الموقع. اختر دولتك يدوياً للمتابعة.',
    failed: 'تعذر تحديد الدولة. اخترها يدوياً للمتابعة.',
    found: 'تم اختيار الدولة من موقعك. تحقق من مفتاح الاتصال قبل المتابعة.',
    noMatches: 'لا توجد دولة مطابقة. امسح البحث أو أدخل الرقم الدولي كاملاً.',
  },
} as const;

const fieldClass =
  'min-h-12 w-full min-w-0 rounded-2xl border-2 border-slate-200 bg-white px-3 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50 disabled:text-slate-500';

/** No location, locale or timezone lookup runs until the person requests it. */
export function PhoneIdentityField({
  countryCode,
  onCountryChange,
  localNumber,
  onNumberChange,
  disabled = false,
  error,
}: PhoneIdentityFieldProps) {
  const { lang } = useLang();
  const copy = COPY[lang];
  const id = useId();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'denied' | 'failed' | 'found' | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const requestTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = COUNTRY_DIAL_CODES.find((entry) => entry.iso2 === countryCode);
  const countries = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return COUNTRY_DIAL_CODES.filter(
      (entry) =>
        !term ||
        `${entry.name} ${ARABIC_COUNTRIES[entry.iso2] ?? ''} ${entry.iso2} ${entry.dialCode}`
          .toLocaleLowerCase()
          .includes(term),
    ).sort((a, b) =>
      (lang === 'ar' ? (ARABIC_COUNTRIES[a.iso2] ?? a.name) : a.name).localeCompare(
        lang === 'ar' ? (ARABIC_COUNTRIES[b.iso2] ?? b.name) : b.name,
        lang,
      ),
    );
  }, [search, lang]);

  const cancelRequest = useCallback(() => {
    request.current?.abort();
    if (requestTimeout.current !== null) clearTimeout(requestTimeout.current);
    requestTimeout.current = null;
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      cancelRequest();
    },
    [cancelRequest],
  );
  useEffect(() => {
    if (!disabled) return;
    generation.current += 1;
    cancelRequest();
  }, [disabled, cancelRequest]);
  if (disabled && locating) setLocating(false);

  function selectCountry(value: string) {
    generation.current += 1;
    cancelRequest();
    setLocating(false);
    setLocationStatus(null);
    onCountryChange(value);
    setSearch('');
    setSearchOpen(false);
  }

  function detectCountry() {
    if (disabled || locating) return;
    setLocationStatus(null);
    if (!navigator.geolocation) {
      setLocationStatus('denied');
      return;
    }
    const current = ++generation.current;
    cancelRequest();
    const controller = new AbortController();
    request.current = controller;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (current !== generation.current) return;
        // Reduce coordinate precision before sharing: only a country is needed.
        const lat = Number(position.coords.latitude.toFixed(2));
        const lng = Number(position.coords.longitude.toFixed(2));
        requestTimeout.current = setTimeout(() => {
          if (current !== generation.current) return;
          generation.current += 1;
          controller.abort();
          setLocating(false);
          setLocationStatus('failed');
        }, 10_000);
        void reverseGeocodeViaNominatim(lat, lng, lang, controller.signal)
          .then((result) => {
            if (current !== generation.current) return;
            if (requestTimeout.current !== null) clearTimeout(requestTimeout.current);
            requestTimeout.current = null;
            setLocating(false);
            const iso2 = result.status === 'ok' ? result.countryCode : undefined;
            if (!iso2 || !COUNTRY_DIAL_CODES.some((entry) => entry.iso2 === iso2)) {
              setLocationStatus('failed');
              return;
            }
            onCountryChange(iso2);
            setSearch('');
            setSearchOpen(false);
            setLocationStatus('found');
          })
          .catch(() => {
            if (current !== generation.current) return;
            if (requestTimeout.current !== null) clearTimeout(requestTimeout.current);
            requestTimeout.current = null;
            setLocating(false);
            setLocationStatus('failed');
          });
      },
      () => {
        if (current !== generation.current) return;
        setLocating(false);
        setLocationStatus('denied');
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div>
        <label
          htmlFor={`${id}-country`}
          className="mb-1.5 block text-sm font-semibold text-slate-700"
        >
          {copy.country}
        </label>
        <div className="flex items-start gap-2">
          <select
            id={`${id}-country`}
            data-testid="dial-code-select"
            className={fieldClass}
            value={countryCode}
            disabled={disabled}
            onChange={(event) => selectCountry(event.target.value)}
          >
            <option value="">{copy.choose}</option>
            {selected && !countries.some((entry) => entry.iso2 === selected.iso2) && (
              <option value={selected.iso2}>
                {countryFlag(selected.iso2)}{' '}
                {lang === 'ar' ? (ARABIC_COUNTRIES[selected.iso2] ?? selected.name) : selected.name}{' '}
                {selected.dialCode}
              </option>
            )}
            {countries.map((entry) => (
              <option key={entry.iso2} value={entry.iso2}>
                {countryFlag(entry.iso2)}{' '}
                {lang === 'ar' ? (ARABIC_COUNTRIES[entry.iso2] ?? entry.name) : entry.name}{' '}
                {entry.dialCode}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={disabled}
            aria-label={copy.search}
            aria-expanded={searchOpen}
            aria-controls={`${id}-search`}
            onClick={() => {
              setSearchOpen((value) => !value);
              setSearch('');
            }}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
          >
            <Search size={19} aria-hidden="true" />
          </button>
        </div>
        {searchOpen && (
          <div className="mt-2" id={`${id}-search`}>
            <label htmlFor={`${id}-search-input`} className="sr-only">
              {copy.search}
            </label>
            <input
              id={`${id}-search-input`}
              type="search"
              className={fieldClass}
              value={search}
              placeholder={copy.search}
              disabled={disabled}
              onChange={(event) => setSearch(event.target.value)}
              autoFocus
            />
            {countries.length === 0 && (
              <p role="status" className="mt-1 text-sm text-slate-600">
                {copy.noMatches}
              </p>
            )}
          </div>
        )}
      </div>
      <div>
        <label
          htmlFor={`${id}-phone`}
          className="mb-1.5 block text-sm font-semibold text-slate-700"
        >
          {copy.number}
        </label>
        <div className="relative" dir="ltr">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center gap-2 text-slate-600"
          >
            <Phone size={17} />
            {selected?.dialCode}
          </span>
          <input
            id={`${id}-phone`}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            value={localNumber}
            disabled={disabled}
            onChange={(event) => onNumberChange(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
            className={`${fieldClass} ${selected ? 'pl-28' : 'pl-10'}`}
          />
        </div>
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-relaxed text-slate-600">
          {copy.hint}
        </p>
        {error && (
          <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <p id={`${id}-privacy`} className="text-xs leading-relaxed text-slate-600">
          {copy.privacy}
        </p>
        <button
          type="button"
          onClick={detectCountry}
          disabled={disabled || locating}
          aria-describedby={`${id}-privacy`}
          className="mt-1 flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
        >
          <MapPin size={17} aria-hidden="true" />
          {locating ? copy.locating : copy.locate}
        </button>
        <p role="status" className="text-sm text-slate-600">
          {locationStatus ? copy[locationStatus] : ''}
        </p>
      </div>
    </div>
  );
}
