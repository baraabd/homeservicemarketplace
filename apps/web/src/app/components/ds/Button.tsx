import { ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
export type ButtonVariant = "primary" | "secondary" | "text";
export type ButtonState   = "default" | "disabled" | "loading";
export type ButtonSize    = "sm" | "md" | "lg";

export interface ButtonProps {
  variant?:   ButtonVariant;
  state?:     ButtonState;
  size?:      ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  children:   ReactNode;
  onClick?:   () => void;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ white }: { white: boolean }) {
  return (
    <span
      className="inline-block w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0"
      style={{
        borderColor: white ? "rgba(255,255,255,0.35)" : "rgba(245,158,11,0.3)",
        borderTopColor: white ? "#ffffff" : "#F59E0B",
      }}
    />
  );
}

// ─── Button ───────────────────────────────────────────────────────────────────
export function Button({
  variant   = "primary",
  state     = "default",
  size      = "md",
  fullWidth = false,
  leadingIcon,
  children,
  onClick,
}: ButtonProps) {
  const disabled  = state === "disabled";
  const loading   = state === "loading";

  // 4-px grid: sm=32px, md=48px, lg=56px height
  const sizes: Record<ButtonSize, string> = {
    sm: "h-8  px-4  gap-1.5 rounded-xl  text-xs",
    md: "h-12 px-6  gap-2   rounded-2xl text-sm",
    lg: "h-14 px-8  gap-2.5 rounded-2xl text-base",
  };

  const variants: Record<ButtonVariant, Record<ButtonState, string>> = {
    primary: {
      default:  "bg-amber-500 text-white shadow-md shadow-amber-200 hover:bg-amber-600 active:scale-95 active:shadow-sm",
      disabled: "bg-slate-200 text-slate-400",
      loading:  "bg-amber-400 text-white cursor-not-allowed",
    },
    secondary: {
      default:  "border-2 border-amber-500 text-amber-600 bg-white hover:bg-amber-50 active:scale-95",
      disabled: "border-2 border-slate-200 text-slate-400 bg-white",
      loading:  "border-2 border-amber-300 text-amber-400 bg-white cursor-not-allowed",
    },
    text: {
      default:  "text-amber-600 hover:bg-amber-50 active:scale-95",
      disabled: "text-slate-400",
      loading:  "text-amber-400 cursor-not-allowed",
    },
  };

  return (
    <button
      disabled={disabled || loading}
      onClick={onClick}
      className={[
        "inline-flex items-center justify-center font-semibold transition-all duration-150 select-none",
        sizes[size],
        variants[variant][state],
        fullWidth ? "w-full" : "",
        disabled ? "cursor-not-allowed" : "",
      ].join(" ")}
    >
      {loading && <Spinner white={variant === "primary"} />}
      {!loading && leadingIcon && <span className="flex-shrink-0">{leadingIcon}</span>}
      <span>{loading ? (variant === "text" ? "Loading…" : "Please wait…") : children}</span>
    </button>
  );
}

// ─── Icon Button ──────────────────────────────────────────────────────────────
export type IconButtonVariant = "primary" | "secondary" | "ghost";

export interface IconButtonProps {
  icon:      ReactNode;
  variant?:  IconButtonVariant;
  state?:    ButtonState;
  size?:     ButtonSize;
  label?:    string;
  onClick?:  () => void;
}

export function IconButton({
  icon,
  variant  = "primary",
  state    = "default",
  size     = "md",
  label,
  onClick,
}: IconButtonProps) {
  const disabled = state === "disabled";
  const loading  = state === "loading";

  const sizes: Record<ButtonSize, string> = {
    sm: "w-8  h-8  rounded-xl",
    md: "w-11 h-11 rounded-2xl",
    lg: "w-14 h-14 rounded-2xl",
  };

  const variants: Record<IconButtonVariant, Record<ButtonState, string>> = {
    primary: {
      default:  "bg-amber-500 text-white shadow-sm shadow-amber-200 hover:bg-amber-600 active:scale-90",
      disabled: "bg-slate-200 text-slate-400 cursor-not-allowed",
      loading:  "bg-amber-400 text-white cursor-not-allowed",
    },
    secondary: {
      default:  "border-2 border-amber-500 text-amber-600 bg-white hover:bg-amber-50 active:scale-90",
      disabled: "border-2 border-slate-200 text-slate-400 bg-white cursor-not-allowed",
      loading:  "border-2 border-amber-300 text-amber-400 bg-white cursor-not-allowed",
    },
    ghost: {
      default:  "bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-90",
      disabled: "bg-slate-50 text-slate-300 cursor-not-allowed",
      loading:  "bg-slate-100 text-slate-400 cursor-not-allowed",
    },
  };

  return (
    <button
      disabled={disabled || loading}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        "flex items-center justify-center transition-all duration-150 flex-shrink-0",
        sizes[size],
        variants[variant][state],
      ].join(" ")}
    >
      {loading ? (
        <span
          className="w-4 h-4 rounded-full border-2 animate-spin"
          style={{
            borderColor: variant === "primary" ? "rgba(255,255,255,0.3)" : "rgba(245,158,11,0.3)",
            borderTopColor: variant === "primary" ? "#fff" : "#F59E0B",
          }}
        />
      ) : (
        icon
      )}
    </button>
  );
}
