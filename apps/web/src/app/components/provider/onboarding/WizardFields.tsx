import type { ReactNode } from 'react';
import { AlertCircle, Check } from 'lucide-react';

// Sprint 8 — the field primitives the onboarding wizard is built from.
//
// Extracted so the nine step bodies read as forms rather than as walls of
// Tailwind, and so the ACCESSIBILITY contract is written once instead of nine
// times. Every input here gets:
//
//   - a real <label htmlFor>, so tapping the label focuses the field and a
//     screen reader announces what it is
//   - aria-invalid and aria-describedby wired to the error text, so the error
//     is announced when the field takes focus rather than only being visible
//   - a visible focus ring on plain `:focus`, not only `:focus-visible`.
//     `:focus-visible` is suppressed for PROGRAMMATIC focus when the last
//     input modality was a pointer — and this wizard moves focus
//     programmatically on every step change, so a focus-visible-only ring is
//     invisible at exactly the moment it matters most. Caught by the
//     real-browser suite; jsdom cannot see it.
//
// The visual language is the existing FixNow provider surface: rounded-2xl
// inputs, slate borders, blue-600 accents, dark: variants throughout, and
// logical properties (ps/pe, start/end) so RTL mirrors without a second
// stylesheet.

export function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="mb-4">
      <label
        htmlFor={id}
        className="block mb-1.5 text-slate-700 dark:text-slate-200"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        {label}
        {required ? (
          // aria-hidden because "required" is already announced from the
          // input's own attribute; the asterisk is decoration for sighted
          // users and would otherwise be read out as "star".
          <span aria-hidden className="text-red-500 ms-1">
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <p
          id={`${id}-hint`}
          className="mb-1.5 text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px', lineHeight: '1.5' }}
        >
          {hint}
        </p>
      ) : null}
      <div data-described-by={describedBy || undefined}>{children}</div>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-1.5 flex items-center gap-1.5 text-red-600 dark:text-red-400"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          <AlertCircle size={13} aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

const INPUT_CLASS =
  'w-full px-4 py-3 rounded-2xl border bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 ' +
  'placeholder:text-slate-400 outline-none transition-colors ' +
  'focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

export function TextField({
  id,
  label,
  hint,
  error,
  required,
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
  maxLength,
  inputMode,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: 'text' | 'tel' | 'url' | 'number' | 'date';
  maxLength?: number;
  inputMode?: 'text' | 'tel' | 'numeric' | 'url';
}) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <input
        id={id}
        type={type}
        value={value}
        maxLength={maxLength}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
          undefined
        }
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT_CLASS} ${
          error ? 'border-red-300 dark:border-red-800' : 'border-slate-200 dark:border-slate-700'
        }`}
        style={{ fontSize: '14px' }}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  id,
  label,
  hint,
  error,
  required,
  value,
  onChange,
  rows = 4,
  maxLength,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <textarea
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
          undefined
        }
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT_CLASS} resize-y ${
          error ? 'border-red-300 dark:border-red-800' : 'border-slate-200 dark:border-slate-700'
        }`}
        style={{ fontSize: '14px', lineHeight: '1.6' }}
      />
      {maxLength ? (
        // A live count rather than a silent truncation at the cap. Text
        // vanishing as you type is the worst way to learn about a limit.
        <p className="mt-1 text-end text-slate-400" style={{ fontSize: '11px' }} aria-live="polite">
          {value.length} / {maxLength}
        </p>
      ) : null}
    </FieldShell>
  );
}

/** A group of mutually exclusive choices.
 *
 *  A real radiogroup rather than a row of styled buttons: arrow keys move
 *  between options, the group announces itself as one control, and the
 *  selected value is readable without sight. */
export function ChoiceGroup<T extends string>({
  id,
  label,
  hint,
  error,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  value: T | null;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="mb-4" disabled={disabled}>
      <legend
        className="mb-1.5 text-slate-700 dark:text-slate-200"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        {label}
      </legend>
      {hint ? (
        <p
          id={`${id}-hint`}
          className="mb-2 text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px', lineHeight: '1.5' }}
        >
          {hint}
        </p>
      ) : null}
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="grid gap-2">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`w-full text-start px-4 py-3 rounded-2xl border transition-colors outline-none focus:ring-2 focus:ring-blue-500/40 ${
                selected
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
              }`}
            >
              <span className="flex items-center justify-between gap-3">
                <span>
                  <span
                    className="block text-slate-900 dark:text-slate-100"
                    style={{ fontSize: '14px', fontWeight: 700 }}
                  >
                    {option.label}
                  </span>
                  {option.hint ? (
                    <span
                      className="block mt-0.5 text-slate-500 dark:text-slate-400"
                      style={{ fontSize: '12px' }}
                    >
                      {option.hint}
                    </span>
                  ) : null}
                </span>
                {selected ? (
                  <Check size={18} className="text-blue-600 shrink-0" aria-hidden />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-1.5 flex items-center gap-1.5 text-red-600 dark:text-red-400"
          style={{ fontSize: '12px', fontWeight: 600 }}
        >
          <AlertCircle size={13} aria-hidden />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** A multi-select chip list. `aria-pressed` rather than `aria-checked`: these
 *  are toggles, not a single-choice group, and a screen reader should say
 *  "pressed" so the difference is audible. */
export function ChipToggles({
  legend,
  hint,
  options,
  selected,
  onToggle,
  disabled,
  emptyText,
}: {
  legend: string;
  hint?: string;
  options: { value: string; label: string; badge?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  return (
    <fieldset className="mb-4" disabled={disabled}>
      <legend
        className="mb-1.5 text-slate-700 dark:text-slate-200"
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        {legend}
      </legend>
      {hint ? (
        <p
          className="mb-2 text-slate-500 dark:text-slate-400"
          style={{ fontSize: '12px', lineHeight: '1.5' }}
        >
          {hint}
        </p>
      ) : null}
      {options.length === 0 ? (
        <p className="text-slate-400" style={{ fontSize: '13px' }}>
          {emptyText}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const on = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(option.value)}
                className={`px-3.5 py-2 rounded-full border transition-colors outline-none focus:ring-2 focus:ring-blue-500/40 ${
                  on
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {option.label}
                {option.badge ? (
                  <span
                    className={`ms-2 px-1.5 py-0.5 rounded-full ${
                      on ? 'bg-white/20' : 'bg-amber-100 text-amber-700'
                    }`}
                    style={{ fontSize: '10px', fontWeight: 700 }}
                  >
                    {option.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
