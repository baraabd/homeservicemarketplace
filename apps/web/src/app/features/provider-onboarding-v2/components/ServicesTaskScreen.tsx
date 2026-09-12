import { Clock, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  ProviderOnboardingDraftView,
  ProviderTransportModeCode,
} from '@homeservicemarketplace/contracts';

import { useServiceCategories } from '../../../../lib/use-service-categories';
import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import { useOnboardingStepAutosave } from '../autosave/ProviderOnboardingAutosaveProvider';
import { SERVICES_COPY, type Lang } from '../copy/services-copy';
import { OnboardingAlert } from './OnboardingAlert';
import {
  ProviderCard,
  ProviderChoiceToggle,
  ProviderSkeleton,
  ProviderStepper,
  ProviderErrorState,
  ProviderTextInput,
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

/**
 * The four transport modes the approved screen offers, in its order.
 *
 * The product supports six; VAN and TRUCK are not on this screen. That is a
 * DISPLAY decision and it is not allowed to destroy data: `toggleMode` below
 * preserves any stored mode outside this list, so a provider who recorded a van
 * on an earlier surface still has it after editing this one. Recorded for
 * Phase 5B — the approved screen and the supported set disagree, and the
 * backend is not being changed to settle it here.
 */
const APPROVED_TRANSPORT: ProviderTransportModeCode[] = [
  'CAR',
  'MOTORCYCLE',
  'ON_FOOT',
  'PUBLIC_TRANSPORT',
];

const TRANSPORT_LABELS: Record<Lang, Record<ProviderTransportModeCode, string>> = {
  en: {
    ON_FOOT: 'On foot',
    MOTORCYCLE: 'Motorbike',
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

/** Which of the task's two approved screens is showing. */
export type ServicesPart = 'services' | 'experience';

interface ServicesTaskScreenProps {
  view: ProviderOnboardingDraftView;
  lang: Lang;
  editable: boolean;
  part: ServicesPart;
}

export function ServicesTaskScreen({ view, lang, editable, part }: ServicesTaskScreenProps) {
  const copy = SERVICES_COPY[lang];

  const specialtiesAutosave = useOnboardingStepAutosave('SPECIALTIES');
  const experienceAutosave = useOnboardingStepAutosave('EXPERIENCE');
  // Sprint 09B.29 Phase 5A — the status line moved into the approved sticky
  // bar, which reports the STEP the screen on display writes: SPECIALTIES on
  // screen 4, EXPERIENCE on screen 5. That is more precise than the merge it
  // replaces, which could show a conflict from the half the provider was not
  // looking at.

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

  /**
   * The OPERATOR-configured ceiling, still enforced.
   *
   * The approved screen shows no counter — the old "0 of 5 chosen" line is not
   * in the design — but the limit itself is a server setting and dropping it
   * with the counter would let the screen offer a selection the save is about
   * to refuse. Removal is always allowed, including at the limit, because the
   * way out of a full list must never be closed.
   */
  const atLimit = chosenIds.length >= data.maxSpecialties;

  const toggleSpecialty = (categoryId: string) => {
    const chosen = chosenIds.includes(categoryId);
    if (!chosen && atLimit) return;
    const next = chosen ? chosenIds.filter((id) => id !== categoryId) : [...chosenIds, categoryId];
    specialtiesAutosave.save({ specialtyLeafIds: next });
  };

  /** The search box on the approved screen, filtering the flat leaf list. */
  const [query, setQuery] = useState('');

  /**
   * The selectable leaves, filtered by the search box.
   *
   * `isLeaf` is READ from the catalogue, never inferred from "has no
   * children": a parent whose last child was retired must not silently become
   * selectable. Same rule the server enforces, and the reason the approved
   * flat list is safe to draw from the catalogue directly.
   */
  const visibleLeaves = useMemo(() => {
    const all = (catalogue.data ?? [])
      .filter((c) => c.isLeaf)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({ id: c.id, labelEn: c.labelEn, labelAr: c.labelAr }));

    // A specialty the provider HOLDS but the catalogue no longer lists —
    // retired, or withdrawn while they were mid-application — is appended from
    // the draft rather than dropped. The contract serves its labels with the
    // state for exactly this reason: without it a retired specialty either
    // renders as a bare id or, worse, silently disappears from a screen the
    // provider is being asked to confirm.
    const known = new Set(all.map((c) => c.id));
    const orphans = specialties
      .filter((sp) => !known.has(sp.categoryId))
      .map((sp) => ({ id: sp.categoryId, labelEn: sp.labelEn, labelAr: sp.labelAr }));

    const q = query.trim().toLowerCase();
    const rows = [...all, ...orphans];
    if (q === '') return rows;
    return rows.filter(
      (c) => c.labelEn.toLowerCase().includes(q) || c.labelAr.toLowerCase().includes(q),
    );
  }, [catalogue.data, query, specialties]);

  /**
   * The trailing note on a choice row.
   *
   * "Primary" for the nominated service, as the reference has it — and the
   * MODERATION STATE for anything an admin has not approved. The approved
   * screen has no per-state section list, so this row-level note is where a
   * refused or retired specialty still says so. Silence there would be the one
   * outcome a provider cannot act on.
   */
  const metaFor = (categoryId: string): string | undefined => {
    if (categoryId === data.primarySpecialtyId) return copy.primaryBadge;
    const state = specialties.find((s) => s.categoryId === categoryId)?.state;
    if (!state || state === 'APPROVED' || state === 'PENDING') return undefined;
    return copy.stateHeading[state];
  };

  // The per-state grouping that fed the four labelled sections is gone with
  // them. The state a specialty is in now travels on its own row (`metaFor`),
  // so nothing it carried was lost — only the bucketing it needed.

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

  /**
   * The range the primary mode currently grants, or nothing.
   *
   * `allowedMaxKm` is the ceiling IN FORCE, not `radiusPolicy.maxKm` which is
   * the one an expansion could unlock — the work-area reward card explains the
   * difference, and promising the higher number here would contradict it.
   *
   * Both are optional on a partial draft, and an absent radius means the note
   * is simply not drawn. Reading through them unguarded threw on any response
   * that had not resolved a policy yet, which took the whole screen down.
   */
  const rangeKm = data.serviceAreaExpansion?.allowedMaxKm ?? data.radiusPolicy?.suggestedKm ?? null;
  const primaryRange = rangeKm === null ? undefined : copy.transportRange(rangeKm);

  const toggleMode = (mode: ProviderTransportModeCode) => {
    const next = selectedModes.includes(mode)
      ? selectedModes.filter((m) => m !== mode)
      : [...selectedModes, mode];
    // A mode the approved screen does not show is still the provider's answer.
    // Toggling Car must not silently drop a stored VAN, so anything outside
    // the four on screen is carried through untouched.
    const preserved = selectedModes.filter((m) => !APPROVED_TRANSPORT.includes(m));
    const merged = [...new Set([...next, ...preserved])];
    // The primary is NOT sent. The server keeps it consistent with the set —
    // re-pointing it when the set no longer contains it — so the client never
    // has to decide, and two clients cannot decide differently.
    experienceAutosave.save({ transportModes: merged });
  };

  // ── Screen 4: the services picker ────────────────────────────────────────
  if (part === 'services') {
    return (
      <div className="flex flex-col gap-[18px]" data-testid="services-task">
        {/* `.hsm-kicker` + `.hsm-heading`, as one block with no gap between
            them: the reference puts the eyebrow and the question in a bare
            `<div>`, so only the column gap separates the pair from what
            follows. */}
        <div>
          <p className="break-words text-pv-label font-bold leading-[21px] text-pv-accent-hover">
            {copy.kicker}
          </p>
          <h2 className="break-words text-pv-hero font-bold leading-[1.35] text-pv-text">
            {copy.question}
          </h2>
        </div>

        {/* The search field, with the glyph INSIDE the control.
            `.hsm-search` positions it 13px from the leading edge, 14px down,
            and pads the input's leading side to 42px so the text never runs
            under it. In RTL both flip, which `inset-inline-start` and
            `ps-` do for free. */}
        <div className="relative">
          <ProviderTextInput
            label={copy.searchLabel}
            type="search"
            className="ps-[42px]"
            placeholder={copy.searchPlaceholder}
            value={query}
            disabled={!editable}
            onChange={(event) => setQuery(event.target.value)}
            data-testid="specialty-search"
          />
          <Search
            size={16}
            strokeWidth={1.8}
            aria-hidden="true"
            className="pointer-events-none absolute top-[42px] text-pv-muted"
            style={{ insetInlineStart: 13 }}
          />
        </div>

        {catalogue.isLoading ? (
          <div data-testid="catalogue-loading">
            <ProviderSkeleton rows={3} label={copy.question} />
          </div>
        ) : (
          // `.hsm-choice-list`: an 8px column of multi-select rows.
          <div className="grid gap-2" data-testid="specialty-choices">
            {/* A search that matches nothing is a dead end without this, and
                the approved reference never draws the state — it shows a
                catalogue that always matches — so saying so cannot affect
                parity and its absence would only ever be felt by someone
                already stuck. */}
            {visibleLeaves.length === 0 ? (
              <p
                className="break-words text-pv-help leading-[1.6] text-pv-muted"
                data-testid="specialty-no-results"
              >
                {copy.noResults} {copy.noResultsHint}
              </p>
            ) : null}
            {visibleLeaves.map((leaf) => (
              <ProviderChoiceToggle
                key={leaf.id}
                testId={`specialty-choice-${leaf.id}`}
                checked={chosenIds.includes(leaf.id)}
                onToggle={() => toggleSpecialty(leaf.id)}
                // At the ceiling the unchosen rows are genuinely unavailable,
                // and say so, rather than accepting a press that the save
                // would refuse. The chosen ones stay live so the provider can
                // always make room.
                disabled={!editable || (atLimit && !chosenIds.includes(leaf.id))}
                label={lang === 'ar' ? leaf.labelAr : leaf.labelEn}
                meta={metaFor(leaf.id)}
              />
            ))}
          </div>
        )}

        {/* The one thing the approved screen says about moderation, and it is
            the sentence that stops a PENDING specialty reading as a mistake.
            It replaces the per-state section list: the state a specialty is in
            now travels on its own row as `meta`, so nothing is hidden. */}
        <OnboardingAlert
          tone="waiting"
          icon={Clock}
          title={copy.moderationTitle}
          body={copy.moderationBody}
          density="compact"
          data-testid="specialty-moderation-notice"
        />
      </div>
    );
  }

  // ── Screen 5: experience and transport ───────────────────────────────────
  return (
    <div className="flex flex-col gap-[18px]" data-testid="experience-section">
      <ProviderStepper
        label={copy.yearsLabel}
        hint={copy.startYearHint}
        value={years}
        min={0}
        max={MAX_YEARS}
        decreaseLabel={copy.yearsDecrease}
        increaseLabel={copy.yearsIncrease}
        onChange={commitYears}
        disabled={!editable}
        testId="experience-years"
      />

      {/* A real fieldset/legend, because this is a group of checkboxes and the
          platform announces it as one. The 7px sits on the legend rather than
          on a flex gap: a `<legend>` is not laid out as an ordinary flex item,
          so a gap here would be applied inconsistently across engines. */}
      <fieldset className="flex flex-col" data-testid="transport-options">
        <legend className="mb-[7px] break-words text-pv-label font-bold leading-[21px] text-pv-text">
          {copy.transportQuestion}
        </legend>
        <div className="grid gap-2">
          {APPROVED_TRANSPORT.map((mode) => (
            <ProviderChoiceToggle
              key={mode}
              testId={`transport-${mode}`}
              checked={selectedModes.includes(mode)}
              onToggle={() => toggleMode(mode)}
              disabled={!editable}
              label={TRANSPORT_LABELS[lang][mode]}
              // The radius this transport CURRENTLY grants, not the ceiling it
              // could reach. `allowedMaxKm` is the limit in force — the reward
              // card on the work-area screen explains the difference between
              // that and `radiusPolicy.maxKm`, and showing the ceiling here
              // would promise a range the provider does not yet have.
              meta={mode === primaryMode ? primaryRange : undefined}
            />
          ))}
        </div>
      </fieldset>

      {suggestedTitle ? (
        // `.hsm-panel`: the generated title, explained. Never editable here —
        // ruling C1 makes it server-owned.
        <ProviderCard className="p-4" style={{ borderRadius: 14 }} data-testid="suggested-title">
          <h3
            className="break-words text-pv-input text-pv-text"
            style={{ marginBottom: 5, fontWeight: 500, lineHeight: 1.25 }}
          >
            {copy.suggestedTitlePanel}
          </h3>
          <p
            className="break-words text-pv-label text-pv-muted"
            style={{ lineHeight: 1.65 }}
            data-testid="title-suggestion-text"
          >
            {copy.suggestedTitleBody(suggestedTitle)}
          </p>
        </ProviderCard>
      ) : null}
    </div>
  );
}

// ─── Container ──────────────────────────────────────────────────────────────

/** Loads the draft and renders Task 2. Mirrors BasicsTask — see it for why the
 *  shape is validated rather than merely checked for presence. */
export function ServicesTask({ lang, part }: { lang: Lang; part: ServicesPart }) {
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

  return <ServicesTaskScreen view={view} lang={lang} editable={view.editable} part={part} />;
}
