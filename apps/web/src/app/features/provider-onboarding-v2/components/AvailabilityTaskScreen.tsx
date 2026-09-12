import { useCallback, useMemo, useState } from 'react';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import { useOnboardingStepAutosave } from '../autosave/ProviderOnboardingAutosaveProvider';
import { AVAILABILITY_COPY, DAY_NAMES, type Lang } from '../copy/availability-copy';
import {
  ProviderButton,
  ProviderErrorState,
  ProviderSkeleton,
  ProviderTextInput,
} from '../../provider-ui';
import {
  EMPTY_WEEK,
  MAX_INTERVALS_PER_WEEK,
  applyToDays,
  clearDay,
  isDayAvailable,
  formatMinute,
  toIntervals,
  toWeek,
  type RejectionCode,
  type Week,
} from '../availability/weekly-schedule';

// Sprint 9B.21 — V2 Task 4: the weekly schedule, in one screen.
//
// docs/sprint-09b21/BULK_AVAILABILITY.md
//
// WHAT THIS REPLACES
//
// The V1 step is a list of rows, each carrying its own day dropdown and its
// own pair of time fields. A Sunday-to-Thursday week is five rows, five day
// dropdowns and ten time fields, and every one of them is a chance to pick the
// wrong day. Here it is: tap five days, choose two times, press apply.
//
// Sprint 09B.29 Phase 5A — rebuilt as the approved screen: day toggles, one
// From/To pair, Apply, and a checkbox that turns Apply into a clear.
//
// WHAT THIS SCREEN IS BUILT AROUND
//
// 1. THE TOGGLES ARE THE SCHEDULE. Applying makes the week exactly the days
//    that are on, so switching Wednesday off and applying genuinely stops
//    Wednesday work rather than leaving a window nobody can see.
//
// 2. THE WHOLE WEEK IS THE UNIT OF SAVE. Every edit sends the complete set of
//    intervals, and the server replaces them inside one transaction. A partial
//    bulk update therefore cannot exist: there is no request that carries
//    three of five days.
//
// 3. AN INVALID RANGE IS REFUSED AND SAID OUT LOUD. The native time inputs can
//    express 18:00-09:00; `applyToDays` rejects it and the screen prints why,
//    rather than saving something the server would refuse.
//
// RECORDED FOR PHASE 5B: the presets, the per-day editor and the timezone
// picker are not on the approved screen. See `applySelected` and the unit
// suite, which assert each absence so re-adding one is deliberate.

interface AvailabilityTaskScreenProps {
  view: ProviderOnboardingDraftView;
  lang: Lang;
  editable: boolean;
}

export function AvailabilityTaskScreen({ view, lang, editable }: AvailabilityTaskScreenProps) {
  const copy = AVAILABILITY_COPY[lang];
  // Full day names, for the accessible name on each 2-letter toggle.
  const days = DAY_NAMES[lang];
  const autosave = useOnboardingStepAutosave('AVAILABILITY');

  const data = view.data;
  const resolved = data.resolvedTimezone;

  // The server's copy is the source of truth for what is SAVED; this mirrors
  // it for editing. Re-derived when the server's answer changes, so a reload
  // or a conflict resolution replaces local state rather than merging into it.
  const serverWeek = useMemo(() => toWeek(data.availability), [data.availability]);
  const [week, setWeek] = useState<Week>(serverWeek);

  // Adjusted DURING RENDER rather than in an effect.
  //
  // React's own pattern for "reset state when a prop changes": an effect that
  // calls setState runs AFTER the browser has painted, so the provider would
  // see one frame of the old schedule every time a save came back. Comparing
  // here re-renders before anything is shown, and it keeps the linter's
  // set-state-in-effect rule satisfied for the right reason rather than by
  // suppression.
  /**
   * The days the provider WORKS, which is what the approved toggles show.
   *
   * They open reflecting the stored schedule rather than empty: the reference
   * draws Sunday to Thursday filled because that is the week the provider has,
   * and a row of blank toggles over a saved schedule would read as "you have
   * told us nothing" to someone who has.
   */
  const serverDays = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].filter((day) => isDayAvailable(serverWeek, day)),
    [serverWeek],
  );

  const [selectedDays, setSelectedDays] = useState<number[]>(() =>
    [0, 1, 2, 3, 4, 5, 6].filter((day) => isDayAvailable(serverWeek, day)),
  );

  const [lastServerWeek, setLastServerWeek] = useState<Week>(serverWeek);
  if (serverWeek !== lastServerWeek) {
    setLastServerWeek(serverWeek);
    setWeek(serverWeek);
    setSelectedDays(serverDays);
  }

  // Read, never chosen: the approved screen has no timezone control, so the
  // stored zone is carried with every write and nothing here can change it.
  // See `applySelected` for the recorded Phase 5B gap.
  const timezone = data.timezone ?? resolved.resolved ?? '';
  const [bulkStart, setBulkStart] = useState(540);
  const [bulkEnd, setBulkEnd] = useState(1020);
  const [rejected, setRejected] = useState<RejectionCode | null>(null);
  /** Whether "Apply" clears the chosen days instead of setting them. */
  const [markUnavailable, setMarkUnavailable] = useState(false);

  /** One save path. Every mutation goes through here with the COMPLETE week,
   *  so there is no request that carries a partial schedule. */
  const commit = useCallback(
    (next: Week) => {
      setWeek(next);
      if (!editable) return;
      autosave.save({ availability: toIntervals(next), timezone: timezone || null });
    },
    [autosave, editable, timezone],
  );

  /** Apply a change from the pure model, surfacing a refusal instead of
   *  silently doing nothing. */
  const applyChange = useCallback(
    (change: { week: Week; rejected?: RejectionCode }) => {
      if (change.rejected) {
        setRejected(change.rejected);
        return;
      }
      setRejected(null);
      commit(change.week);
    },
    [commit],
  );

  const toggleDay = (day: number) =>
    setSelectedDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort(),
    );

  /**
   * Apply the window — or the absence of one — to every selected day.
   *
   * RECORDED FOR PHASE 5B: the approved screen has no timezone control, and
   * `resolvedTimezone.needsConfirmation` is the one case where the server
   * cannot work the zone out on its own (a country spanning several). The
   * stored `timezone` is preserved and sent with every write, exactly as
   * before; what is missing is the surface to CONFIRM one when the server asks
   * for it. Nothing here guesses a zone.
   */
  const applySelected = () => {
    if (selectedDays.length === 0) return;
    if (markUnavailable) {
      // Clear each chosen day. The From/To pair above is untouched, which is
      // what makes turning a day back on one tap.
      let next = week;
      for (const day of selectedDays) next = clearDay(next, day).week;
      setRejected(null);
      commit(next);
      return;
    }
    // THE TOGGLES ARE THE SCHEDULE.
    //
    // Applying makes the week exactly the selected days, so a day switched off
    // and applied is a day the provider no longer works — building on the
    // existing week instead would let them turn Wednesday off, press Apply,
    // and still be matched on a Wednesday.
    //
    // RECORDED FOR PHASE 5B: this also replaces any SECOND window on a
    // selected day, because the approved screen expresses one window across
    // the days it is applied to. The contract still stores several per day;
    // there is simply no surface here to create or keep a second one.
    applyChange(
      applyToDays(EMPTY_WEEK, selectedDays, { startMinute: bulkStart, endMinute: bulkEnd }),
    );
  };

  /** "09:00" -> 540. Falls back to the current value for a cleared field. */
  const minutesOf = (value: string, fallback: number): number => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return fallback;
    return Number(match[1]) * 60 + Number(match[2]);
  };

  return (
    <div className="flex flex-col gap-[18px]" data-testid="availability-task">
      <div>
        <p className="break-words text-pv-label font-bold leading-[21px] text-pv-accent-hover">
          {copy.kicker}
        </p>
        <h2 className="break-words text-pv-hero font-bold leading-[1.35] text-pv-text">
          {copy.question}
        </h2>
      </div>

      {/* ── The days ────────────────────────────────────────────────────────
          `.hsm-days`: a 7px-gap wrap of 44x44 toggles. A real `group` with a
          name, and `aria-pressed` per day, so a screen-reader user hears which
          days are on without having to infer it from a colour. */}
      <div
        role="group"
        aria-label={copy.daysLegend}
        className="flex flex-wrap gap-[7px]"
        data-testid="day-toggles"
      >
        {copy.dayAbbrev.map((abbrev, day) => {
          const on = selectedDays.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              aria-label={days[day]}
              disabled={!editable}
              onClick={() => toggleDay(day)}
              data-testid={`day-toggle-${day}`}
              // No horizontal padding beyond the 44px floor: `.hsm-day` sets only a
              // minimum width, so a two-letter label sits in a 44px square rather
              // than a 50px one. Seven of those is 42px of drift across the row.
              // `.hsm-day` declares neither a weight nor a line-height, so it takes
              // the wrapper body (400) and the 21px line box. The base layer would
              // otherwise give this `button` a 1.5 ratio and a 500 weight.
              className={`min-h-[44px] min-w-[44px] rounded-pv-control border px-1.5 py-px text-pv-day font-normal leading-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent disabled:opacity-60 ${
                on
                  ? 'border-pv-accent bg-pv-accent text-white'
                  : 'border-pv-border-strong bg-pv-surface text-pv-text'
              }`}
            >
              {abbrev}
            </button>
          );
        })}
      </div>

      {/* ── The window ──────────────────────────────────────────────────────
          `.hsm-time-row`: two equal columns. Native `time` inputs, so the
          platform's own picker and keyboard entry apply and no custom listbox
          has to re-implement either. */}
      <div className="grid grid-cols-2 gap-2.5">
        <ProviderTextInput
          label={copy.fromLabel}
          type="time"
          value={formatMinute(bulkStart)}
          disabled={!editable}
          data-testid="bulk-start"
          onChange={(event) => setBulkStart(minutesOf(event.target.value, bulkStart))}
        />
        <ProviderTextInput
          label={copy.toLabel}
          type="time"
          value={formatMinute(bulkEnd)}
          disabled={!editable}
          data-testid="bulk-end"
          onChange={(event) => setBulkEnd(minutesOf(event.target.value, bulkEnd))}
        />
      </div>

      <ProviderButton
        tone="secondary"
        shape="onboarding"
        size="block"
        disabled={!editable || selectedDays.length === 0}
        onClick={applySelected}
        data-testid="apply-to-selected"
      >
        {copy.applyToSelectedDays}
      </ProviderButton>

      {/* ── "Unavailable on selected days" ──────────────────────────────────
          `.hsm-consent`. What the label promises is exactly what this does:
          applying with it checked CLEARS the chosen days, and the From/To pair
          above is left alone — so turning a day back on is one tap rather than
          re-entering the window.

          RECORDED FOR PHASE 5B: the contract has no per-day "enabled" flag
          (`ProviderAvailabilityInterval` is a day plus two minutes and nothing
          else), so "disabled" is expressed as "no windows for that day". A
          provider who had two windows on a Tuesday and disables it does lose
          the second one. Carrying them across would need a server-side flag,
          and the backend is not being changed here. */}
      <label
        // `font-normal` on the row: the base layer gives every `label` a 500
        // weight and everything inside inherits it, so the help line rendered
        // heavier and darker than the reference. Only the `strong` is 500,
        // which is what the approved design declares.
        className="flex items-start gap-2.5 rounded-pv-choice border border-pv-border bg-pv-surface p-3.5 text-pv-label font-normal leading-[1.6]"
        data-testid="mark-unavailable"
      >
        <input
          type="checkbox"
          // The approved rule overrides only `margin-top` on this input, so the
          // user agent's own 4px/3px side margins survive in the reference.
          // Our preflight zeroes them, which pulled the label 7px toward the
          // checkbox and re-wrapped the sentence beside it.
          className="ms-1 me-[3px] mt-0.5 h-5 w-5 flex-shrink-0 accent-pv-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
          checked={markUnavailable}
          disabled={!editable}
          onChange={(event) => setMarkUnavailable(event.target.checked)}
        />
        <span className="min-w-0">
          <strong className="font-medium text-pv-text">{copy.unavailableLabel}</strong>
          <br />
          <span className="text-pv-help text-pv-muted">{copy.unavailableHint}</span>
        </span>
      </label>

      {/* A refusal from the pure model is reported, never swallowed. */}
      {rejected ? (
        <p
          className="break-words text-pv-label text-pv-danger"
          role="status"
          aria-live="polite"
          data-testid="availability-rejected"
        >
          {rejectionMessage(rejected, copy)}
        </p>
      ) : null}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type AvailabilityCopyShape = (typeof AVAILABILITY_COPY)['en'];

function rejectionMessage(code: RejectionCode, copy: AvailabilityCopyShape): string {
  switch (code) {
    case 'OVERLAP':
      return copy.rejectedOverlap;
    case 'DUPLICATE':
      return copy.rejectedDuplicate;
    case 'TOO_MANY_INTERVALS':
      return copy.rejectedTooMany(MAX_INTERVALS_PER_WEEK);
    case 'INVALID_RANGE':
      return copy.rejectedInvalidRange;
  }
}

// ─── Container ──────────────────────────────────────────────────────────────

/** Loads the draft and renders Task 4. Mirrors the other V2 task containers. */
export function AvailabilityTask({ lang }: { lang: Lang }) {
  const draft = useOnboardingDraft();
  const copy = AVAILABILITY_COPY[lang];

  if (!draft.isFetched) {
    return <ProviderSkeleton label={copy.heading} />;
  }

  const view = draft.data;
  // The same shape guard the other task screens carry: an unexpected draft
  // shape must produce a message, not a blank screen with a stack trace behind
  // it. `availability` and `resolvedTimezone` are what this screen cannot do
  // without.
  const usable =
    view &&
    typeof view.version === 'number' &&
    view.data !== undefined &&
    Array.isArray(view.data.availability) &&
    view.data.resolvedTimezone !== undefined;

  if (!usable) {
    return <ProviderErrorState title={copy.heading} testId="availability-load-failed" />;
  }

  return <AvailabilityTaskScreen view={view} lang={lang} editable={view.editable} />;
}
