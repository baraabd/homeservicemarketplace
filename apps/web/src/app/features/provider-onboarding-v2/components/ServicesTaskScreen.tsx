import { AutosaveStatus } from './AutosaveStatus';
import { mergeAutosaveStatus } from '../autosave-status';
import { useMemo, useState } from 'react';
import type {
  ProviderOnboardingDraftView,
  ProviderSpecialtyState,
  ProviderSpecialtyView,
  ProviderTransportModeCode,
} from '@homeservicemarketplace/contracts';

import { useServiceCategories } from '../../../../lib/use-service-categories';
import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import { useOnboardingStepAutosave } from '../autosave/ProviderOnboardingAutosaveProvider';
import { SpecialtyPicker } from '../services/SpecialtyPicker';
import { SERVICES_COPY, STATE_TONE, type Lang } from '../copy/services-copy';
import {
  ProviderCard,
  ProviderNotice,
  ProviderSkeleton,
  ProviderStepper,
  ProviderErrorState,
} from '../../provider-ui';

// Sprint 9B.18 — V2 Task 2: services, experience, equipment, transport, title.
//
// THE SEPARATION THIS SCREEN IS BUILT AROUND
//
// Choosing a service and being approved for it are different facts, decided by
// different people, at different times. The old screen collapsed them into one
// chip with a badge, which made a PENDING application look like something the
// provider had got wrong. Here they are two sections that cannot be confused:
//
//   the PICKER    answers "what have I chosen?"           — the provider decides
//   the STATE LIST answers "what happened to each?"       — an admin decides
//
// Every state in the second list comes from the server. The client does not
// derive "pending" from an id's absence anywhere, which is how the old screen
// reported a retired category as a rejection.

const TRANSPORT_MODES: ProviderTransportModeCode[] = [
  'ON_FOOT',
  'MOTORCYCLE',
  'CAR',
  'VAN',
  'TRUCK',
  'PUBLIC_TRANSPORT',
];

const TRANSPORT_LABELS: Record<Lang, Record<ProviderTransportModeCode, string>> = {
  en: {
    ON_FOOT: 'On foot',
    MOTORCYCLE: 'Motorcycle',
    CAR: 'Car',
    VAN: 'Van',
    TRUCK: 'Truck',
    PUBLIC_TRANSPORT: 'Public transport',
  },
  ar: {
    ON_FOOT: 'سيراً على الأقدام',
    MOTORCYCLE: 'دراجة نارية',
    CAR: 'سيارة',
    VAN: 'فان',
    TRUCK: 'شاحنة',
    PUBLIC_TRANSPORT: 'مواصلات عامة',
  },
};

/** A working lifetime. The old floor was a start year of 1950, which is the
 *  same bound expressed from the other end. */
const MAX_YEARS = 75;
/** The order states are shown in. Approved first because it is the good news
 *  and the largest group; rejected and inactive last because they are the two
 *  the provider may want to act on and should not be buried mid-list. */
const STATE_ORDER: ProviderSpecialtyState[] = ['APPROVED', 'PENDING', 'REJECTED', 'INACTIVE'];

// Sprint 09B.29 Phase 5 — migrated to Provider UI against the approved
// prototype screens `services` (task 2 of 6, part 1) and `experience`
// (part 2). One route, two sections, exactly as the registry describes them.
//
// WHAT THE APPROVED DESIGN CHANGED HERE
//
//   years           a -/+ stepper, not a free numeric field. The prototype
//                   says why in its own help text: it avoids typing errors.
//                   The STORED fact is unchanged — still `professionSince`, a
//                   date, so a provider's experience does not silently stop
//                   ageing. The stepper moves years; the screen converts.
//   the title       a display-only panel. Ruling C1 makes the generated title
//                   server-owned and explanatory here; the accept/edit/refuse
//                   controls are gone, and the panel says it can be changed
//                   later, on the surface that owns it.
//   equipment       absent from the approved screen. It is optional data the
//                   completeness policy never asks for, so removing the
//                   control dead-ends nothing; stored values are untouched.
//                   FLAGGED for product-owner confirmation: no ruling names
//                   equipment, the prototype simply does not show it.
//   moderation      reads as PLATFORM work. "Your selections complete this
//                   task now. Approval stays separate and will not block
//                   submission." — not as an incomplete provider task.
//
// Autosave, step ownership, the version handshake and the server's authority
// over the primary specialty are untouched by the migration.

interface ServicesTaskScreenProps {
  view: ProviderOnboardingDraftView;
  lang: Lang;
  editable: boolean;
}

export function ServicesTaskScreen({ view, lang, editable }: ServicesTaskScreenProps) {
  const copy = SERVICES_COPY[lang];

  const specialtiesAutosave = useOnboardingStepAutosave('SPECIALTIES');
  const experienceAutosave = useOnboardingStepAutosave('EXPERIENCE');
  // Sprint 9B.25 — two autosaves, one status line, and until now no line at
  // all. The merge puts the most consequential state forward, so "Saved" from
  // one step cannot mask a conflict on the other.
  const autosaveStatus = mergeAutosaveStatus(specialtiesAutosave.status, experienceAutosave.status);

  const catalogue = useServiceCategories();

  const data = view.data;
  /**
   * The generated professional title, shown and explained — never edited here.
   *
   * Ruling C1 makes this server-owned: it is derived from the primary service
   * and persisted into `headline` only while that field is blank. The approved
   * screen presents it as a panel that says it can be changed later, on the
   * surface that owns it, so this screen has no accept / edit / refuse
   * controls and no local draft of it to drift out of date.
   */
  // The server sends BOTH languages; the screen shows the one the provider is
  // reading. It is never re-translated afterwards — C1 persists the language
  // they actually saw.
  const suggestedTitle = data.suggestedTitle?.[lang] ?? data.headline ?? null;

  // Memoised because `?? []` allocates a fresh array on every render, which
  // would make it a new dependency each time and defeat both memos below.
  const specialties = useMemo(() => data.specialties ?? [], [data.specialties]);
  const chosenIds = useMemo(() => specialties.map((s) => s.categoryId), [specialties]);

  // ── Specialties ──────────────────────────────────────────────────────────

  const toggleSpecialty = (categoryId: string) => {
    const next = chosenIds.includes(categoryId)
      ? chosenIds.filter((id) => id !== categoryId)
      : [...chosenIds, categoryId];
    specialtiesAutosave.save({ specialtyLeafIds: next });
  };

  const setPrimary = (categoryId: string) => {
    specialtiesAutosave.save({ primarySpecialtyId: categoryId });
  };

  const grouped = useMemo(() => {
    const byState = new Map<ProviderSpecialtyState, ProviderSpecialtyView[]>();
    for (const s of specialties) {
      const list = byState.get(s.state) ?? [];
      list.push(s);
      byState.set(s.state, list);
    }
    return STATE_ORDER.filter((state) => (byState.get(state)?.length ?? 0) > 0).map((state) => ({
      state,
      items: byState.get(state) ?? [],
    }));
  }, [specialties]);

  // ── Experience ───────────────────────────────────────────────────────────

  const thisYear = new Date().getUTCFullYear();

  /**
   * Years on screen, a DATE in the database.
   *
   * The approved control is a stepper over years, and the stored fact stays
   * `professionSince` — a date — so a provider who entered 14 years today
   * reads 15 next year instead of being frozen at the number they typed. The
   * conversion is presentation arithmetic, not policy: the server still owns
   * what the date means.
   */
  const storedYears = (() => {
    const since = data.professionSince;
    if (!since) return null;
    const started = new Date(since).getUTCFullYear();
    if (!Number.isFinite(started)) return null;
    return Math.min(MAX_YEARS, Math.max(0, thisYear - started));
  })();

  const [years, setYears] = useState(storedYears ?? 0);

  const commitYears = (next: number) => {
    setYears(next);
    experienceAutosave.save({
      professionSince: `${thisYear - next}-01-01T00:00:00.000Z`,
    });
  };

  // ── Transport ────────────────────────────────────────────────────────────

  const selectedModes = data.transportModes ?? [];
  const primaryMode = data.transportMode ?? null;

  const toggleMode = (mode: ProviderTransportModeCode) => {
    const next = selectedModes.includes(mode)
      ? selectedModes.filter((m) => m !== mode)
      : [...selectedModes, mode];
    // The primary is NOT sent. The server keeps it consistent with the set —
    // re-pointing it when the set no longer contains it — so the client never
    // has to decide, and two clients cannot decide differently.
    experienceAutosave.save({ transportModes: next });
  };

  return (
    <div className="flex flex-col gap-6" data-testid="services-task">
      {/* Sprint 9B.25 — this screen autosaved SILENTLY across BOTH its steps. */}
      <AutosaveStatus status={autosaveStatus} lang={lang} testIdPrefix="services" />

      {/* ── What do you do? ─────────────────────────────────────────────── */}
      <section aria-labelledby="services-picker-heading">
        <h2
          id="services-picker-heading"
          className="mb-2 break-words text-pv-heading font-bold text-pv-text"
        >
          {copy.heading}
        </h2>
        {catalogue.data ? (
          <SpecialtyPicker
            categories={catalogue.data}
            chosen={chosenIds}
            maxSpecialties={data.maxSpecialties ?? 5}
            lang={lang}
            disabled={!editable}
            onToggle={toggleSpecialty}
          />
        ) : (
          <div data-testid="catalogue-loading">
            <ProviderSkeleton rows={3} label={copy.heading} />
          </div>
        )}
      </section>

      {/* ── What happened to each? ──────────────────────────────────────── */}
      {grouped.length > 0 ? (
        <section aria-labelledby="services-state-heading" data-testid="specialty-states">
          <h2 id="services-state-heading" className="sr-only">
            {copy.stateHeading.APPROVED}
          </h2>
          <div className="flex flex-col gap-4">
            {grouped.map(({ state, items }) => (
              <div key={state} data-testid={`specialty-state-${state}`}>
                <h3 className="break-words text-pv-label font-bold text-pv-text">
                  {copy.stateHeading[state]}
                </h3>
                {/* The explanation sits on the GROUP, once — not repeated as a
                    badge inside every chip, which is what made the old screen
                    unreadable and made "pending" read as an error. */}
                <p
                  className="mb-2 break-words text-pv-label text-pv-muted"
                  data-testid={`specialty-state-explain-${state}`}
                >
                  {copy.stateExplain[state]}
                </p>
                <ul className="flex flex-col gap-2">
                  {items.map((item) => (
                    <li
                      key={item.categoryId}
                      data-testid={`specialty-row-${item.categoryId}`}
                      data-state={item.state}
                      data-tone={STATE_TONE[item.state]}
                      className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-pv-border p-2"
                    >
                      <span className="min-w-0 break-words text-pv-body text-pv-text">
                        {lang === 'ar' ? item.labelAr : item.labelEn}
                      </span>

                      {data.primarySpecialtyId === item.categoryId ? (
                        <span
                          data-testid={`primary-badge-${item.categoryId}`}
                          className="rounded-full bg-pv-accent-subtle px-2 text-pv-caption font-bold text-pv-accent-hover"
                        >
                          {copy.primaryBadge}
                        </span>
                      ) : (
                        // Only a specialty the provider still holds can become
                        // the main one. Offering it for a rejected or retired
                        // row would suggest a trade they cannot work in.
                        (item.state === 'APPROVED' || item.state === 'PENDING') && (
                          <button
                            type="button"
                            disabled={!editable}
                            onClick={() => setPrimary(item.categoryId)}
                            data-testid={`make-primary-${item.categoryId}`}
                            className="ms-auto min-h-[44px] rounded-lg px-2 text-pv-label font-semibold text-pv-accent underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
                          >
                            {copy.makePrimary}
                          </button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Review is platform work, not an unfinished provider task ─────── */}
      <ProviderNotice
        tone="waiting"
        title={copy.stateHeading.PENDING}
        description={copy.stateExplain.PENDING}
        data-testid="specialty-moderation-notice"
      />

      {/* ── Experience ──────────────────────────────────────────────────── */}
      <section aria-labelledby="services-experience-heading" className="min-w-0">
        <h2 id="services-experience-heading" className="sr-only">
          {copy.experienceLegend}
        </h2>
        <ProviderStepper
          label={copy.startYearLabel}
          hint={copy.startYearHint}
          value={years}
          min={0}
          max={MAX_YEARS}
          decreaseLabel={copy.yearsDecrease}
          increaseLabel={copy.yearsIncrease}
          disabled={!editable}
          testId="experience-years"
          onChange={commitYears}
        />
      </section>

      {/* ── Transport ───────────────────────────────────────────────────── */}
      <section aria-labelledby="services-transport-heading" className="min-w-0">
        <h2
          id="services-transport-heading"
          className="mb-1 break-words text-pv-heading font-bold text-pv-text"
        >
          {copy.transportLegend}
        </h2>
        <p className="mb-2 break-words text-pv-label text-pv-muted">{copy.transportHint}</p>
        <ul className="flex flex-col gap-2" data-testid="transport-options">
          {TRANSPORT_MODES.map((mode) => {
            const checked = selectedModes.includes(mode);
            return (
              <li key={mode}>
                <label
                  data-testid={`transport-${mode}`}
                  data-checked={checked}
                  data-primary={primaryMode === mode}
                  className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 ${
                    checked
                      ? 'border-pv-accent bg-pv-accent-subtle'
                      : 'border-pv-border bg-pv-surface'
                  }`}
                  style={{ minHeight: '44px' }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!editable}
                    onChange={() => toggleMode(mode)}
                    className="h-5 w-5 flex-shrink-0 accent-pv-accent"
                  />
                  <span className="min-w-0 break-words text-pv-body text-pv-text">
                    {TRANSPORT_LABELS[lang][mode]}
                  </span>
                  {primaryMode === mode ? (
                    <span className="ms-auto rounded-full bg-pv-accent-subtle px-2 text-pv-caption font-bold text-pv-accent-hover">
                      {copy.transportPrimary}
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── The suggested title, explained, not edited ──────────────────── */}
      {suggestedTitle ? (
        <ProviderCard tone="sunken">
          <h2 className="text-pv-heading font-bold text-pv-text">{copy.titleLegend}</h2>
          <p className="mt-1 text-pv-label text-pv-muted" data-testid="title-suggestion-text">
            {copy.titleSuggested(suggestedTitle)}
          </p>
          <p className="mt-2 text-pv-label text-pv-muted" data-testid="title-not-published">
            {copy.titleNotPublished}
          </p>
        </ProviderCard>
      ) : null}
    </div>
  );
}

// ─── Container ──────────────────────────────────────────────────────────────

/** Loads the draft and renders Task 2. Mirrors BasicsTask — see it for why the
 *  shape is validated rather than merely checked for presence. */
export function ServicesTask({ lang }: { lang: Lang }) {
  const draft = useOnboardingDraft();
  const copy = SERVICES_COPY[lang];

  if (!draft.isFetched) {
    return (
      <div className="flex justify-center py-10" role="status" aria-live="polite">
        <span className="sr-only">{copy.heading}</span>
        <ProviderSkeleton rows={3} label={copy.heading} />
      </div>
    );
  }

  const view = draft.data;
  const usable = view && typeof view.version === 'number' && view.data !== undefined;
  if (!usable) {
    return <ProviderErrorState title={copy.heading} testId="services-load-failed" />;
  }

  return <ServicesTaskScreen view={view} lang={lang} editable={view.editable} />;
}
