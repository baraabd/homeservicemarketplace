import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Provider layout and action primitives (Mode B).
//
// Geometry, colour and spacing live HERE. Callers pass meaning — `tone`,
// `size`, `as` — never appearance. That is what stops the six task screens
// from re-deriving a card border six slightly different ways, which is what
// the baseline found.

/**
 * The measure.
 *
 * Root no longer caps provider routes at 430px, so content has to own its
 * width. A form line that runs the whole of a 1440px display is harder to read
 * than one that does not — this is the same reason newspapers use columns.
 */
export function ProviderContainer({
  children,
  width = 'form',
  className = '',
}: {
  children: ReactNode;
  /** `form` for reading and input; `app` for dashboards and lists. */
  width?: 'form' | 'app';
  className?: string;
}) {
  const max = width === 'form' ? 'max-w-3xl' : 'max-w-6xl';
  return <div className={`mx-auto w-full ${max} px-4 md:px-6 ${className}`}>{children}</div>;
}

const BUTTON_TONE = {
  primary:
    'bg-pv-accent text-white hover:bg-pv-accent-hover disabled:bg-pv-border-strong disabled:text-pv-muted',
  secondary:
    'bg-pv-surface text-pv-text border border-pv-border-strong hover:bg-pv-surface-sunken disabled:text-pv-muted',
  ghost: 'bg-transparent text-pv-accent hover:bg-pv-accent-subtle disabled:text-pv-muted',
  danger: 'bg-pv-danger text-white hover:opacity-90 disabled:bg-pv-border-strong',
} as const;

export interface ProviderButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: keyof typeof BUTTON_TONE;
  /**
   * `auto` sizes to content; `block` fills its container.
   *
   * The default is deliberately `auto`. Once the phone frame came off, a
   * `w-full` primary action became a 768px-wide button on desktop — a control
   * whose size implied an importance nothing else on the screen had. Full
   * width is right on a phone and wrong past it, so `block` is opt-in per
   * breakpoint by the caller rather than the default everywhere.
   */
  size?: 'auto' | 'block';
}

export function ProviderButton({
  tone = 'primary',
  size = 'auto',
  className = '',
  type = 'button',
  children,
  ...rest
}: ProviderButtonProps) {
  return (
    <button
      type={type}
      // 44px minimum height is the WCAG 2.2 target size, not a style choice.
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent disabled:cursor-not-allowed ${
        BUTTON_TONE[tone]
      } ${size === 'block' ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ProviderCard({
  children,
  tone,
  className = '',
  ...rest
}: {
  children: ReactNode;
  tone?: 'default' | 'sunken';
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const surface = tone === 'sunken' ? 'bg-pv-surface-sunken' : 'bg-pv-surface';
  return (
    <div className={`rounded-xl border border-pv-border ${surface} ${className}`} {...rest}>
      {children}
    </div>
  );
}

/**
 * A labelled group.
 *
 * The heading is a real `h2` in sentence case, not 11px all-caps grey. The
 * baseline's group labels were decoration that happened to contain words: too
 * small to scan, too light to read, and invisible to a screen reader as
 * structure.
 */
export function ProviderSection({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={`flex flex-col gap-3 ${className}`}>
      {title ? <h2 className="text-[15px] font-semibold text-pv-muted">{title}</h2> : null}
      {children}
    </section>
  );
}

export function ProviderPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold leading-tight text-pv-text">{title}</h1>
        {subtitle ? <p className="mt-1 text-[14px] text-pv-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * The action bar.
 *
 * Spans the viewport so its top border reads as a real edge, while its
 * contents track the same measure as the form above — otherwise the primary
 * action drifts away from the fields it submits on a wide display. Padded for
 * the home indicator with an explicit 0px fallback, because a browser that
 * does not know `env()` drops the whole declaration and puts the button under
 * the system bar.
 */
export function ProviderStickyActions({
  children,
  width = 'form',
}: {
  children: ReactNode;
  width?: 'form' | 'app';
}) {
  return (
    <div
      className="sticky bottom-0 z-10 border-t border-pv-border bg-pv-surface pt-3"
      style={{
        paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
        boxShadow: 'var(--pv-shadow-2)',
      }}
    >
      <ProviderContainer width={width}>{children}</ProviderContainer>
    </div>
  );
}

/**
 * Progress as a COUNT, never a percentage.
 *
 * `total` is the server's, not `tasks.length`: the client rendering its own
 * denominator is how a hub starts disagreeing with the policy that decides
 * completion. The legacy wizard's "44% complete" was computed client-side and
 * meant nothing in particular.
 */
export function ProviderProgress({
  complete,
  total,
  label,
}: {
  complete: number;
  total: number;
  label: string;
}) {
  const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] font-medium text-pv-muted">{label}</p>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-pv-surface-sunken"
        role="progressbar"
        aria-valuenow={complete}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-pv-accent transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ProviderMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <ProviderCard className="p-4">
      <p className="text-[13px] font-medium text-pv-muted">{label}</p>
      <p className="mt-1 text-[22px] font-bold text-pv-text">{value}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-pv-muted">{hint}</p> : null}
    </ProviderCard>
  );
}
