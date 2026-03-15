import { useState, useRef, ReactNode } from "react";

export interface TextFieldProps {
  label:         string;
  type?:         string;
  error?:        string;
  hint?:         string;
  value?:        string;
  defaultValue?: string;
  onChange?:     (val: string) => void;
  leadingIcon?:  ReactNode;
  trailingIcon?: ReactNode;
  disabled?:     boolean;
  placeholder?:  string;
}

export function TextField({
  label,
  type         = "text",
  error,
  hint,
  value:       controlledValue,
  defaultValue = "",
  onChange,
  leadingIcon,
  trailingIcon,
  disabled     = false,
  placeholder,
}: TextFieldProps) {
  const [localValue, setLocalValue] = useState(defaultValue);
  const [focused,    setFocused]    = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const value    = controlledValue ?? localValue;
  const hasValue = value.length > 0;
  const floated  = focused || hasValue;
  const hasError = !!error;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (onChange) onChange(v);
    else setLocalValue(v);
  };

  // ── Border colour ────────────────────────────────────────────────────────
  const borderClass = hasError
    ? "border-red-500 ring-4 ring-red-100"
    : focused
    ? "border-amber-500 ring-4 ring-amber-50"
    : disabled
    ? "border-slate-100"
    : "border-slate-200 hover:border-slate-300";

  const bgClass = hasError ? "bg-red-50/30" : disabled ? "bg-slate-50" : "bg-white";

  const labelColor = hasError
    ? "text-red-500"
    : focused
    ? "text-amber-500"
    : "text-slate-400";

  const padStart = leadingIcon ? "ps-11" : "ps-4";
  const padEnd   = trailingIcon ? "pe-11" : "pe-4";

  return (
    <div className="w-full">
      {/* ── Field shell ── */}
      <div
        className={[
          "relative border-2 rounded-2xl transition-all duration-200 cursor-text",
          borderClass,
          bgClass,
        ].join(" ")}
        onClick={() => !disabled && inputRef.current?.focus()}
      >
        {/* Leading icon */}
        {leadingIcon && (
          <span
            className={[
              "absolute start-4 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200",
              hasError ? "text-red-400" : focused ? "text-amber-500" : "text-slate-400",
            ].join(" ")}
          >
            {leadingIcon}
          </span>
        )}

        {/* Floating label */}
        <label
          className={[
            "absolute pointer-events-none select-none transition-all duration-200",
            labelColor,
            leadingIcon ? "start-11" : "start-4",
          ].join(" ")}
          style={{
            top:        floated ? "8px"              : "50%",
            transform:  floated ? "translateY(0)"    : "translateY(-50%)",
            fontSize:   floated ? "11px"             : "14px",
            fontWeight: floated ? 600                : 400,
            lineHeight: "1.2",
          }}
        >
          {label}
        </label>

        {/* Input */}
        <input
          ref={inputRef}
          type={type}
          value={value}
          placeholder={floated ? placeholder : undefined}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          className={[
            "w-full bg-transparent outline-none text-slate-900 pt-6 pb-2.5",
            padStart,
            padEnd,
            "disabled:cursor-not-allowed disabled:text-slate-400",
          ].join(" ")}
          style={{ fontSize: "14px", lineHeight: "1.5" }}
        />

        {/* Trailing icon */}
        {trailingIcon && (
          <span
            className={[
              "absolute end-4 top-1/2 -translate-y-1/2 transition-colors duration-200",
              hasError ? "text-red-400" : focused ? "text-amber-500" : "text-slate-400",
            ].join(" ")}
          >
            {trailingIcon}
          </span>
        )}
      </div>

      {/* ── Helper / Error text ── */}
      {(error || hint) && (
        <p
          className={[
            "flex items-start gap-1.5 mt-1.5 px-1",
            error ? "text-red-500" : "text-slate-400",
          ].join(" ")}
          style={{ fontSize: "12px", lineHeight: "1.5" }}
        >
          {error && (
            <svg
              width="13" height="13"
              viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              className="flex-shrink-0 mt-px"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
          )}
          {hint && !error && (
            <svg
              width="13" height="13"
              viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
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