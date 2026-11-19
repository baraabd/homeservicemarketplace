import { useState } from 'react';
import { Globe2 } from 'lucide-react';
import { countryFlag } from '../../../lib/phone-identity';

// The small supported-country subset is bundled locally, with its MIT license.
// SVGs display consistently even where the OS does not render flag emoji.
// Keep their bytes out of the auth JavaScript; fetch only the selected asset.
const FLAG_ASSETS = import.meta.glob<string>('../../../assets/country-flags/*.svg', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

/** Decorative: the adjacent native country control supplies the accessible name. */
export function CountryFlag({ iso2 }: { iso2?: string }) {
  const [failedCountry, setFailedCountry] = useState<string | null>(null);
  const country = iso2?.toUpperCase();
  const source = country
    ? FLAG_ASSETS[`../../../assets/country-flags/${country.toLowerCase()}.svg`]
    : undefined;

  return (
    <span
      aria-hidden="true"
      data-testid="selected-country-flag"
      data-country={country ?? ''}
      className="inline-flex h-6 w-8 shrink-0 items-center justify-center overflow-hidden rounded-sm text-2xl leading-none text-slate-500"
    >
      {source && failedCountry !== country ? (
        <img
          src={source}
          alt=""
          width={32}
          height={24}
          draggable={false}
          className="h-full w-full object-cover ring-1 ring-inset ring-black/10"
          onError={() => setFailedCountry(country ?? null)}
        />
      ) : country ? (
        countryFlag(country)
      ) : (
        <Globe2 size={22} />
      )}
    </span>
  );
}
