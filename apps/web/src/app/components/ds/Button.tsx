import { ReactNode } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
export type ButtonVariant = 'primary' | 'secondary' | 'text';
export type ButtonState = 'default' | 'disabled' | 'loading';
export type ButtonSize = 'sm' | 'md' | 'lg';
// Sprint 5.1.1 patch 2: tone drives the accent palette so an
// experience-themed auth surface (Provider blue, Admin slate) doesn't
// have to fork the Button component. `seeker` is the historical orange
// default — every existing call site keeps its visual identity.
export type ButtonTone = 'seeker' | 'provider' | 'admin';

export interface ButtonProps {
  variant?: ButtonVariant;
  state?: ButtonState;
  size?: ButtonSize;
  tone?: ButtonTone;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
const TONE_SPINNER_HEX: Record<ButtonTone, string> = {
  seeker: '#F59E0B',
  provider: '#4F46E5',
  admin: '#475569',
};
const TONE_SPINNER_RGBA: Record<ButtonTone, string> = {
  seeker: 'rgba(245,158,11,0.3)',
  provider: 'rgba(79,70,229,0.3)',
  admin: 'rgba(71,85,105,0.3)',
};

function Spinner({ white, tone }: { white: boolean; tone: ButtonTone }) {
  return (
    <span
      className="inline-block w-4 h-4 rounded-full border-2 animate-spin flex-shrink-0"
      style={{
        borderColor: white ? 'rgba(255,255,255,0.35)' : TONE_SPINNER_RGBA[tone],
        borderTopColor: white ? '#ffffff' : TONE_SPINNER_HEX[tone],
      }}
    />
  );
}

// Per-tone class strings. Seeker preserves the historical amber palette
// byte-for-byte so every non-auth call site is unchanged. Provider and
// Admin mirror the gradients used on the AppSelector cards + Slice 5.1
// Provider profile shell so the visual identity is consistent end to
// end.
const TONE_VARIANTS: Record<ButtonTone, Record<ButtonVariant, Record<ButtonState, string>>> = {
  seeker: {
    primary: {
      default:
        'bg-amber-500 text-white shadow-md shadow-amber-200 hover:bg-amber-600 active:scale-95 active:shadow-sm',
      disabled: 'bg-slate-200 text-slate-400',
      loading: 'bg-amber-400 text-white cursor-not-allowed',
    },
    secondary: {
      default:
        'border-2 border-amber-500 text-amber-600 bg-white hover:bg-amber-50 active:scale-95',
      disabled: 'border-2 border-slate-200 text-slate-400 bg-white',
      loading: 'border-2 border-amber-300 text-amber-400 bg-white cursor-not-allowed',
    },
    text: {
      default: 'text-amber-600 hover:bg-amber-50 active:scale-95',
      disabled: 'text-slate-400',
      loading: 'text-amber-400 cursor-not-allowed',
    },
  },
  provider: {
    primary: {
      default:
        'bg-blue-600 text-white shadow-md shadow-blue-200 hover:bg-blue-700 active:scale-95 active:shadow-sm',
      disabled: 'bg-slate-200 text-slate-400',
      loading: 'bg-blue-500 text-white cursor-not-allowed',
    },
    secondary: {
      default: 'border-2 border-blue-600 text-blue-600 bg-white hover:bg-blue-50 active:scale-95',
      disabled: 'border-2 border-slate-200 text-slate-400 bg-white',
      loading: 'border-2 border-blue-300 text-blue-400 bg-white cursor-not-allowed',
    },
    text: {
      default: 'text-blue-600 hover:bg-blue-50 active:scale-95',
      disabled: 'text-slate-400',
      loading: 'text-blue-400 cursor-not-allowed',
    },
  },
  admin: {
    primary: {
      default:
        'bg-slate-700 text-white shadow-md shadow-slate-300 hover:bg-slate-800 active:scale-95 active:shadow-sm',
      disabled: 'bg-slate-200 text-slate-400',
      loading: 'bg-slate-600 text-white cursor-not-allowed',
    },
    secondary: {
      default:
        'border-2 border-slate-700 text-slate-700 bg-white hover:bg-slate-50 active:scale-95',
      disabled: 'border-2 border-slate-200 text-slate-400 bg-white',
      loading: 'border-2 border-slate-400 text-slate-500 bg-white cursor-not-allowed',
    },
    text: {
      default: 'text-slate-700 hover:bg-slate-50 active:scale-95',
      disabled: 'text-slate-400',
      loading: 'text-slate-500 cursor-not-allowed',
    },
  },
};

// ─── Button ───────────────────────────────────────────────────────────────────
export function Button({
  variant = 'primary',
  state = 'default',
  size = 'md',
  tone = 'seeker',
  fullWidth = false,
  leadingIcon,
  children,
  onClick,
}: ButtonProps) {
  const disabled = state === 'disabled';
  const loading = state === 'loading';

  // 4-px grid: sm=32px, md=48px, lg=56px height
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-8  px-4  gap-1.5 rounded-xl  text-xs',
    md: 'h-12 px-6  gap-2   rounded-2xl text-sm',
    lg: 'h-14 px-8  gap-2.5 rounded-2xl text-base',
  };

  return (
    <button
      data-tone={tone}
      disabled={disabled || loading}
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center font-semibold transition-all duration-150 select-none',
        sizes[size],
        TONE_VARIANTS[tone][variant][state],
        fullWidth ? 'w-full' : '',
        disabled ? 'cursor-not-allowed' : '',
      ].join(' ')}
    >
      {loading && <Spinner white={variant === 'primary'} tone={tone} />}
      {!loading && leadingIcon && <span className="flex-shrink-0">{leadingIcon}</span>}
      <span>{loading ? (variant === 'text' ? 'Loading…' : 'Please wait…') : children}</span>
    </button>
  );
}

// ─── Icon Button ──────────────────────────────────────────────────────────────
export type IconButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface IconButtonProps {
  icon: ReactNode;
  variant?: IconButtonVariant;
  state?: ButtonState;
  size?: ButtonSize;
  label?: string;
  onClick?: () => void;
}

export function IconButton({
  icon,
  variant = 'primary',
  state = 'default',
  size = 'md',
  label,
  onClick,
}: IconButtonProps) {
  const disabled = state === 'disabled';
  const loading = state === 'loading';

  const sizes: Record<ButtonSize, string> = {
    sm: 'w-8  h-8  rounded-xl',
    md: 'w-11 h-11 rounded-2xl',
    lg: 'w-14 h-14 rounded-2xl',
  };

  const variants: Record<IconButtonVariant, Record<ButtonState, string>> = {
    primary: {
      default:
        'bg-amber-500 text-white shadow-sm shadow-amber-200 hover:bg-amber-600 active:scale-90',
      disabled: 'bg-slate-200 text-slate-400 cursor-not-allowed',
      loading: 'bg-amber-400 text-white cursor-not-allowed',
    },
    secondary: {
      default:
        'border-2 border-amber-500 text-amber-600 bg-white hover:bg-amber-50 active:scale-90',
      disabled: 'border-2 border-slate-200 text-slate-400 bg-white cursor-not-allowed',
      loading: 'border-2 border-amber-300 text-amber-400 bg-white cursor-not-allowed',
    },
    ghost: {
      default: 'bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-90',
      disabled: 'bg-slate-50 text-slate-300 cursor-not-allowed',
      loading: 'bg-slate-100 text-slate-400 cursor-not-allowed',
    },
  };

  return (
    <button
      disabled={disabled || loading}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        'flex items-center justify-center transition-all duration-150 flex-shrink-0',
        sizes[size],
        variants[variant][state],
      ].join(' ')}
    >
      {loading ? (
        <span
          className="w-4 h-4 rounded-full border-2 animate-spin"
          style={{
            borderColor: variant === 'primary' ? 'rgba(255,255,255,0.3)' : 'rgba(245,158,11,0.3)',
            borderTopColor: variant === 'primary' ? '#fff' : '#F59E0B',
          }}
        />
      ) : (
        icon
      )}
    </button>
  );
}
