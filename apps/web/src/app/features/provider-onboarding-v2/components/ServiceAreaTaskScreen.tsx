import { useEffect, useState } from 'react';
import { MapPin, Star } from 'lucide-react';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import { useOnboardingStepAutosave } from '../autosave/ProviderOnboardingAutosaveProvider';
import { SERVICE_AREA_COPY, type Lang } from '../copy/service-area-copy';
import { ProviderErrorState, ProviderSkeleton, ProviderTextInput } from '../../provider-ui';

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

// SUPERSEDED. The device-location button, the country picker, the radius
// slider and the area preview are not on the approved screen; see the
// component note above for what happened to the data behind each.
export function ServiceAreaTaskScreen({ view, lang, editable }: ServiceAreaTaskScreenProps) {
  const copy = SERVICE_AREA_COPY[lang];
  const autosave = useOnboardingStepAutosave('LOCATION');

  const data = view.data;
  const policy = data.radiusPolicy;
  const expansion = data.serviceAreaExpansion;

  const [city, setCity] = useState(data.serviceAreaCity ?? '');

  /**
   * The radius in force, and where it comes from now.
   *
   * The approved screen has no slider. It STATES the radius and explains it:
   * "Your current radius is 15 km because you selected a car." That makes the
   * number a consequence of the transport answer rather than a separate
   * decision, which is what the reward sentence beside it already assumed.
   *
   * Read from the draft, falling back to the server's own suggestion — never
   * to a client constant. "Walking is 3 km" is a market judgement an operator
   * tunes per city, and a number invented here would be one the save refuses.
   */
  const radiusKm = data.serviceAreaRadiusKm ?? policy?.suggestedKm ?? 0;

  /**
   * Write the server's suggestion once, when nothing is stored.
   *
   * Without a slider there is otherwise no way for `serviceAreaRadiusKm` to
   * ever become non-null, and the completeness policy requires it — so the
   * task would show a radius, look finished, and never complete. This commits
   * the number the SERVER suggested, not one the client chose, and only while
   * the draft is editable and genuinely has none.
   *
   * RECORDED FOR PHASE 5B: the radius stops being provider-adjustable here.
   * The approved design says it follows transport, and nothing on the approved
   * screens offers a different one.
   */
  useEffect(() => {
    if (!editable) return;
    if (data.serviceAreaRadiusKm !== null && data.serviceAreaRadiusKm !== undefined) return;
    const suggested = policy?.suggestedKm;
    if (typeof suggested !== 'number' || suggested <= 0) return;
    autosave.save({ serviceAreaRadiusKm: suggested });
    // `autosave` is stable for the step; re-running on every render would
    // queue the same write repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, data.serviceAreaRadiusKm, policy?.suggestedKm]);

  /**
   * The reward sentence, composed from what the SERVER granted and why.
   *
   * Every part is a server fact: the radius in force, the transport it was
   * derived from, the criterion that unlocks the next tier and that tier's
   * ceiling. When the server withholds any of them the sentence simply gets
   * shorter — it never guesses, and with `show: false` there is no card at all.
   */
  const rewardSentence = (() => {
    if (!expansion?.show) return null;
    const transport = policy?.basedOn ? copy.transportNames[policy.basedOn] : null;
    if (!transport || radiusKm <= 0) return null;

    const because = copy.rewardBecause(radiusKm, transport);
    const next = expansion.nextTier;
    // The rating criterion is the one the approved sentence names. Its target
    // is published; the anti-abuse thresholds deliberately withhold theirs, so
    // a null target means there is no second half to say.
    const ratings = expansion.progress?.find((c) => c.key === 'RATING_SAMPLE')?.target ?? null;
    if (!next || ratings === null) return because;

    return `${because}${copy.rewardThen(ratings, next.maxKm)}`;
  })();

  return (
    <div className="flex flex-col gap-[18px]" data-testid="work-area-task">
      {/* ── The one field the approved screen asks for ──────────────────────
          Its hint is the privacy promise, moved from a card of its own into
          the place the question is actually asked. That is where it does its
          work: a provider decides how honestly to answer while reading the
          field, not while reading a panel above it. */}
      <ProviderTextInput
        label={copy.areaLabel}
        hint={copy.areaHint}
        data-testid="service-area-city"
        value={city}
        disabled={!editable}
        autoComplete="address-level2"
        onChange={(event) => {
          setCity(event.target.value);
          // Sprint 9B.28 — commit on the keystroke as well as the blur, so
          // the status cannot claim "Saved" over a city that has not been
          // sent. Empty is still never written: the field is required and
          // the server refuses it.
          const next = event.target.value;
          if (next.trim() !== '') autosave.save({ serviceAreaCity: next.trim() });
        }}
        onBlur={() => {
          if (city.trim() !== '') autosave.save({ serviceAreaCity: city.trim() });
        }}
      />

      {/* ── The area, as a described circle ─────────────────────────────────
          `.hsm-map`: a 190px band with a ring in the middle carrying the
          radius. It is deliberately NOT a real map with a pin on the
          provider's base — that would show them exactly the thing the hint
          above promises nobody else can see, and would teach them the pin is
          what gets published. `role="img"` with a name that states the radius
          is the whole of what it means, so a screen-reader user gets the fact
          rather than a decorative band. */}
      <div
        role="img"
        aria-label={copy.mapAlt(radiusKm)}
        data-testid="service-area-map"
        className="pv-map-surface relative h-[190px] overflow-hidden rounded-pv-card"
      >
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 grid h-[122px] w-[122px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-pv-accent bg-pv-accent/12 text-pv-accent-hover"
        >
          <MapPin size={16} strokeWidth={1.8} aria-hidden="true" />
          <strong className="text-pv-body font-medium" data-testid="service-area-radius">
            {copy.radiusValue(radiusKm)}
          </strong>
        </span>
      </div>

      {/* ── Why the radius is what it is ────────────────────────────────────
          `.hsm-reward`. Rendered only when the SERVER says it may be, and
          composed entirely from what the server granted — the radius in
          force, the transport it came from, and the next tier with the
          criterion that unlocks it. The client computes no eligibility of its
          own; a formula in React would be a second copy of a ladder nobody
          could audit and every provider could read. */}
      {rewardSentence ? (
        <div
          className="grid grid-cols-[32px_1fr] gap-2.5 rounded-pv-choice bg-pv-blocked-bg p-3.5 text-pv-blocked"
          data-testid="expansion-reward-card"
        >
          <Star size={16} strokeWidth={1.8} aria-hidden="true" />
          <p className="break-words text-pv-label leading-[1.65]">{rewardSentence}</p>
        </div>
      ) : null}
    </div>
  );
}

// ─── Container ──────────────────────────────────────────────────────────────

/** Loads the draft and renders Task 3. Mirrors BasicsTask and ServicesTask. */
export function ServiceAreaTask({ lang }: { lang: Lang }) {
  const draft = useOnboardingDraft();
  const copy = SERVICE_AREA_COPY[lang];

  if (!draft.isFetched) {
    return <ProviderSkeleton label={copy.heading} />;
  }

  const view = draft.data;
  const usable =
    view && typeof view.version === 'number' && view.data !== undefined && view.data.radiusPolicy;

  if (!usable) {
    return <ProviderErrorState title={copy.heading} testId="service-area-load-failed" />;
  }

  return <ServiceAreaTaskScreen view={view} lang={lang} editable={view.editable} />;
}
