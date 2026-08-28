import { useCallback, useMemo, useState } from 'react';
import { MapPin, ShieldCheck } from 'lucide-react';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { COUNTRY_DIAL_CODES } from '../../../../lib/country-dial-codes';
import {
  useOnboardingDraft,
  useOnboardingStepAutosave,
} from '../../../hooks/provider/useProviderOnboarding';
import { SERVICE_AREA_COPY, type Lang } from '../copy/service-area-copy';
import { ServiceAreaRewardCard } from './ServiceAreaRewardCard';

// Sprint 9B.19 — V2 Task 3: where you work.
//
// THE TWO RULES THIS SCREEN IS BUILT AROUND
//
// 1. It must be completable with the device location REFUSED. Geolocation is a
//    convenience that improves one preview; it is never the path. Everything
//    the server needs — city, country, radius — is typed, and the permission
//    prompt is behind a button the provider chooses to press rather than fired
//    on mount at someone who has not been told why.
//
// 2. The provider is being asked where they live. They will only answer
//    honestly if they know what is published, so the privacy statement sits
//    NEXT TO the question rather than in a policy nobody opens.
//
// WHAT IS NOT HERE
//
// The home address from Task 1 — there isn't one, deliberately, and this does
// not introduce one. A base is a city and an optional pin the provider chose;
// a street address is not asked for anywhere in onboarding.
//
// And no radius numbers. "Walking is 3 km" is a market judgement an operator
// tunes per city, so every number on this screen — the suggestion, the floor,
// the ceiling — arrives from the server.

interface ServiceAreaTaskScreenProps {
  view: ProviderOnboardingDraftView;
  lang: Lang;
  editable: boolean;
}

type LocationState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'denied' }
  | { kind: 'unavailable' };

export function ServiceAreaTaskScreen({ view, lang, editable }: ServiceAreaTaskScreenProps) {
  const copy = SERVICE_AREA_COPY[lang];
  const autosave = useOnboardingStepAutosave('LOCATION');

  const data = view.data;
  const policy = data.radiusPolicy;

  const [city, setCity] = useState(data.serviceAreaCity ?? '');
  const [countryCode, setCountryCode] = useState(data.serviceAreaCountryCode ?? '');
  const [radiusKm, setRadiusKm] = useState<number>(data.serviceAreaRadiusKm ?? policy.suggestedKm);
  const [locationState, setLocationState] = useState<LocationState>({ kind: 'idle' });

  const hasCoords = data.serviceAreaLat !== null && data.serviceAreaLng !== null;

  const countries = useMemo(
    () => [...COUNTRY_DIAL_CODES].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  // ── Device location: optional, explicit, and never required ──────────────

  const requestDeviceLocation = useCallback(() => {
    // The FUNCTION, not the key. `'geolocation' in navigator` is true whenever
    // the property exists — including when it is undefined, which is what a
    // locked-down or embedded browser leaves behind. Checking the key there
    // and calling straight through crashes the screen at the exact moment the
    // fallback was supposed to take over.
    if (typeof navigator.geolocation?.getCurrentPosition !== 'function') {
      setLocationState({ kind: 'unavailable' });
      return;
    }
    setLocationState({ kind: 'locating' });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationState({ kind: 'idle' });
        // Sent to OUR server only, and never published: the public surface
        // gets a coarse area, which is what the privacy note promises.
        autosave.save({
          serviceAreaLat: position.coords.latitude,
          serviceAreaLng: position.coords.longitude,
        });
      },
      (error) => {
        // A refusal is an ordinary outcome, not an error state to recover
        // from. The manual fields below are already on screen and already
        // sufficient; the message says so rather than offering a retry that
        // would re-prompt someone who just said no.
        setLocationState({
          kind: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable',
        });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [autosave]);

  const clearDeviceLocation = () => {
    autosave.save({ serviceAreaLat: null, serviceAreaLng: null });
  };

  // ── Radius ───────────────────────────────────────────────────────────────

  const commitRadius = (km: number) => {
    // Bounded by the SERVER's numbers. The input's own min/max come from the
    // same policy, so the control cannot offer a value the save will refuse.
    const bounded = Math.min(Math.max(km, policy.minKm), policy.maxKm);
    setRadiusKm(bounded);
    autosave.save({ serviceAreaRadiusKm: bounded });
  };

  const basisLabel = policy.basedOn ? copy.transportNames[policy.basedOn] : null;
  const tz = data.resolvedTimezone;

  return (
    <div className="flex flex-col gap-6" data-testid="service-area-task">
      <p className="break-words text-slate-500 dark:text-slate-400" style={{ fontSize: '13px' }}>
        {copy.intro}
      </p>

      {/* ── Privacy, stated beside the question rather than in a policy ──── */}
      <div
        className="flex min-w-0 items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3"
        data-testid="location-privacy-note"
      >
        <ShieldCheck
          size={18}
          className="mt-0.5 flex-shrink-0 text-emerald-700"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h3
            className="break-words text-emerald-900"
            style={{ fontSize: '14px', fontWeight: 700 }}
          >
            {copy.privacyTitle}
          </h3>
          <p className="mt-0.5 break-words text-emerald-800" style={{ fontSize: '12px' }}>
            {copy.privacyBody}
          </p>
          <p className="mt-1 break-words text-emerald-800" style={{ fontSize: '12px' }}>
            {copy.privacyPublic}
          </p>
        </div>
      </div>

      {/* ── Operating base ───────────────────────────────────────────────── */}
      <section aria-labelledby="base-heading" className="min-w-0">
        <h2
          id="base-heading"
          className="break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.baseLegend}
        </h2>
        <p
          className="mb-2 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
        >
          {copy.baseHint}
        </p>

        <label
          htmlFor="service-area-city"
          className="mb-1 block break-words text-slate-900 dark:text-white"
          style={{ fontSize: '14px', fontWeight: 600 }}
        >
          {copy.cityLabel}
        </label>
        <input
          id="service-area-city"
          data-testid="service-area-city"
          type="text"
          value={city}
          disabled={!editable}
          placeholder={copy.cityPlaceholder}
          onChange={(event) => setCity(event.target.value)}
          onBlur={() => {
            if (city.trim() !== '') autosave.save({ serviceAreaCity: city.trim() });
          }}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          style={{ fontSize: '14px', minHeight: '44px' }}
        />

        <label
          htmlFor="service-area-country"
          className="mb-1 mt-3 block break-words text-slate-900 dark:text-white"
          style={{ fontSize: '14px', fontWeight: 600 }}
        >
          {copy.countryLabel}
        </label>
        <select
          id="service-area-country"
          data-testid="service-area-country"
          value={countryCode}
          disabled={!editable}
          onChange={(event) => {
            const next = event.target.value;
            setCountryCode(next);
            const chosen = countries.find((c) => c.iso2 === next);
            // BOTH halves: the display name the provider chose, and the code
            // the server resolves a timezone and a market policy by.
            autosave.save({
              serviceAreaCountryCode: next === '' ? null : next,
              serviceAreaCountry: chosen ? chosen.name : null,
            });
          }}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          style={{ fontSize: '14px', minHeight: '44px' }}
        >
          <option value="">{copy.countryPlaceholder}</option>
          {countries.map((c) => (
            <option key={c.iso2} value={c.iso2}>
              {c.name}
            </option>
          ))}
        </select>

        {/* Timezone: a city and an offset, never an IANA identifier. */}
        {tz.display ? (
          <p
            className="mt-2 break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px' }}
            data-testid="timezone-note"
          >
            {copy.timezoneResolved(tz.display.city, tz.display.offset)}
          </p>
        ) : tz.needsConfirmation ? (
          <p
            className="mt-2 break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px' }}
            data-testid="timezone-needs-confirmation"
          >
            {copy.timezoneNeedsConfirmation}
          </p>
        ) : null}
      </section>

      {/* ── Optional device location ─────────────────────────────────────── */}
      <section aria-labelledby="device-location-heading" className="min-w-0">
        <h2 id="device-location-heading" className="sr-only">
          {copy.useMyLocation}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!editable || locationState.kind === 'locating'}
            onClick={requestDeviceLocation}
            data-testid="use-my-location"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
          >
            <MapPin size={16} aria-hidden="true" />
            {locationState.kind === 'locating' ? copy.locating : copy.useMyLocation}
          </button>

          {hasCoords ? (
            <button
              type="button"
              disabled={!editable}
              onClick={clearDeviceLocation}
              data-testid="clear-location"
              className="rounded-xl px-2 text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              style={{ fontSize: '12px', fontWeight: 600, minHeight: '44px' }}
            >
              {copy.clearLocation}
            </button>
          ) : null}
        </div>

        <p
          className="mt-1 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
          data-testid="location-help"
        >
          {copy.locationHelp}
        </p>

        {/* A refusal is reported as a fact, with the way forward, and never as
            an error the provider has to clear before continuing. */}
        {locationState.kind === 'denied' || locationState.kind === 'unavailable' ? (
          <p
            className="mt-1 break-words text-slate-700 dark:text-slate-300"
            style={{ fontSize: '12px' }}
            data-testid="location-permission-fallback"
            role="status"
            aria-live="polite"
          >
            {locationState.kind === 'denied' ? copy.permissionDenied : copy.permissionUnavailable}
          </p>
        ) : null}
      </section>

      {/* ── Radius ───────────────────────────────────────────────────────── */}
      <section aria-labelledby="radius-heading" className="min-w-0">
        <h2
          id="radius-heading"
          className="break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.radiusLegend}
        </h2>

        <p
          className="mt-1 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '16px', fontWeight: 700 }}
          data-testid="radius-value"
          role="status"
          aria-live="polite"
        >
          {copy.radiusValue(radiusKm)}
        </p>

        <input
          type="range"
          data-testid="radius-slider"
          min={policy.minKm}
          max={policy.maxKm}
          step={1}
          value={radiusKm}
          disabled={!editable}
          aria-label={copy.radiusLegend}
          aria-valuemin={policy.minKm}
          aria-valuemax={policy.maxKm}
          aria-valuenow={radiusKm}
          onChange={(event) => setRadiusKm(Number(event.target.value))}
          onMouseUp={() => commitRadius(radiusKm)}
          onTouchEnd={() => commitRadius(radiusKm)}
          onBlur={() => commitRadius(radiusKm)}
          className="mt-2 w-full accent-blue-600"
          style={{ minHeight: '44px' }}
        />

        <p
          className="break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
          data-testid="radius-bounds"
        >
          {copy.radiusBounds(policy.minKm, policy.maxKm)}
        </p>
        <p
          className="mt-1 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
          data-testid="radius-basis"
        >
          {basisLabel ? copy.radiusBasedOn(basisLabel) : copy.radiusNoBasis}
        </p>
        <p
          className="mt-1 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
          data-testid="radius-reduce-hint"
        >
          {copy.radiusReduceHint}
        </p>
      </section>

      {/* ── Earned expansion ─────────────────────────────────────────────
          Sprint 9B.20. Rendered only when the SERVER says it may be, and
          placed directly under the slider it explains: the card's whole
          subject is why the ceiling on that control is what it is. Absent by
          default — the feature ships off. */}
      <ServiceAreaRewardCard expansion={data.serviceAreaExpansion} copy={copy} />

      {/* ── What customers see ───────────────────────────────────────────── */}
      <section aria-labelledby="area-preview-heading" className="min-w-0">
        <h2
          id="area-preview-heading"
          className="break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.previewTitle}
        </h2>
        {/* A described AREA, not a pin.
            A map with a marker on the provider's base would show them exactly
            the thing the privacy note promises nobody else can see, and would
            teach them the pin is what gets published. The honest preview is
            the circle's size and the city — which is all a customer gets. */}
        {city.trim() !== '' ? (
          <div
            className="mt-1 flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-700"
            data-testid="area-preview"
          >
            <div
              className="flex-shrink-0 rounded-full border-2 border-dashed border-blue-400 bg-blue-50"
              style={{ width: '56px', height: '56px' }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p
                className="break-words text-slate-900 dark:text-white"
                style={{ fontSize: '14px', fontWeight: 600 }}
              >
                {city.trim()}
              </p>
              <p
                className="break-words text-slate-500 dark:text-slate-400"
                style={{ fontSize: '12px' }}
                data-testid="area-preview-approx"
              >
                {copy.previewApprox(radiusKm * 2)}
              </p>
            </div>
          </div>
        ) : (
          <p
            className="mt-1 break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px' }}
            data-testid="area-preview-empty"
          >
            {copy.previewNoLocation}
          </p>
        )}
      </section>
    </div>
  );
}

// ─── Container ──────────────────────────────────────────────────────────────

/** Loads the draft and renders Task 3. Mirrors BasicsTask and ServicesTask. */
export function ServiceAreaTask({ lang }: { lang: Lang }) {
  const draft = useOnboardingDraft();
  const copy = SERVICE_AREA_COPY[lang];

  if (!draft.isFetched) {
    return (
      <div className="flex justify-center py-10" role="status" aria-live="polite">
        <span className="sr-only">{copy.heading}</span>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      </div>
    );
  }

  const view = draft.data;
  const usable =
    view && typeof view.version === 'number' && view.data !== undefined && view.data.radiusPolicy;

  if (!usable) {
    return (
      <p
        className="break-words text-rose-600"
        style={{ fontSize: '13px' }}
        data-testid="service-area-load-failed"
      >
        {copy.heading}
      </p>
    );
  }

  return <ServiceAreaTaskScreen view={view} lang={lang} editable={view.editable} />;
}
