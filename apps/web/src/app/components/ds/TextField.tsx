import { useState, useRef, useLayoutEffect, ReactNode } from 'react';

export interface TextFieldProps {
  label: string;
  type?: string;
  error?: string;
  hint?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (val: string) => void;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Phase 1 Bug 2 — render a self-growing <textarea> instead of a
   * single-line <input>. Used for free-form descriptions (job-posting
   * "Additional notes", profile bio, etc.). The field starts at
   * `minRows` lines and grows up to `maxRows` lines as the user types,
   * after which it scrolls vertically inside the textarea. All other
   * styling (floating label, leading icon, theme colours) is identical
   * to the single-line variant so the visual rhythm of a form stays
   * consistent.
   */
  multiline?: boolean;
  /** Initial / minimum visible lines. Defaults to 3 when multiline is on. */
  minRows?: number;
  /** Cap auto-grow at this many lines; the textarea then scrolls. Default 10. */
  maxRows?: number;
}

export function TextField({
  label,
  type = 'text',
  error,
  hint,
  value: controlledValue,
  defaultValue = '',
  onChange,
  leadingIcon,
  trailingIcon,
  disabled = false,
  placeholder,
  multiline = false,
  minRows = 3,
  maxRows = 10,
}: TextFieldProps) {
  const [localValue, setLocalValue] = useState(defaultValue);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const value = controlledValue ?? localValue;
  const hasValue = value.length > 0;
  const floated = focused || hasValue;
  const hasError = !!error;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (onChange) onChange(v);
    else setLocalValue(v);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    if (onChange) onChange(v);
    else setLocalValue(v);
  };

  // Auto-grow the textarea on every render where `value` changed, capped
  // at `maxRows * lineHeight`. Uses scrollHeight so the height matches
  // the rendered content exactly, with no manual measurement of fonts.
  useLayoutEffect(() => {
    if (!multiline) return;
    const el = textareaRef.current;
    if (!el) return;
    // Reset to a minimal height so scrollHeight reflects the content
    // rather than the previous (larger) height.
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '20') || 20;
    const max = lineHeight * maxRows;
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    // Above the cap → enable internal scroll; otherwise clip overflow.
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [multiline, value, maxRows]);

  // ── Border colour ────────────────────────────────────────────────────────
  const borderClass = hasError
    ? 'border-red-500 ring-4 ring-red-100'
    : focused
      ? 'border-amber-500 ring-4 ring-amber-50'
      : disabled
        ? 'border-slate-100'
        : 'border-slate-200 hover:border-slate-300';

  const bgClass = hasError ? 'bg-red-50/30' : disabled ? 'bg-slate-50' : 'bg-white';

  const labelColor = hasError ? 'text-red-500' : focused ? 'text-amber-500' : 'text-slate-400';

  const padStart = leadingIcon ? 'ps-11' : 'ps-4';
  const padEnd = trailingIcon ? 'pe-11' : 'pe-4';

  // The leading icon centers vertically on a single-line field. On a
  // multiline field, vertically centering against a growing textarea
  // would visually drift; pin it near the top so the icon sits next
  // to the first line regardless of the field's height.
  const leadingIconPosition = multiline
    ? 'top-[1.25rem]' // matches pt-6 baseline of the textarea
    : 'top-1/2 -translate-y-1/2';

  return (
    <div className="w-full">
      {/* ── Field shell ── */}
      <div
        className={[
          'relative border-2 rounded-2xl transition-all duration-200 cursor-text',
          borderClass,
          bgClass,
        ].join(' ')}
        onClick={() => {
          if (disabled) return;
          if (multiline) textareaRef.current?.focus();
          else inputRef.current?.focus();
        }}
      >
        {/* Leading icon */}
        {leadingIcon && (
          <span
            className={[
              'absolute start-4 pointer-events-none transition-colors duration-200',
              leadingIconPosition,
              hasError ? 'text-red-400' : focused ? 'text-amber-500' : 'text-slate-400',
            ].join(' ')}
          >
            {leadingIcon}
          </span>
        )}

        {/* Floating label */}
        <label
          className={[
            'absolute pointer-events-none select-none transition-all duration-200',
            labelColor,
            leadingIcon ? 'start-11' : 'start-4',
          ].join(' ')}
          style={{
            // Multiline: pin the label against the top edge of the
            // shell (so it doesn't slide down into the growing
            // textarea). Single-line: keep the original vertical-
            // center default.
            top: floated ? '8px' : multiline ? '1.25rem' : '50%',
            transform: floated ? 'translateY(0)' : multiline ? 'translateY(0)' : 'translateY(-50%)',
            fontSize: floated ? '11px' : '14px',
            fontWeight: floated ? 600 : 400,
            lineHeight: '1.2',
          }}
        >
          {label}
        </label>

        {/* Input — single-line OR autosizing textarea */}
        {multiline ? (
          <textarea
            ref={textareaRef}
            value={value}
            placeholder={floated ? placeholder : undefined}
            onChange={handleTextareaChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            rows={minRows}
            className={[
              'w-full bg-transparent outline-none text-slate-900 pt-6 pb-2.5 resize-none',
              padStart,
              padEnd,
              'disabled:cursor-not-allowed disabled:text-slate-400',
            ].join(' ')}
            style={{ fontSize: '14px', lineHeight: '1.5' }}
          />
        ) : (
          <input
            ref={inputRef}
            type={type}
            value={value}
            placeholder={floated ? placeholder : undefined}
            onChange={handleInputChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            className={[
              'w-full bg-transparent outline-none text-slate-900 pt-6 pb-2.5',
              padStart,
              padEnd,
              'disabled:cursor-not-allowed disabled:text-slate-400',
            ].join(' ')}
            style={{ fontSize: '14px', lineHeight: '1.5' }}
          />
        )}

        {/* Trailing icon — single-line only; on a textarea it would
            visually float past the growing content. */}
        {trailingIcon && !multiline && (
          <span
            className={[
              'absolute end-4 top-1/2 -translate-y-1/2 transition-colors duration-200',
              hasError ? 'text-red-400' : focused ? 'text-amber-500' : 'text-slate-400',
            ].join(' ')}
          >
            {trailingIcon}
          </span>
        )}
      </div>

      {/* ── Helper / Error text ── */}
      {(error || hint) && (
        <p
          className={[
            'flex items-start gap-1.5 mt-1.5 px-1',
            error ? 'text-red-500' : 'text-slate-400',
          ].join(' ')}
          style={{ fontSize: '12px', lineHeight: '1.5' }}
        >
          {error && (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0 mt-px"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
          )}
          {hint && !error && (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0 mt-px"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <circle cx="12" cy="8" r="0.5" fill="currentColor" />
            </svg>
          )}
          {error || hint}
        </p>
      )}
    </div>
  );
}
