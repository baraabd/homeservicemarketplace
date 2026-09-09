import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// Sprint 09B.29 — the approved prototype's `.hsm-alert`, as a V2 primitive.
//
// Reference: docs/provider-experience-v2/reference/provider-onboarding-prototype.html
//
// WHY NOT `ProviderNotice`
//
// `ProviderNotice` is the workspace's notice and it is used across surfaces
// this sprint does not touch. It differs from `.hsm-alert` in six measured
// ways — a border, a 12px gap, an 18px icon, a 600-weight title, a 13px body
// on the text colour, and a forced start alignment — and every one of them
// showed up in the screen-1 diff. Changing it to match would have moved every
// other screen that uses it, so the prototype's alert gets its own component
// and `ProviderNotice` is left exactly as it was.
//
// MEASURED, NOT GUESSED
//
// Every number here was read off the prototype with `getComputedStyle` under
// the same vendored fonts and pinned icon build the reference snapshot uses:
//
//   container  grid, 24px + 1fr, gap 10, padding 14, radius 12, no border
//   icon       16x16, block, top-aligned at the start of the 24px column
//   title      14px / 500 / 1.25, 4px below it, on the tone colour
//   body       14px / 1.8 / 400, on the muted text colour
//
// Two of those look surprising and are not mistakes.
//
// The TITLE is 500, not 700. The prototype's `.hsm-alert h2` declares no
// weight, so it takes the wrapper's `h1,h2 { font-weight: var(--font-weight-
// medium) }` — 500. The wrapper's *body* weight (430) is neutralised for the
// capture because it is scaffolding; this heading rule is not neutralised,
// because the design's own weights are declared on the components that want
// them (`.hsm-heading`, `.hsm-primary`, `.hsm-badge` all say 700 explicitly)
// and this one deliberately does not.
//
// The BODY is 14px/1.8 muted, not the 12px/1.65 that `.hsm-alert p` asks for.
// On the centred screens `.hsm-center p` and `.hsm-alert p` have equal
// specificity and `.hsm-center p` is declared later, so it wins. That is what
// the approved reference image actually shows, and the reference image is the
// acceptance evidence — so it is what this reproduces. `density="compact"`
// is the `.hsm-alert p` rule for the screens where nothing overrides it.

export type OnboardingAlertTone = 'waiting' | 'success' | 'warning' | 'danger';

/** Tone -> the prototype's paired foreground and soft background tokens. */
const TONE: Record<OnboardingAlertTone, { fg: string; bg: string }> = {
  waiting: { fg: 'var(--pv-waiting)', bg: 'var(--pv-waiting-bg)' },
  success: { fg: 'var(--pv-done)', bg: 'var(--pv-done-bg)' },
  warning: { fg: 'var(--pv-blocked)', bg: 'var(--pv-blocked-bg)' },
  danger: { fg: 'var(--pv-danger)', bg: 'var(--pv-danger-bg)' },
};

/**
 * `comfortable` is the rendering on the centred screens (0, 1, 13, 16, 17),
 * where `.hsm-center p` overrides the alert's own paragraph rule.
 * `compact` is `.hsm-alert p` as declared, for the screens inside `.hsm-main`.
 */
const DENSITY = {
  comfortable: { fontSize: 14, lineHeight: 1.8, color: 'var(--pv-text-muted)' },
  compact: { fontSize: 12, lineHeight: 1.65, color: 'inherit' },
} as const;

export interface OnboardingAlertProps {
  tone: OnboardingAlertTone;
  /** A lucide icon component. Rendered at 16px — the size every icon in the
   *  prototype resolves to, because its pinned lucide build does not carry the
   *  requested size onto the `<svg>` it substitutes for the `<i>`. */
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  density?: keyof typeof DENSITY;
  /**
   * `status` for something in progress, `alert` for a failure that needs
   * attention. Passed in rather than derived from the tone: the same tone can
   * be either, and an `alert` interrupts a screen reader where a `status` does
   * not.
   */
  role?: 'status' | 'alert';
  className?: string;
  'data-testid'?: string;
}

export function OnboardingAlert({
  tone,
  icon: Icon,
  title,
  body,
  density = 'comfortable',
  role = 'status',
  className = '',
  'data-testid': testId,
}: OnboardingAlertProps) {
  const { fg, bg } = TONE[tone];
  const d = DENSITY[density];

  return (
    <div
      role={role}
      // Text alignment is INHERITED on purpose. The prototype centres this
      // alert on the centred screens and starts it inside `.hsm-main`, and it
      // does so by inheriting from the container both times — the alert itself
      // never declares an alignment.
      className={`grid w-full ${className}`}
      style={{
        gridTemplateColumns: '24px 1fr',
        gap: 10,
        padding: 14,
        borderRadius: 12,
        background: bg,
        color: fg,
      }}
      data-testid={testId}
    >
      {/* A block span, so the icon sits at the START of its 24px column
          rather than being centred by the inherited `text-align`. */}
      <span className="block" aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p
          data-part="title"
          style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.25, marginBottom: 4 }}
        >
          {title}
        </p>
        <p
          data-part="body"
          style={{ fontSize: d.fontSize, lineHeight: d.lineHeight, color: d.color }}
        >
          {body}
        </p>
      </div>
    </div>
  );
}
