import { Globe, TriangleAlert } from 'lucide-react';
import type { SupportedMarketView } from '@homeservicemarketplace/contracts';

import { ProviderButton, ProviderField } from '../../provider-ui';
import { MARKET_COPY, countryName, type Lang } from '../copy/market-copy';
import type { MarketPrompt } from '../../../hooks/provider/useSupportedMarkets';
import { OnboardingAlert } from './OnboardingAlert';

// Sprint 09B.29 Phase 5B — the market substates of the approved work area.
//
// docs/provider-experience-v2/PHASE5A_INTEGRATION_GAPS.md G-01
// docs/provider-experience-v2/PHASE5_DEVIATION_REGISTER.md D5-01
//
// WHY THIS IS A SUBSTATE AND NOT A FIELD ON THE SCREEN
//
// `serviceAreaCountry` is REQUIRED by the completeness policy, and the approved
// work-area screen has nowhere to enter it — so a provider whose market was
// never recorded could fill in every task and still be refused at submission,
// with no screen able to fix it. That is G-01, and it is the only gap in the
// register that can stop somebody submitting at all.
//
// The approved screen is still right for what it depicts: a provider whose
// market is already known and still open, which is most of them. So this
// renders NOTHING in that case, and the canonical 390x844 cell for state 6 is
// unchanged — the reference is not modified, and neither is the screen it
// froze.
//
// WHAT IT REFUSES TO DO
//
// It never guesses a country. Cookie consent does not reveal one, a browser
// locale is a preference and not a location, and neither may silently overwrite
// a provider's explicit choice. Manual selection therefore works with cookies
// declined, geolocation denied and the resolver unavailable — because manual
// selection is the ONLY path here. A suggestion, if the platform ever offers
// one, has to arrive from the server and be confirmed before it is stored.
//
// The list is the server's: enabled markets only, in the operator's order. A
// country the operator has not opened cannot be chosen here, and would be
// refused on the write in any case.

export interface MarketPickerProps {
  prompt: MarketPrompt;
  lang: Lang;
  markets: readonly SupportedMarketView[];
  editable: boolean;
  pending: boolean;
  onChoose: (countryCode: string) => void;
  onRetry: () => void;
}

export function MarketPicker({
  prompt,
  lang,
  markets,
  editable,
  pending,
  onChoose,
  onRetry,
}: MarketPickerProps) {
  const copy = MARKET_COPY[lang];

  // The settled case draws nothing at all. Everything below is a question that
  // only exists because the server's answer made it necessary.
  if (prompt.kind === 'SETTLED') return null;

  if (prompt.kind === 'UNAVAILABLE') {
    return (
      <div className="grid gap-3" data-testid="market-unavailable">
        <OnboardingAlert
          tone="warning"
          icon={TriangleAlert}
          title={copy.unavailableTitle}
          body={copy.unavailableBody}
          density="compact"
        />
        <ProviderButton
          tone="secondary"
          shape="onboarding"
          size="block"
          onClick={onRetry}
          data-testid="market-retry"
        >
          {copy.retry}
        </ProviderButton>
      </div>
    );
  }

  if (prompt.kind === 'CONFIRM_TIMEZONE') {
    return (
      <TimezoneConfirmation
        market={prompt.market}
        lang={lang}
        editable={editable}
        pending={pending}
        onChoose={onChoose}
      />
    );
  }

  const withdrawn = prompt.kind === 'WITHDRAWN';

  return (
    <div className="grid gap-3" data-testid="market-picker">
      {withdrawn ? (
        // Said BEFORE the picker, because the provider needs to know their
        // answer was not lost before being asked for another one.
        <OnboardingAlert
          tone="warning"
          icon={Globe}
          title={copy.withdrawnTitle}
          body={copy.withdrawnBody(countryName(prompt.previousCountryCode, lang))}
          density="compact"
          data-testid="market-withdrawn"
        />
      ) : (
        <div>
          <h2 className="break-words text-pv-input font-medium text-pv-text">{copy.chooseTitle}</h2>
          <p className="mt-1 break-words text-pv-help leading-pv-help text-pv-muted">
            {copy.chooseBody}
          </p>
        </div>
      )}

      {/* A native `select`. It is the control every mobile platform renders as
          its own scrollable picker, it is keyboard-operable and
          screen-reader-labelled without any work, and the list is short and
          operator-controlled. A custom listbox would be more code and less
          accessible.

          The empty option is never pre-selected: a country chosen for somebody
          is a country they did not choose, and this one decides who can find
          them. */}
      <ProviderField label={copy.chooseLabel}>
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            data-testid="market-select"
            disabled={!editable || pending}
            defaultValue=""
            onChange={(event) => {
              const code = event.target.value;
              if (code !== '') onChoose(code);
            }}
            className="min-h-12 w-full rounded-pv-control border border-pv-border-strong bg-pv-surface px-[13px] py-3 text-pv-input leading-pv-base text-pv-text disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
          >
            <option value="" disabled>
              {copy.choosePlaceholder}
            </option>
            {markets.map((market) => (
              <option key={market.countryCode} value={market.countryCode}>
                {countryName(market.displayNameKey, lang)}
              </option>
            ))}
          </select>
        )}
      </ProviderField>
    </div>
  );
}

/**
 * The one case where a country does not settle the timezone.
 *
 * The server answers `ASK` when a market spans several zones or the platform
 * has no mapping for it. Storing working hours against an unconfirmed zone
 * makes every one of them ambiguous, so this asks before that can happen — and
 * it asks with the browser's own zone offered first, which is a suggestion the
 * provider confirms rather than a value written on their behalf.
 */
function TimezoneConfirmation({
  market,
  lang,
  editable,
  pending,
  onChoose,
}: {
  market: SupportedMarketView;
  lang: Lang;
  editable: boolean;
  pending: boolean;
  onChoose: (timezoneId: string) => void;
}) {
  const copy = MARKET_COPY[lang];
  const zones = candidateZones();

  return (
    <div className="grid gap-3" data-testid="market-timezone">
      <div>
        <h2 className="break-words text-pv-input font-medium text-pv-text">{copy.timezoneTitle}</h2>
        <p className="mt-1 break-words text-pv-help leading-pv-help text-pv-muted">
          {copy.timezoneBody}
        </p>
      </div>

      <ProviderField label={copy.timezoneLabel}>
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            data-testid="market-timezone-select"
            disabled={!editable || pending}
            defaultValue=""
            onChange={(event) => {
              const zone = event.target.value;
              if (zone !== '') onChoose(zone);
            }}
            className="min-h-12 w-full rounded-pv-control border border-pv-border-strong bg-pv-surface px-[13px] py-3 text-pv-input leading-pv-base text-pv-text disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
          >
            <option value="" disabled>
              {copy.choosePlaceholder}
            </option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        )}
      </ProviderField>
      <span className="sr-only">{market.countryCode}</span>
    </div>
  );
}

/**
 * Zones to offer, browser's own first.
 *
 * The browser's zone is a SUGGESTION — it is where the device thinks it is, not
 * where the provider works, and the two differ for anyone travelling. It is
 * offered first because it is usually right and never pre-selected because it
 * is sometimes wrong.
 *
 * `supportedValuesOf` gives the full IANA list where the browser has it; the
 * fallback is the device zone alone, which still lets the provider proceed.
 */
function candidateZones(): string[] {
  let local: string | undefined;
  try {
    local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    local = undefined;
  }

  let all: string[] = [];
  try {
    const supported = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof supported === 'function') all = supported('timeZone');
  } catch {
    all = [];
  }

  if (all.length === 0) return local ? [local] : [];
  return local ? [local, ...all.filter((z) => z !== local)] : all;
}
