import { Check } from 'lucide-react';
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { ProviderCard } from './primitives';

// Provider form primitives (Mode B).
//
// Every field wires label, help and error together with real ids. The
// baseline's screens each built this by hand, which is why some fields
// announced their error and some only turned red.

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  requiredLabel?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * Label, control, help, error — associated, not merely adjacent.
 *
 * `aria-describedby` points at help AND error, so a screen-reader user hears
 * the requirement and the failure. `aria-invalid` marks the control itself,
 * because a red border is not a state any assistive technology can read.
 */
export function ProviderField({
  label,
  hint,
  error,
  required,
  requiredLabel,
  children,
}: FieldShellProps) {
  const base = useId();
  const id = `${base}-input`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    // `.hsm-field`: a 7px column. Not `gap-1.5` (6px) — one pixel per field,
    // three fields to a screen, and the accumulated error lands on whatever is
    // at the bottom of the longest form.
    <div className="flex flex-col gap-[7px]">
      <label
        htmlFor={id}
        // `leading-[21px]` explicitly: the base layer gives every `label` a 1.5
        // RATIO, which at 13px is 19.5px and silently undoes the 21px line box
        // the approved screens inherit. A utility beats the base layer; an
        // inherited value does not.
        className="flex items-center gap-1.5 text-pv-label font-bold leading-[21px] text-pv-text"
      >
        {label}
        {required === false && requiredLabel ? (
          <span className="text-pv-caption font-medium text-pv-muted">{requiredLabel}</span>
        ) : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} className="text-pv-label font-medium text-pv-danger">
          {error}
        </p>
      ) : hint ? (
        // `.hsm-help`: 12px at 1.6, one of the few places the approved design
        // overrides the 21px base line box.
        <p id={hintId} className="text-pv-help leading-[1.6] text-pv-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  // `.hsm-field input`: 48px tall, 12px/13px padding, a 10px radius, 16px text.
  //
  // The 16px is not a style choice at either end — anything smaller makes iOS
  // Safari zoom the viewport on focus, which leaves the provider scrolled
  // sideways on a form they were halfway through.
  //
  // The height is a MINIMUM so a control that wraps still grows, and 48 is the
  // number the approved screens measure: at 46px every input sat two pixels
  // short and everything below it drifted.
  //
  // No `md:` step down any more. Onboarding is a focused column at every
  // width, so a desktop viewport is not a reason for a different control size.
  'w-full min-h-12 rounded-pv-control border bg-pv-surface px-[13px] py-3 text-pv-input leading-[21px] text-pv-text placeholder:text-pv-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pv-accent disabled:bg-pv-surface-sunken disabled:text-pv-muted';

export function ProviderTextInput({
  label,
  hint,
  error,
  required,
  requiredLabel,
  className = '',
  ...rest
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  requiredLabel?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <ProviderField
      label={label}
      hint={hint}
      error={error}
      required={required}
      requiredLabel={requiredLabel}
    >
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          // MERGED, not spread over.
          //
          // `className` used to arrive through `...rest` and land AFTER this
          // attribute, so a caller who added one padding utility silently
          // replaced the entire control style — border, height, radius, type
          // size and all. The search field on the approved services screen lost
          // its box that way and rendered as bare text on the page background.
          className={`${CONTROL} ${invalid ? 'border-pv-danger' : 'border-pv-border-strong'} ${className}`}
          {...rest}
        />
      )}
    </ProviderField>
  );
}

export function ProviderTextArea({
  label,
  hint,
  error,
  required,
  requiredLabel,
  className = '',
  ...rest
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  requiredLabel?: string;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <ProviderField
      label={label}
      hint={hint}
      error={error}
      required={required}
      requiredLabel={requiredLabel}
    >
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={`${CONTROL} min-h-[120px] resize-y ${invalid ? 'border-pv-danger' : 'border-pv-border-strong'} ${className}`}
          {...rest}
        />
      )}
    </ProviderField>
  );
}

/**
 * A large, tappable choice.
 *
 * A real radio input drives it, so keyboard selection, grouping and screen
 * reader semantics come from the platform rather than from click handlers on a
 * div — which is what the baseline's provider-type cards did.
 */
export function ProviderChoiceCard({
  name,
  value,
  checked,
  onSelect,
  title,
  description,
  disabled,
  testId,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label
      data-testid={testId}
      className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
        checked
          ? 'border-pv-accent bg-pv-accent-subtle'
          : 'border-pv-border bg-pv-surface hover:border-pv-border-strong'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-pv-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
      />
      <span className="min-w-0">
        <span className="block text-pv-heading font-semibold text-pv-text">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-pv-label text-pv-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * A multi-select choice row — the approved `.hsm-choice`.
 *
 * WHY IT IS NOT `ProviderChoiceCard`
 *
 * That one is a RADIO, and radios are exclusive. Three of the approved screens
 * ask questions that are genuinely not: which services do you offer, how do
 * you reach customers, which days do you work. The reference marks both "Car"
 * and "Public transport" selected on the same screen, and a radio group cannot
 * express that without lying about it to a screen reader.
 *
 * WHY A CHECKBOX INPUT RATHER THAN THE REFERENCE'S `aria-pressed` BUTTON
 *
 * The prototype draws a `<button aria-pressed>`. A real checkbox is the same
 * picture with better semantics: Space toggles it, it is announced as "checked"
 * rather than "pressed", and it participates in a group the platform already
 * understands. `aria-pressed` on a button means "this control is active", which
 * is a statement about the control; `aria-checked` means "this option is
 * chosen", which is the statement actually being made.
 *
 * The input is `sr-only` rather than `hidden`, so it stays focusable and the
 * visible box is driven from it with `peer-*`.
 */
export function ProviderChoiceToggle({
  checked,
  onToggle,
  label,
  meta,
  disabled,
  testId,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  /** The trailing note — "Primary", "15 km range". */
  meta?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label
      data-testid={testId}
      data-checked={checked}
      className={`grid min-h-[52px] w-full cursor-pointer grid-cols-[24px_1fr_auto] items-center gap-2.5 rounded-pv-choice border px-3 py-2.5 text-start ${
        checked ? 'border-pv-accent bg-pv-accent-subtle' : 'border-pv-border-strong bg-pv-surface'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      {/* `.hsm-check`: a 20px box in a 24px column, 1.5px border, 6px radius.
          The focus ring lives HERE rather than on the label, because the label
          is the whole 52px row and a ring around all of it reads as a section
          boundary rather than as focus. */}
      <span
        aria-hidden="true"
        className={`grid h-5 w-5 place-items-center rounded-sm border-[1.5px] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-pv-accent ${
          checked ? 'border-pv-accent bg-pv-accent text-white' : 'border-pv-border-strong'
        }`}
      >
        {checked ? <Check size={14} strokeWidth={1.8} /> : null}
      </span>

      {/* 14px at weight 500 — `.hsm-choice strong` declares only the size and
          takes the wrapper's medium weight, like every other `strong` in the
          approved screens. `font-medium` is explicit because a `<label>` gets
          500 from the base layer and a nested span would otherwise inherit it
          by accident rather than by decision. */}
      <span className="min-w-0 break-words text-pv-body font-medium text-pv-text">{label}</span>

      {/* `.hsm-choice small` — 11px muted on a 16px line box, the `<small>`
          default the approved design inherits. */}
      {meta ? (
        <span className="whitespace-nowrap text-pv-caption font-normal leading-4 text-pv-muted">
          {meta}
        </span>
      ) : null}
    </label>
  );
}

export interface SummaryError {
  /** Anchor to the field. */
  id: string;
  message: string;
}

/**
 * The error summary.
 *
 * On a failed save or submit this is what receives focus and what a screen
 * reader announces. Scattered red text below individual fields — the
 * baseline's only error treatment — leaves someone who cannot see the form no
 * way to find out what went wrong, or how many things did.
 */
export function ProviderErrorSummary({
  title,
  errors,
  onSelect,
}: {
  title: string;
  errors: readonly SummaryError[];
  onSelect?: (id: string) => void;
}) {
  if (errors.length === 0) return null;
  return (
    <ProviderCard
      className="border-pv-danger-border bg-pv-danger-bg p-4"
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
      data-testid="provider-error-summary"
    >
      <p className="text-pv-body font-semibold text-pv-danger">{title}</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 ps-5">
        {errors.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onSelect?.(e.id)}
              className="text-start text-pv-label font-medium text-pv-danger underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
            >
              {e.message}
            </button>
          </li>
        ))}
      </ul>
    </ProviderCard>
  );
}

/**
 * A numeric stepper: minus, the value, plus.
 *
 * The approved experience screen asks for years with `−` and `+` rather than a
 * free numeric field, and the reason is in its own help text: it avoids typing
 * errors. A text input invites "14 years", "fourteen", a stray keypress that
 * turns 14 into 144, and a phone keyboard that opens over the field.
 *
 * ACCESSIBILITY DECISIONS WORTH NAMING
 *
 *   `<output>`        the value is a live RESULT of the two buttons, so it is
 *                     announced when it changes without a second live region.
 *   real buttons      each with its own accessible name, so a screen-reader
 *                     user hears "decrease"/"increase" rather than "button".
 *   group labelling   the whole control is one labelled group, so the value is
 *                     never read as a bare number with no subject.
 *   bounds on the     a button that cannot do anything is `disabled`, which is
 *   buttons           both announced and unfocusable — better than a press
 *                     that silently does nothing.
 *
 * Both buttons are 44x44, which is the mandated minimum target and also what
 * makes them usable one-handed.
 */
export function ProviderStepper({
  label,
  hint,
  value,
  min = 0,
  max = 99,
  step = 1,
  decreaseLabel,
  increaseLabel,
  onChange,
  disabled = false,
  testId,
  formatValue,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (next: number) => void;
  disabled?: boolean;
  testId?: string;
  /** Renders the number for display — units, or a locale's digits. */
  formatValue?: (value: number) => string;
}) {
  const base = useId();
  const labelId = `${base}-label`;
  const hintId = `${base}-hint`;

  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const atMin = value <= min;
  const atMax = value >= max;

  // 48px square with the control radius, as the approved screen draws it —
  // comfortably past the 44px minimum target rather than exactly on it.
  const BUTTON =
    'grid h-12 w-12 shrink-0 place-items-center rounded-pv-control border border-pv-border-strong bg-pv-surface text-pv-display font-semibold text-pv-text disabled:text-pv-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pv-accent';

  return (
    // `.hsm-field`: 7px, the same column the text fields use. At `gap-1.5`
    // (6px) the two gaps here cost 2px, and everything below the stepper on
    // the experience screen sat 2px high because of it.
    <div className="flex flex-col gap-[7px]">
      <span id={labelId} className="text-pv-label font-bold leading-[21px] text-pv-text">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        // `.hsm-stepper`: a `48px 1fr 48px` grid, not a flex row. The value
        // sits in the MIDDLE of the field rather than next to the minus, which
        // is what makes the two buttons read as a matched pair at the two ends
        // of one control instead of a cluster with a number after it.
        className="grid grid-cols-[48px_1fr_48px] items-center gap-2.5"
        data-testid={testId}
      >
        <button
          type="button"
          className={BUTTON}
          aria-label={decreaseLabel}
          disabled={disabled || atMin}
          onClick={() => onChange(clamp(value - step))}
          data-testid={testId ? `${testId}-decrease` : undefined}
        >
          −
        </button>
        <output
          className="text-center text-pv-display font-bold tabular-nums text-pv-text"
          data-testid={testId ? `${testId}-value` : undefined}
        >
          {formatValue ? formatValue(value) : value}
        </output>
        <button
          type="button"
          className={BUTTON}
          aria-label={increaseLabel}
          disabled={disabled || atMax}
          onClick={() => onChange(clamp(value + step))}
          data-testid={testId ? `${testId}-increase` : undefined}
        >
          +
        </button>
      </div>
      {hint ? (
        // `.hsm-help` again: 12px at 1.6, not the 13px label size.
        <p id={hintId} className="text-pv-help leading-[1.6] text-pv-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
