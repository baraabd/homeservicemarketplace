import { AutosaveStatus } from './AutosaveStatus';
import { useCallback, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { DAY_LABELS } from '../../../components/provider/onboarding/wizard-copy';
import {
  useOnboardingDraft,
  useOnboardingStepAutosave,
} from '../../../hooks/provider/useProviderOnboarding';
import { AVAILABILITY_COPY, type Lang } from '../copy/availability-copy';
import {
  DAY_PRESETS,
  MAX_INTERVALS_PER_WEEK,
  addWindow,
  applyToDays,
  clearDay,
  countWindows,
  endOptions,
  formatMinute,
  removeWindow,
  replaceWindow,
  startOptions,
  toIntervals,
  toWeek,
  weekTotals,
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
// THREE THINGS THIS SCREEN IS BUILT AROUND
//
// 1. INVALID STATES ARE UNREACHABLE, not merely rejected. The end control
//    offers only times after the chosen start, so an inverted or overnight
//    range cannot be selected. Bulk apply REPLACES a day, so it cannot produce
//    a duplicate. See weekly-schedule.ts.
//
// 2. THE WHOLE WEEK IS THE UNIT OF SAVE. Every edit sends the complete set of
//    intervals, and the server replaces them inside one transaction. A partial
//    bulk update therefore cannot exist: there is no request that carries
//    three of five days.
//
// 3. NO TEXT INPUTS. Every control is a button or a native <select>, so no
//    soft keyboard is ever raised over the schedule — which is most of the
//    "sticky actions and the keyboard must not cover the last row" problem
//    solved by construction rather than by measuring viewports.

interface AvailabilityTaskScreenProps {
  view: ProviderOnboardingDraftView;
  lang: Lang;
  editable: boolean;
}

/** Which day row is expanded for per-day editing, if any. */
type Expanded = number | null;

export function AvailabilityTaskScreen({ view, lang, editable }: AvailabilityTaskScreenProps) {
  const copy = AVAILABILITY_COPY[lang];
  const days = DAY_LABELS[lang];
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
  const [lastServerWeek, setLastServerWeek] = useState<Week>(serverWeek);
  if (serverWeek !== lastServerWeek) {
    setLastServerWeek(serverWeek);
    setWeek(serverWeek);
  }

  const [timezone, setTimezone] = useState<string>(data.timezone ?? resolved.resolved ?? '');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [bulkStart, setBulkStart] = useState(540);
  const [bulkEnd, setBulkEnd] = useState(1020);
  const [rejected, setRejected] = useState<RejectionCode | null>(null);
  const [expanded, setExpanded] = useState<Expanded>(null);

  const totals = weekTotals(week);

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

  const timezoneMissing = resolved.needsConfirmation && timezone.trim() === '';

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="availability-task">
      <p className="break-words text-slate-500 dark:text-slate-400" style={{ fontSize: '13px' }}>
        {copy.intro}
      </p>

      {/* What the server actually knows. A schedule that looks saved and is
          not is worse than one that says it failed. */}
      <AutosaveStatus status={autosave.status} lang={lang} testIdPrefix="availability" />

      {/* ── Time zone ─────────────────────────────────────────────────────
          Resolved from the country in Task 3 and merely STATED. The raw IANA
          identifier appears only where the country spans several zones and
          somebody genuinely has to choose — the one case Sprint 9B.19 left to
          this step. */}
      <TimezoneSection
        copy={copy}
        resolved={resolved}
        timezone={timezone}
        editable={editable}
        onChange={(next) => {
          setTimezone(next);
          if (!editable) return;
          // Sent on its own: the server re-stamps the existing week onto the
          // new zone, rather than leaving half a schedule on the old one.
          autosave.save({ timezone: next || null, availability: toIntervals(week) });
        }}
      />

      {/* ── Bulk editor ───────────────────────────────────────────────────
          The thing the sprint exists for. */}
      <section aria-labelledby="bulk-heading" className="min-w-0">
        <h2
          id="bulk-heading"
          className="break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.bulkLegend}
        </h2>
        <p
          className="mt-1 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
        >
          {copy.bulkHint}
        </p>

        <fieldset className="mt-3 min-w-0 border-0 p-0">
          <legend className="sr-only">{copy.daysLegend}</legend>
          <div className="flex min-w-0 flex-wrap gap-2" data-testid="day-toggles">
            {days.map((name, day) => {
              const on = selectedDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!editable}
                  aria-pressed={on}
                  data-testid={`day-toggle-${day}`}
                  onClick={() => toggleDay(day)}
                  className={
                    on
                      ? 'rounded-full border border-blue-600 bg-blue-600 px-3 text-white'
                      : 'rounded-full border border-slate-300 bg-white px-3 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                  }
                  style={{ minHeight: '44px', minWidth: '44px', fontSize: '13px' }}
                >
                  {/* The full name is the accessible name; the visible label is
                      short so seven of them fit at 320px without wrapping into
                      a second stack. */}
                  <span aria-hidden="true">{shortDay(name)}</span>
                  <span className="sr-only">{name}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Presets SELECT days. They apply nothing — see availability-copy.ts. */}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-slate-500 dark:text-slate-400" style={{ fontSize: '12px' }}>
            {copy.presetLegend}
          </span>
          <PresetButton
            testId="preset-sun-thu"
            label={copy.presetSunThu}
            disabled={!editable}
            onClick={() => setSelectedDays([...DAY_PRESETS.SUN_THU])}
          />
          <PresetButton
            testId="preset-mon-fri"
            label={copy.presetMonFri}
            disabled={!editable}
            onClick={() => setSelectedDays([...DAY_PRESETS.MON_FRI])}
          />
          {selectedDays.length > 0 ? (
            <PresetButton
              testId="preset-clear"
              label={copy.presetClear}
              disabled={!editable}
              onClick={() => setSelectedDays([])}
            />
          ) : null}
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap gap-3">
          <TimeSelect
            id="bulk-start"
            label={copy.fromLabel}
            value={bulkStart}
            options={startOptions(bulkStart)}
            disabled={!editable}
            onChange={(minute) => {
              setBulkStart(minute);
              // Keep the pair coherent the moment the start moves, so the end
              // control never displays a value it no longer offers.
              if (bulkEnd <= minute) setBulkEnd(endOptions(minute)[0] ?? minute + 15);
            }}
          />
          <TimeSelect
            id="bulk-end"
            label={copy.toLabel}
            value={bulkEnd}
            options={endOptions(bulkStart, bulkEnd)}
            disabled={!editable}
            onChange={setBulkEnd}
          />
        </div>

        <button
          type="button"
          data-testid="apply-to-selected"
          disabled={!editable || selectedDays.length === 0 || timezoneMissing}
          onClick={() =>
            applyChange(
              applyToDays(week, selectedDays, { startMinute: bulkStart, endMinute: bulkEnd }),
            )
          }
          className="mt-3 w-full rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-50"
          style={{ minHeight: '44px', fontSize: '15px' }}
        >
          {copy.applyToSelected(selectedDays.length)}
        </button>
        {selectedDays.length === 0 ? (
          <p
            className="mt-1 break-words text-slate-500 dark:text-slate-400"
            style={{ fontSize: '12px' }}
            data-testid="apply-disabled-hint"
          >
            {copy.applyDisabledHint}
          </p>
        ) : null}
        {timezoneMissing ? (
          <p
            className="mt-1 break-words text-rose-600"
            style={{ fontSize: '12px' }}
            data-testid="timezone-required"
          >
            {copy.timezoneRequired}
          </p>
        ) : null}
        {rejected ? (
          <p
            className="mt-2 break-words text-rose-600"
            style={{ fontSize: '12px' }}
            role="alert"
            data-testid="availability-rejected"
          >
            {rejectionMessage(rejected, copy)}
          </p>
        ) : null}
      </section>

      {/* ── The week ──────────────────────────────────────────────────────
          Seven compact rows, not seven cards. Every day is present whether or
          not it has hours: a day that simply vanishes when cleared gives the
          provider nowhere to tap to bring it back. */}
      <section aria-labelledby="week-heading" className="min-w-0">
        <h2
          id="week-heading"
          className="break-words text-slate-900 dark:text-white"
          style={{ fontSize: '15px', fontWeight: 700 }}
        >
          {copy.summaryLegend}
        </h2>
        <p
          className="mt-1 break-words text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px' }}
          data-testid="week-totals"
          role="status"
          aria-live="polite"
        >
          {totals.dayCount === 0
            ? copy.summaryEmpty
            : copy.summaryTotals(totals.dayCount, formatHours(totals.totalMinutes))}
        </p>

        <ul className="mt-2 flex min-w-0 flex-col" data-testid="week-summary">
          {days.map((name, day) => (
            <DayRow
              key={day}
              day={day}
              name={name}
              windows={week[day] ?? []}
              copy={copy}
              editable={editable}
              expanded={expanded === day}
              onToggleExpanded={() => setExpanded((c) => (c === day ? null : day))}
              onClear={() => applyChange(clearDay(week, day))}
              onSetHours={() =>
                applyChange(
                  applyToDays(week, [day], { startMinute: bulkStart, endMinute: bulkEnd }),
                )
              }
              onReplace={(index, w) => applyChange(replaceWindow(week, day, index, w))}
              onRemove={(index) => applyChange(removeWindow(week, day, index))}
              onAdd={() =>
                applyChange(addWindow(week, day, { startMinute: bulkStart, endMinute: bulkEnd }))
              }
              atCeiling={countWindows(week) >= MAX_INTERVALS_PER_WEEK}
            />
          ))}
        </ul>
      </section>

      {/* Breathing room under the last row. The shell's footer is a flex
          sibling rather than an overlay, and this screen raises no keyboard,
          but a row flush against the bottom edge is still hard to tap on a
          phone with a home indicator. */}
      <div
        aria-hidden="true"
        data-testid="availability-bottom-spacer"
        style={{ height: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
      />
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

/** The same status vocabulary Task 1 uses, for the same reason: a conflict is
 *  a different fact from a failure, and telling the provider "Saved" while the
 *  server holds something else is a lie by omission. */

function PresetButton({
  label,
  testId,
  disabled,
  onClick,
}: {
  label: string;
  testId: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border border-slate-300 bg-white px-3 text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      style={{ minHeight: '44px', fontSize: '13px' }}
    >
      {label}
    </button>
  );
}

function TimeSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  options: number[];
  disabled: boolean;
  onChange: (minute: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1" htmlFor={id}>
      <span className="text-slate-700 dark:text-slate-200" style={{ fontSize: '13px' }}>
        {label}
      </span>
      {/* A native <select> rather than <input type="time">.
          The column stores an EXCLUSIVE end, so a window running to midnight
          is 24:00 — a value a clock input cannot express at all. A select can,
          it opens the platform's own picker on a phone, it raises no keyboard,
          and it renders identically under RTL. */}
      <select
        id={id}
        data-testid={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        style={{ minHeight: '44px', fontSize: '15px' }}
      >
        {options.map((minute) => (
          <option key={minute} value={minute}>
            {formatMinute(minute)}
          </option>
        ))}
      </select>
    </label>
  );
}

function TimezoneSection({
  copy,
  resolved,
  timezone,
  editable,
  onChange,
}: {
  copy: AvailabilityCopyShape;
  resolved: ProviderOnboardingDraftView['data']['resolvedTimezone'];
  timezone: string;
  editable: boolean;
  onChange: (next: string) => void;
}) {
  const zones = useMemo(() => supportedTimezones(), []);

  if (!resolved.needsConfirmation && resolved.display) {
    return (
      <p
        className="break-words text-slate-500 dark:text-slate-400"
        style={{ fontSize: '12px' }}
        data-testid="timezone-resolved"
      >
        {copy.timezoneResolved(resolved.display.city, resolved.display.offset)}
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <label
        className="flex min-w-0 flex-col gap-1"
        htmlFor="availability-timezone"
        data-testid="timezone-choose"
      >
        <span className="text-slate-700 dark:text-slate-200" style={{ fontSize: '13px' }}>
          {copy.timezoneChooseLabel}
        </span>
        <select
          id="availability-timezone"
          data-testid="timezone-select"
          value={timezone}
          disabled={!editable}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          style={{ minHeight: '44px', fontSize: '15px' }}
        >
          <option value="">{copy.timezonePlaceholder}</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      <p
        className="mt-1 break-words text-slate-500 dark:text-slate-400"
        style={{ fontSize: '12px' }}
      >
        {copy.timezoneChooseHint}
      </p>
    </div>
  );
}

function DayRow({
  day,
  name,
  windows,
  copy,
  editable,
  expanded,
  atCeiling,
  onToggleExpanded,
  onClear,
  onSetHours,
  onReplace,
  onRemove,
  onAdd,
}: {
  day: number;
  name: string;
  windows: readonly { startMinute: number; endMinute: number }[];
  copy: AvailabilityCopyShape;
  editable: boolean;
  expanded: boolean;
  atCeiling: boolean;
  onToggleExpanded: () => void;
  onClear: () => void;
  onSetHours: () => void;
  onReplace: (index: number, w: { startMinute: number; endMinute: number }) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}) {
  const available = windows.length > 0;

  return (
    <li
      className="min-w-0 border-b border-slate-100 py-2 last:border-b-0 dark:border-slate-700"
      data-testid={`day-row-${day}`}
      data-available={available ? 'true' : 'false'}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="w-20 flex-shrink-0 truncate text-slate-900 dark:text-white"
          style={{ fontSize: '13px', fontWeight: 600 }}
        >
          {name}
        </span>

        <span
          className={
            available
              ? 'min-w-0 flex-1 break-words text-slate-700 dark:text-slate-200'
              : 'min-w-0 flex-1 break-words text-slate-400'
          }
          style={{ fontSize: '13px' }}
          data-testid={`day-summary-${day}`}
        >
          {available
            ? windows
                .map((w) =>
                  copy.windowRange(formatMinute(w.startMinute), formatMinute(w.endMinute)),
                )
                .join(', ')
            : copy.unavailable}
        </span>

        {available ? (
          <>
            <button
              type="button"
              disabled={!editable}
              onClick={onToggleExpanded}
              data-testid={`day-edit-${day}`}
              aria-expanded={expanded}
              aria-label={expanded ? copy.doneEditing : copy.editDay(name)}
              className="flex-shrink-0 rounded-lg px-2 text-blue-700 disabled:opacity-50 dark:text-blue-300"
              style={{ minHeight: '44px', minWidth: '44px', fontSize: '13px' }}
            >
              {expanded ? copy.doneEditing : copy.editDay(name).split(' ')[0]}
            </button>
            <button
              type="button"
              disabled={!editable}
              onClick={onClear}
              data-testid={`day-clear-${day}`}
              aria-label={copy.markUnavailable(name)}
              className="flex-shrink-0 rounded-lg px-2 text-slate-500 disabled:opacity-50"
              style={{ minHeight: '44px', minWidth: '44px' }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!editable}
            onClick={onSetHours}
            data-testid={`day-set-${day}`}
            aria-label={copy.setHours(name)}
            className="flex-shrink-0 rounded-lg px-2 text-blue-700 disabled:opacity-50 dark:text-blue-300"
            style={{ minHeight: '44px', minWidth: '44px', fontSize: '13px' }}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Per-day editing, inline and only when asked for. This is what makes
          "bulk apply, then fix Wednesday" a two-tap operation rather than a
          reason to abandon the bulk editor. */}
      {expanded && available ? (
        <div className="mt-2 flex min-w-0 flex-col gap-2" data-testid={`day-editor-${day}`}>
          {windows.map((w, index) => (
            <div key={`${w.startMinute}-${w.endMinute}`} className="flex min-w-0 items-end gap-2">
              <TimeSelect
                id={`day-${day}-start-${index}`}
                label={copy.fromLabel}
                value={w.startMinute}
                options={startOptions(w.startMinute)}
                disabled={!editable}
                onChange={(minute) =>
                  onReplace(index, {
                    startMinute: minute,
                    endMinute:
                      w.endMinute > minute ? w.endMinute : (endOptions(minute)[0] ?? minute + 15),
                  })
                }
              />
              <TimeSelect
                id={`day-${day}-end-${index}`}
                label={copy.toLabel}
                value={w.endMinute}
                options={endOptions(w.startMinute, w.endMinute)}
                disabled={!editable}
                onChange={(minute) =>
                  onReplace(index, { startMinute: w.startMinute, endMinute: minute })
                }
              />
              <button
                type="button"
                disabled={!editable}
                onClick={() => onRemove(index)}
                data-testid={`day-${day}-remove-${index}`}
                aria-label={copy.removeWindow(
                  name,
                  copy.windowRange(formatMinute(w.startMinute), formatMinute(w.endMinute)),
                )}
                className="flex-shrink-0 rounded-lg px-2 text-slate-500 disabled:opacity-50"
                style={{ minHeight: '44px', minWidth: '44px' }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={!editable || atCeiling}
            onClick={onAdd}
            data-testid={`day-add-${day}`}
            className="self-start rounded-lg border border-slate-300 px-3 text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
            style={{ minHeight: '44px', fontSize: '13px' }}
          >
            {copy.addWindow}
          </button>
        </div>
      ) : null}
    </li>
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

/** Whole hours where the week divides evenly, one decimal otherwise. "40" reads
 *  better than "40.0", and "37.5" has to stay exact. */
function formatHours(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/** First three letters is wrong for Arabic, where the names are short already
 *  and truncating produces nonsense. The full name is always the accessible
 *  name either way. */
function shortDay(name: string): string {
  return /^[\x20-\x7E]+$/.test(name) ? name.slice(0, 3) : name;
}

/**
 * The zone list for the disambiguation case.
 *
 * `Intl.supportedValuesOf` is the runtime's own IANA database, so there is no
 * second list to go stale. Guarded because it is newer than the baseline this
 * app supports; the fallback is the value already stored plus nothing, which
 * still lets a provider keep what they have rather than losing it to an empty
 * dropdown.
 */
function supportedTimezones(): string[] {
  try {
    const withValues = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    if (typeof withValues.supportedValuesOf === 'function') {
      return withValues.supportedValuesOf('timeZone');
    }
  } catch {
    // Falls through.
  }
  return [];
}

// ─── Container ──────────────────────────────────────────────────────────────

/** Loads the draft and renders Task 4. Mirrors the other V2 task containers. */
export function AvailabilityTask({ lang }: { lang: Lang }) {
  const draft = useOnboardingDraft();
  const copy = AVAILABILITY_COPY[lang];

  if (!draft.isFetched) {
    return (
      <div className="flex justify-center py-10" role="status" aria-live="polite">
        <span className="sr-only">{copy.heading}</span>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      </div>
    );
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
    return (
      <p
        className="break-words text-rose-600"
        style={{ fontSize: '13px' }}
        data-testid="availability-load-failed"
      >
        {copy.heading}
      </p>
    );
  }

  return <AvailabilityTaskScreen view={view} lang={lang} editable={view.editable} />;
}
