import { useEffect, useMemo, useState } from 'react';

// Phase 4 Feature 3 — accessible "Schedule Later" time picker.
//
// Replaces the native `<input type="time">` (a tiny tap target with
// inconsistent platform UI) with a two-stage segmented selector:
//
//   1. Time of Day  — Morning / Afternoon / Evening (large pill row).
//      The picker keeps its OWN segment state so the user can browse
//      slots inside a segment without having to first pick one — this
//      decouples "I want morning slots visible" from "I have committed
//      to a specific time."
//   2. 15-min slots — pill buttons for every quarter-hour inside the
//      currently visible segment, e.g. Morning → 06:00, 06:15, …, 11:45.
//      Tapping a pill is what calls `onChange(value)`.
//
// The wire output is a stable `HH:MM` string, identical to what the
// native input emitted, so nothing downstream of this picker has to
// change (combineLocalDateTimeToIso, the post-form payload, etc.).

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

interface SegmentSpec {
  id: TimeOfDay;
  /** Inclusive lower bound, hour-of-day. */
  startHour: number;
  /** Exclusive upper bound, hour-of-day. */
  endHour: number;
}

const SEGMENTS: readonly SegmentSpec[] = [
  // Morning: 06:00 → 11:45 inclusive (slots stop one quarter before noon).
  { id: 'morning', startHour: 6, endHour: 12 },
  // Afternoon: 12:00 → 17:45.
  { id: 'afternoon', startHour: 12, endHour: 18 },
  // Evening: 18:00 → 21:45.
  { id: 'evening', startHour: 18, endHour: 22 },
];

/** Map an HH:MM string to the segment that contains it. Returns null
 *  for values outside any segment (the picker then falls back to no
 *  segment selected). */
export function segmentForTime(hhmm: string): TimeOfDay | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  for (const seg of SEGMENTS) {
    if (h >= seg.startHour && h < seg.endHour) return seg.id;
  }
  return null;
}

/** Generate every 15-minute slot inside a segment. Pure — used both
 *  at render time and by the unit test. */
export function slotsForSegment(seg: TimeOfDay): string[] {
  const spec = SEGMENTS.find((s) => s.id === seg);
  if (!spec) return [];
  const out: string[] = [];
  for (let h = spec.startHour; h < spec.endHour; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return out;
}

export interface SegmentedTimePickerProps {
  /** HH:MM string. Empty string means "nothing picked yet". */
  value: string;
  onChange(next: string): void;
  /** Localised labels for the segment buttons. Keep the keys stable
   *  so RTL flips happen via CSS, not via reordering. */
  labels: { timeOfDay: string; morning: string; afternoon: string; evening: string };
}

export function SegmentedTimePicker({ value, onChange, labels }: SegmentedTimePickerProps) {
  // Local state for the visible segment. Initialised from the current
  // `value` so a programmatic update reflecting an existing pick (e.g.
  // restoring from a draft) opens the right segment automatically.
  const [visibleSegment, setVisibleSegment] = useState<TimeOfDay | null>(() =>
    segmentForTime(value),
  );

  // Keep visibleSegment honest if `value` changes externally (e.g. the
  // parent resets to '' on form clear, or pre-fills with a saved time).
  useEffect(() => {
    const fromValue = segmentForTime(value);
    if (fromValue && fromValue !== visibleSegment) {
      setVisibleSegment(fromValue);
    }
    // Intentionally not including `visibleSegment` in deps — that would
    // cause a no-op self-loop after the user expands a segment without
    // picking a slot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const slots = useMemo(
    () => (visibleSegment ? slotsForSegment(visibleSegment) : []),
    [visibleSegment],
  );

  return (
    <div>
      {/* Stage 1 — Time of Day */}
      <p
        className="text-slate-500 mb-2"
        style={{
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {labels.timeOfDay}
      </p>
      <div role="radiogroup" aria-label={labels.timeOfDay} className="grid grid-cols-3 gap-2 mb-3">
        {SEGMENTS.map((seg) => {
          const id = seg.id;
          const segLabel = labels[id];
          const isVisible = visibleSegment === id;
          // The segment is "selected" (filled) only when the picker's
          // committed value lives inside it.
          const isCommitted = segmentForTime(value) === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={isCommitted}
              data-testid={`time-segment-${id}`}
              onClick={() => {
                setVisibleSegment(id);
                // If the committed value lived in a different segment,
                // clear it — the user has changed intent and shouldn't
                // see a stale Afternoon pill highlighted while browsing
                // Morning slots.
                if (segmentForTime(value) !== id && value !== '') onChange('');
              }}
              className={[
                'rounded-xl px-3 py-2.5 border-2 transition-all active:scale-95',
                isVisible
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
              ].join(' ')}
              style={{ fontSize: '13px', fontWeight: 700 }}
            >
              {segLabel}
            </button>
          );
        })}
      </div>

      {/* Stage 2 — 15-minute slot pills (only after a segment is picked) */}
      {visibleSegment && (
        <div role="radiogroup" aria-label={labels.timeOfDay} className="flex flex-wrap gap-1.5">
          {slots.map((slot) => {
            const isActive = value === slot;
            return (
              <button
                key={slot}
                type="button"
                role="radio"
                aria-checked={isActive}
                data-testid={`time-slot-${slot}`}
                onClick={() => onChange(slot)}
                className={[
                  'rounded-full px-3 py-1.5 border transition-all active:scale-95',
                  isActive
                    ? 'border-amber-500 bg-amber-500 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300',
                ].join(' ')}
                style={{ fontSize: '12px', fontWeight: 600 }}
              >
                {slot}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
