import { AutosaveStatus } from './AutosaveStatus';
import { mergeAutosaveStatus } from '../autosave-status';
import { useMemo, useState } from 'react';
import type {
  ProviderOnboardingDraftView,
  ProviderSpecialtyState,
  ProviderSpecialtyView,
  ProviderTransportModeCode,
} from '@homeservicemarketplace/contracts';

import { validateProfessionalTitle } from '../../../../lib/provider/title-format';
import { useEquipmentCatalog, useServiceCategories } from '../../../../lib/use-service-categories';
import {
  useOnboardingDraft,
  useOnboardingStepAutosave,
} from '../../../hooks/provider/useProviderOnboarding';
import { SpecialtyPicker } from '../services/SpecialtyPicker';
import { SERVICES_COPY, STATE_TONE, type Lang } from '../copy/services-copy';

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

const MIN_START_YEAR = 1950;
/** The order states are shown in. Approved first because it is the good news
 *  and the largest group; rejected and inactive last because they are the two
 *  the provider may want to act on and should not be buried mid-list. */
const STATE_ORDER: ProviderSpecialtyState[] = ['APPROVED', 'PENDING', 'REJECTED', 'INACTIVE'];

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
  const equipment = useEquipmentCatalog();

  const data = view.data;
  // Memoised because `?? []` allocates a fresh array on every render, which
  // would make it a new dependency each time and defeat both memos below.
  const specialties = useMemo(() => data.specialties ?? [], [data.specialties]);
  const chosenIds = useMemo(() => specialties.map((s) => s.categoryId), [specialties]);

  const [startYear, setStartYear] = useState(
    data.professionSince ? String(new Date(data.professionSince).getUTCFullYear()) : '',
  );
  const [titleDraft, setTitleDraft] = useState(data.headline ?? '');
  const [editingTitle, setEditingTitle] = useState(false);

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
  const yearNumber = Number.parseInt(startYear, 10);
  const yearValid =
    startYear === '' ||
    (Number.isFinite(yearNumber) && yearNumber >= MIN_START_YEAR && yearNumber <= thisYear);
  const derivedYears = yearValid && startYear !== '' ? thisYear - yearNumber : null;

  const commitStartYear = () => {
    if (!yearValid) return;
    // Stored as a DATE, not a bucket. The server derives years from it so the
    // stored fact does not silently age — which is the whole reason the schema
    // carries professionSince alongside the count.
    experienceAutosave.save({
      professionSince: startYear === '' ? null : `${startYear}-01-01T00:00:00.000Z`,
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

  // ── Equipment ────────────────────────────────────────────────────────────

  const equipmentItems = equipment.data ?? [];
  const selectedEquipment = data.equipmentCodes ?? [];
  const toggleEquipment = (code: string) => {
    const next = selectedEquipment.includes(code)
      ? selectedEquipment.filter((c) => c !== code)
      : [...selectedEquipment, code];
    experienceAutosave.save({ equipmentCodes: next });
  };

  // ── Title ────────────────────────────────────────────────────────────────

  const suggestion = data.suggestedTitle ? data.suggestedTitle[lang] : null;
  const titleVerdict = titleDraft.trim() === '' ? null : validateProfessionalTitle(titleDraft);
  const titleError = titleVerdict && !titleVerdict.ok ? copy.titleRefusal[titleVerdict.code] : null;

  return (
    <div className="flex flex-col gap-6" data-testid="services-task">
      {/* Sprint 9B.25 — this screen autosaved SILENTLY across BOTH its steps. */}
      <AutosaveStatus status={autosaveStatus} lang={lang} testIdPrefix="services" />

      {/* ── What do you do? ─────────────────────────────────────────────── */}
      <section aria-labelledby="services-picker-heading">
        <h2
          id="services-picker-heading"
          className="mb-2 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
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
          <div role="status" aria-live="polite" data-testid="catalogue-loading">
            <span className="sr-only">…</span>
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
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
                <h3
                  className="break-words text-slate-900 dark:text-white"
                  style={{ fontSize: '13px', fontWeight: 700 }}
                >
                  {copy.stateHeading[state]}
                </h3>
                {/* The explanation sits on the GROUP, once — not repeated as a
                    badge inside every chip, which is what made the old screen
                    unreadable and made "pending" read as an error. */}
                <p
                  className="mb-2 break-words text-slate-500 dark:text-slate-400"
                  style={{ fontSize: '12px' }}
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
                      className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700"
                    >
                      <span
                        className="min-w-0 break-words text-slate-900 dark:text-white"
                        style={{ fontSize: '14px' }}
                      >
                        {lang === 'ar' ? item.labelAr : item.labelEn}
                      </span>

                      {data.primarySpecialtyId === item.categoryId ? (
                        <span
                          data-testid={`primary-badge-${item.categoryId}`}
                          className="rounded-full bg-blue-100 px-2 text-blue-800"
                          style={{ fontSize: '11px', fontWeight: 700 }}
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
                            className="ms-auto rounded-lg px-2 text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                            style={{ fontSize: '12px', fontWeight: 600, minHeight: '44px' }}
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

      {/* ── Experience ──────────────────────────────────────────────────── */}
      <section aria-labelledby="services-experience-heading" className="min-w-0">
        <h2
          id="services-experience-heading"
          className="mb-1 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.experienceLegend}
        </h2>
        <label
          htmlFor="profession-start-year"
          className="mb-1 block break-words text-slate-900 dark:text-white"
          style={{ fontSize: '14px', fontWeight: 600 }}
        >
          {copy.startYearLabel}
        </label>
        <input
          id="profession-start-year"
          data-testid="profession-start-year"
          type="number"
          inputMode="numeric"
          min={MIN_START_YEAR}
          max={thisYear}
          value={startYear}
          disabled={!editable}
          aria-invalid={!yearValid || undefined}
          aria-describedby="profession-start-year-hint"
          onChange={(event) => setStartYear(event.target.value)}
          onBlur={commitStartYear}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          style={{ fontSize: '14px', minHeight: '44px' }}
        />
        <p
          id="profession-start-year-hint"
          className={`mt-1 break-words ${yearValid ? 'text-slate-500 dark:text-slate-400' : 'text-rose-600'}`}
          style={{ fontSize: '12px' }}
        >
          {yearValid ? copy.startYearHint : copy.startYearInvalid}
        </p>
        {derivedYears !== null ? (
          <p
            className="mt-1 break-words text-slate-900 dark:text-white"
            style={{ fontSize: '13px', fontWeight: 600 }}
            data-testid="derived-years"
            role="status"
            aria-live="polite"
          >
            {copy.yearsDerived(derivedYears)}
          </p>
        ) : null}
      </section>

      {/* ── Transport ───────────────────────────────────────────────────── */}
      <section aria-labelledby="services-transport-heading" className="min-w-0">
        <h2
          id="services-transport-heading"
          className="mb-1 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.transportLegend}
        </h2>
        <p
          className="mb-2 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
        >
          {copy.transportHint}
        </p>
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
                      ? 'border-blue-500 bg-blue-50/50'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                  }`}
                  style={{ minHeight: '44px' }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!editable}
                    onChange={() => toggleMode(mode)}
                    className="h-5 w-5 flex-shrink-0 accent-blue-600"
                  />
                  <span
                    className="min-w-0 break-words text-slate-900 dark:text-white"
                    style={{ fontSize: '14px' }}
                  >
                    {TRANSPORT_LABELS[lang][mode]}
                  </span>
                  {primaryMode === mode ? (
                    <span
                      className="ms-auto rounded-full bg-blue-100 px-2 text-blue-800"
                      style={{ fontSize: '11px', fontWeight: 700 }}
                    >
                      {copy.transportPrimary}
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Equipment ───────────────────────────────────────────────────── */}
      <section aria-labelledby="services-equipment-heading" className="min-w-0">
        <h2
          id="services-equipment-heading"
          className="mb-1 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.equipmentLegend}
        </h2>
        <p
          className="mb-2 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
        >
          {copy.equipmentHint}
        </p>
        {equipmentItems.length === 0 ? (
          <p
            className="break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px' }}
            data-testid="equipment-empty"
          >
            {copy.equipmentEmpty}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="equipment-options">
            {equipmentItems.map((item) => {
              const checked = selectedEquipment.includes(item.code);
              return (
                <li key={item.id}>
                  <label
                    data-testid={`equipment-${item.code}`}
                    data-checked={checked}
                    className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 ${
                      checked
                        ? 'border-blue-500 bg-blue-50/50'
                        : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                    }`}
                    style={{ minHeight: '44px' }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!editable}
                      onChange={() => toggleEquipment(item.code)}
                      className="h-5 w-5 flex-shrink-0 accent-blue-600"
                    />
                    <span
                      className="min-w-0 break-words text-slate-900 dark:text-white"
                      style={{ fontSize: '14px' }}
                    >
                      {lang === 'ar' ? item.labelAr : item.labelEn}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Title ───────────────────────────────────────────────────────── */}
      <section aria-labelledby="services-title-heading" className="min-w-0">
        <h2
          id="services-title-heading"
          className="mb-1 break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.titleLegend}
        </h2>
        <p
          className="mb-2 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
        >
          {copy.titleHint}
        </p>

        {suggestion && !editingTitle ? (
          <div data-testid="title-suggestion" className="flex flex-col gap-2">
            <p
              className="break-words text-slate-900 dark:text-white"
              style={{ fontSize: '14px' }}
              data-testid="title-suggestion-text"
            >
              {copy.titleSuggested(suggestion)}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!editable}
                data-testid="title-accept"
                onClick={() => {
                  // ACCEPTING fills the box. It does not save and it does not
                  // publish: the profile task is where a title is written, and
                  // a suggestion that wrote itself would put words in
                  // somebody's mouth on the surface customers judge them by.
                  setTitleDraft(suggestion);
                  setEditingTitle(true);
                }}
                className="rounded-xl bg-blue-600 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
              >
                {copy.titleUse}
              </button>
              <button
                type="button"
                disabled={!editable}
                data-testid="title-edit"
                onClick={() => setEditingTitle(true)}
                className="rounded-xl border border-slate-200 bg-white px-3 text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
              >
                {copy.titleEdit}
              </button>
            </div>
          </div>
        ) : null}

        {editingTitle || !suggestion ? (
          <div className="mt-2">
            <input
              data-testid="title-input"
              type="text"
              value={titleDraft}
              disabled={!editable}
              aria-invalid={titleError ? true : undefined}
              aria-describedby="title-help"
              onChange={(event) => setTitleDraft(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              style={{ fontSize: '14px', minHeight: '44px' }}
            />
            <p
              id="title-help"
              className={`mt-1 break-words ${titleError ? 'text-rose-600' : 'text-slate-500 dark:text-slate-400'}`}
              style={{ fontSize: '12px' }}
              data-testid="title-help"
            >
              {titleError ?? copy.titleNotPublished}
            </p>
          </div>
        ) : null}

        {!editingTitle && suggestion ? (
          <p
            className="mt-2 break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px' }}
            data-testid="title-not-published"
          >
            {copy.titleNotPublished}
          </p>
        ) : null}
      </section>
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
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      </div>
    );
  }

  const view = draft.data;
  const usable = view && typeof view.version === 'number' && view.data !== undefined;
  if (!usable) {
    return (
      <p
        className="break-words text-rose-600"
        style={{ fontSize: '13px' }}
        data-testid="services-load-failed"
      >
        {copy.heading}
      </p>
    );
  }

  return <ServicesTaskScreen view={view} lang={lang} editable={view.editable} />;
}
