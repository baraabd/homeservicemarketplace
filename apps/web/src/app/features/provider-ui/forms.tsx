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
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-[13px] font-semibold text-pv-text"
      >
        {label}
        {required === false && requiredLabel ? (
          <span className="text-[11px] font-medium text-pv-muted">{requiredLabel}</span>
        ) : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} className="text-[13px] font-medium text-pv-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[13px] text-pv-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  // 16px on touch: anything smaller makes iOS Safari zoom the viewport on
  // focus, which then leaves the provider scrolled sideways on a form.
  'w-full rounded-lg border bg-pv-surface px-3 py-2.5 text-[16px] text-pv-text placeholder:text-pv-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pv-accent disabled:bg-pv-surface-sunken disabled:text-pv-muted md:text-[15px]';

export function ProviderTextInput({
  label,
  hint,
  error,
  required,
  requiredLabel,
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
          className={`${CONTROL} ${invalid ? 'border-pv-danger' : 'border-pv-border-strong'}`}
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
          className={`${CONTROL} min-h-[120px] resize-y ${invalid ? 'border-pv-danger' : 'border-pv-border-strong'}`}
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
        <span className="block text-[15px] font-semibold text-pv-text">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-[13px] text-pv-muted">{description}</span>
        ) : null}
      </span>
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
      <p className="text-[14px] font-semibold text-pv-danger">{title}</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 ps-5">
        {errors.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onSelect?.(e.id)}
              className="text-start text-[13px] font-medium text-pv-danger underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
            >
              {e.message}
            </button>
          </li>
        ))}
      </ul>
    </ProviderCard>
  );
}
