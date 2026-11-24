import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Phone, Search } from 'lucide-react';
import { AUTH_EXPERIENCES, type AuthExperienceId } from '../../../lib/auth-experience';
import { getDevicePhoneCountry } from '../../../lib/phone-country';
import { phoneCountryDisplay } from '../../../lib/phone-identity';
import { useLang } from '../../i18n/LanguageContext';
import { CountryFlag } from './CountryFlag';

interface PhoneIdentityFieldProps {
  countryCode: string;
  onCountryChange: (iso2: string) => void;
  localNumber: string;
  onNumberChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  experience?: AuthExperienceId;
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
    countryHint: 'Check the selected country. Its calling code is added automatically.',
    choose: 'Choose country',
    search: 'Search countries',
    number: 'WhatsApp phone number',
    hint: 'Use the number registered with WhatsApp. You can also paste a full number starting with +.',
    noMatches: 'No matching countries. Clear the search or enter the full international number.',
    international: 'The full number sets the calling code. Edit the number to change it.',
    shared:
      'This calling code is shared. Choose your country if listed; the number stays unchanged.',
    unresolved:
      'No country is assumed for this prefix. You can use a complete international number without selecting a country.',
  },
  ar: {
    country: 'الدولة ومفتاح الاتصال',
    countryHint: 'تحقق من الدولة المختارة. يُضاف مفتاح الاتصال تلقائياً.',
    choose: 'اختر الدولة',
    search: 'ابحث عن الدولة',
    number: 'رقم الهاتف المسجل في واتساب',
    hint: 'استخدم الرقم المسجل في واتساب. يمكنك أيضاً لصق الرقم الدولي كاملاً ابتداءً بعلامة +.',
    noMatches: 'لا توجد دولة مطابقة. امسح البحث أو أدخل الرقم الدولي كاملاً.',
    international: 'يحدد الرقم الدولي مفتاح الاتصال. عدّل الرقم لتغييره.',
    shared: 'مفتاح الاتصال مشترك. اختر دولتك إن كانت مدرجة؛ سيبقى الرقم كما أدخلته.',
    unresolved: 'لا نفترض دولة لهذا المفتاح. يمكنك استخدام الرقم الدولي كاملاً دون اختيار دولة.',
  },
} as const;

const baseFieldClass =
  'min-h-12 w-full min-w-0 rounded-2xl border-2 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-600 focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-500';

/** Device settings suggest the initial country without requesting coordinates. */
export function PhoneIdentityField({
  countryCode,
  onCountryChange,
  localNumber,
  onNumberChange,
  disabled = false,
  error,
  experience = 'seeker',
}: PhoneIdentityFieldProps) {
  const { lang, dir } = useLang();
  const copy = COPY[lang];
  const theme = AUTH_EXPERIENCES[experience].classes;
  const fieldClass = `${baseFieldClass} border-slate-200 ${theme.focusRing}`;
  const id = useId();
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const initialized = useRef(false);
  const automaticCountry = useRef<string | null>(null);

  useEffect(() => {
    if (initialized.current || disabled) return;
    initialized.current = true;
    // Restored national digits without a country also remain untouched: a
    // device hint must not silently reinterpret an existing phone number.
    if (countryCode.trim() || localNumber.trim()) return;
    const suggestion = getDevicePhoneCountry();
    automaticCountry.current = suggestion;
    onCountryChange(suggestion);
  }, [countryCode, localNumber, onCountryChange, disabled]);

  const display = useMemo(
    () => phoneCountryDisplay(countryCode, localNumber),
    [countryCode, localNumber],
  );
  const selected = display.country;
  const countryLocked = display.international && !display.needsCountryChoice;
  const countries = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return display.choices
      .filter(
        (entry) =>
          !term ||
          `${entry.name} ${ARABIC_COUNTRIES[entry.iso2] ?? ''} ${entry.iso2} ${entry.dialCode}`
            .toLocaleLowerCase()
            .includes(term),
      )
      .sort((a, b) =>
        (lang === 'ar' ? (ARABIC_COUNTRIES[a.iso2] ?? a.name) : a.name).localeCompare(
          lang === 'ar' ? (ARABIC_COUNTRIES[b.iso2] ?? b.name) : b.name,
          lang,
        ),
      );
  }, [search, lang, display.choices]);

  function selectCountry(value: string) {
    if (
      disabled ||
      countryLocked ||
      (display.international && value && !display.choices.some((entry) => entry.iso2 === value))
    )
      return;
    automaticCountry.current = null;
    onCountryChange(value);
    setSearch('');
    setSearchOpen(false);
  }

  function changeNumber(value: string) {
    // Locale/timezone hints cannot identify a country for shared prefixes
    // such as +1. Keep only an explicit/restored choice when pasting one.
    const next = phoneCountryDisplay(
      automaticCountry.current === countryCode ? '' : countryCode,
      value,
    );
    if (next.international) automaticCountry.current = null;
    if (next.international && next.country?.iso2 !== countryCode) {
      onCountryChange(next.country?.iso2 ?? '');
    }
    setSearch('');
    setSearchOpen(false);
    onNumberChange(value);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" dir={dir}>
      <div>
        <label
          htmlFor={`${id}-country`}
          className="mb-1.5 block text-sm font-semibold text-slate-700"
        >
          {copy.country}
        </label>
        <div className="flex items-start gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center">
              <CountryFlag iso2={selected?.iso2} />
            </span>
            <select
              id={`${id}-country`}
              data-testid="dial-code-select"
              className={`${fieldClass} appearance-none ps-14 pe-9`}
              value={selected?.iso2 ?? ''}
              disabled={disabled || countryLocked}
              aria-describedby={`${id}-country-hint`}
              onChange={(event) => selectCountry(event.target.value)}
            >
              <option value="">{copy.choose}</option>
              {selected && !countries.some((entry) => entry.iso2 === selected.iso2) && (
                <option value={selected.iso2}>
                  {lang === 'ar'
                    ? (ARABIC_COUNTRIES[selected.iso2] ?? selected.name)
                    : selected.name}{' '}
                  {`\u2066${selected.dialCode}\u2069`}
                </option>
              )}
              {countries.map((entry) => (
                <option key={entry.iso2} value={entry.iso2}>
                  {lang === 'ar' ? (ARABIC_COUNTRIES[entry.iso2] ?? entry.name) : entry.name}{' '}
                  {`\u2066${entry.dialCode}\u2069`}
                </option>
              ))}
            </select>
            <ChevronDown
              size={17}
              aria-hidden="true"
              className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-slate-500"
            />
          </div>
          <button
            type="button"
            disabled={disabled || countryLocked}
            aria-label={copy.search}
            aria-expanded={searchOpen}
            aria-controls={`${id}-search`}
            onClick={() => {
              setSearchOpen((value) => !value);
              setSearch('');
            }}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 border-slate-200 text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 ${theme.focusOutline} disabled:opacity-50`}
          >
            <Search size={19} aria-hidden="true" />
          </button>
        </div>
        <p id={`${id}-country-hint`} className="mt-1.5 text-xs leading-relaxed text-slate-600">
          {!display.international
            ? copy.countryHint
            : display.needsCountryChoice
              ? copy.shared
              : selected
                ? copy.international
                : copy.unresolved}
        </p>
        {searchOpen && !countryLocked && (
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
            {!display.international && selected && (
              <bdi className="font-semibold tabular-nums">{selected.dialCode}</bdi>
            )}
          </span>
          <input
            id={`${id}-phone`}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={localNumber}
            disabled={disabled}
            onChange={(event) => changeNumber(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
            className={`${baseFieldClass} ${theme.focusRing} ${error ? 'border-red-600' : 'border-slate-200'} ${selected && !display.international ? 'pl-28' : 'pl-10'}`}
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
    </div>
  );
}
