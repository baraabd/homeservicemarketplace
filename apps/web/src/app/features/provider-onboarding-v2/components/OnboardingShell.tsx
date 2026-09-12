import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

import { useLang } from '../../../i18n/LanguageContext';
import { SHELL_COPY, type Lang } from '../copy/onboarding-hub-copy';

// Sprint 9B.16 — the full-screen onboarding shell.
// Sprint 9B.28 — mobile-first, and scoped.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// WHAT MAKES IT "FULL SCREEN"
//
// Not that it escapes a phone frame. What it drops is the APPLICATION CHROME:
// the provider bottom navigation and the welcome/notifications bar. An
// application form with a nav bar under it invites the provider to wander off
// mid-answer, and the tabs it offers all lead to marketplace surfaces a DRAFT
// provider is not allowed to use. So this renders its own compact header and
// nothing else, and the only way out is the close control.
//
// THE WIDTH POLICY, AND WHY IT REVERSED
//
// 9B.15 took the provider experience out of the 430px phone frame, and this
// shell followed with `max-w-3xl` — 768px. That is right for the WORKSPACE,
// where a provider reconciles earnings and compares bids on a laptop all day.
// It is wrong for onboarding, which is a focused, one-decision-at-a-time
// submission flow: at 768px the fields, the labels and the primary action
// spread far enough apart that the eye has to travel between a label and the
// input it belongs to, and the form stops reading as a sequence.
//
// So the policy is now SCOPED rather than global. This file is used by the
// onboarding hub and the onboarding tasks and by nothing else, so constraining
// it here constrains exactly `/provider/onboarding/*` and leaves the rest of
// the provider workspace — and every Seeker and Admin surface — untouched.
// Root is NOT changed; the old global 430px cap stays gone.
//
//   320–639px   the column IS the viewport. No second card inside the phone,
//               16px gutters, one scroll container.
//   ≥640px      a centred 480px column on a quiet neutral ground, with a
//               border and a soft shadow to seat it. Not stretched to the
//               browser width, and not a phone-shaped strip on a dark
//               gradient either — the surrounding tone is neutral and calm.
//
// The dark area around a 390px Chrome device-emulator frame is TOOLING, not
// this component. Layout is validated from viewport screenshots.

export interface OnboardingShellProps {
  title: string;
  /** Rendered under the title, small. The hub passes its progress count here;
   *  a task screen passes nothing. Kept on the SAME row block as the title so
   *  the header cannot grow a second overlapping bar. */
  subtitle?: string | null;
  /** Where the close control goes. Always provided — a full-screen surface
   *  with no visible way back is a trap.
   *
   *  Sprint 9B.28 — task screens pass an exit that FLUSHES first. The shell
   *  does not know that and must not: it owns the control, not the policy. */
  onClose: () => void;
  /** Disables the close control while an exit is already draining, so a second
   *  tap cannot start a second one. */
  closeBusy?: boolean;
  /**
   * Which leading control the approved screen draws.
   *
   * Sprint 09B.29 Phase 5A. The prototype's `hsmTop` takes a `back` flag and
   * draws one of two things with it: an ARROW on the nine task screens, which
   * step back through a flow, and an X on the nine lifecycle screens, which
   * leave it. They are different promises — one returns you to where you came
   * from, the other abandons the surface — and drawing an X on a task screen
   * told the provider their answers were about to be discarded.
   *
   * The arrow MIRRORS with direction, as the reference does: the prototype
   * asks for `arrow-right` in Arabic and `arrow-left` in English, because
   * "back" is toward the start of the line and the line runs the other way.
   */
  backAffordance?: 'close' | 'back';
  /**
   * Application progress, 0–100, drawn as a 4px rule under the header.
   *
   * Sprint 09B.29 — the prototype carries this on every screen. It is a
   * SERVER-DERIVED number everywhere it is non-zero; the two activation
   * screens are the exception because no application exists yet, and they pass
   * literals (0 and 5) exactly as the reference does.
   *
   * Omitted rather than defaulted to 0: a screen with no progress concept
   * should draw no rule, not an empty one that reads as "you have done
   * nothing".
   */
  progress?: number;
  /** Sticky footer actions. Sits above the bottom safe-area inset. */
  footer?: ReactNode;
  /**
   * Whether the shell supplies the content gutter.
   *
   * Default `true` — the 16px inset every form screen uses. A screen that
   * centres itself in the remaining space (the prototype's `.hsm-center`, which
   * is `align-content: center` with its own `28px 20px 110px`) needs the full
   * box and its own padding, so it opts out rather than fighting the shell's
   * with negative margins.
   */
  padded?: boolean;
  children: ReactNode;
}

export function OnboardingShell({
  title,
  subtitle,
  onClose,
  closeBusy = false,
  backAffordance = 'close',
  progress,
  footer,
  padded = true,
  children,
}: OnboardingShellProps) {
  const { lang, dir, darkMode } = useLang();
  const copy = SHELL_COPY[lang as Lang] ?? SHELL_COPY.en;
  const fontFamily = lang === 'ar' ? "'Cairo', 'Inter', sans-serif" : "'Inter', sans-serif";

  return (
    // ── Ground ────────────────────────────────────────────────────────────
    // Full-bleed and neutral. On a phone it is completely covered by the
    // column above it, so it costs nothing there; on a desktop it is the quiet
    // surface the focused column sits on.
    <div
      dir={dir}
      data-testid="onboarding-v2-ground"
      className={`flex justify-center ${darkMode ? 'dark bg-slate-950' : 'bg-slate-100'}`}
      style={{ minHeight: '100svh', fontFamily, direction: dir }}
    >
      {/* ── Focused column ───────────────────────────────────────────────
          `sm:` (640px) rather than `md:` (768px) is deliberate: 768px IS the
          tablet in the acceptance matrix, and a rule that only engaged ABOVE
          it would leave the tablet full-bleed — the exact thing this reverses.

          `100svh`, the SMALL viewport height, so the sticky footer is above
          the fold with the mobile URL bar EXPANDED. `dvh` would let the footer
          sit under the bar at the moment it grows, which is precisely when the
          provider is reaching for it. */}
      <div
        dir={dir}
        data-testid="onboarding-v2-shell"
        // `leading-[21px]` is the approved screens' base line box, and it is a
        // LENGTH rather than a ratio.
        //
        // The reference's wrapper sets `line-height: calc(14px * 1.5)` on the
        // body, and almost nothing in the design overrides it — so a 13px
        // label, a 12px hint and an 11px save line all sit in a 21px box and
        // do NOT shrink with their font size. Inheriting a ratio instead made
        // every one of them a few pixels shorter, and the error accumulated
        // down the column: by the phone field the application was 12px high.
        //
        // Components that need their own leading (the hero, the centred
        // screens, the help text at 1.6) still declare it and are unaffected.
        className={`flex w-full flex-col leading-[21px] sm:max-w-[480px] sm:border-x sm:shadow-xl ${
          darkMode ? 'bg-slate-900 sm:border-slate-800' : 'bg-white sm:border-slate-200'
        }`}
        style={{ height: '100svh' }}
      >
        {/* ── Compact header ──────────────────────────────────────────────
            One row. The title and the progress line share a single column so
            they cannot overlap each other at any width, and the close control
            is a fixed-size square that never shrinks — at 320px the TITLE
            gives up space, never the way out. */}
        <header
          className="flex-shrink-0 bg-pv-surface"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          {/* The topbar row, transcribed from the prototype's `.hsm-topbar`.
              Three things here are load-bearing and each was measured against
              the reference rather than guessed:

              GRID, `44px minmax(0,1fr) 44px`, no column gap. The flex version
              added an 8px gap that pushed the title 8px inward on every
              onboarding screen.

              `min-height: 64px` WITH the bottom border on this row. Under
              `box-sizing: border-box` the prototype's border sits inside its
              64px box, and the 4px progress rule follows it. Carrying the
              border on the parent `<header>` instead made the header 65px and
              put the progress rule — and everything below it — one pixel low.

              17px/1.45 type. It was 15px, which shortened the bar and shifted
              the whole screen. */}
          <div
            className="grid w-full items-center border-b border-pv-border px-3 py-2"
            style={{ minHeight: '64px', gridTemplateColumns: '44px minmax(0,1fr) 44px' }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={closeBusy}
              aria-label={backAffordance === 'back' ? copy.back : copy.close}
              aria-busy={closeBusy || undefined}
              data-testid="onboarding-v2-close"
              // 44x44 is the minimum comfortable touch target, and it is set
              // on the BUTTON rather than an icon wrapper so the whole square
              // is pressable rather than just the glyph inside it.
              className="flex-shrink-0 flex items-center justify-center rounded-xl text-pv-muted hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              style={{ minWidth: '44px', minHeight: '44px' }}
            >
              {/* 16px, and `text-pv-muted` rather than `text-slate-500`.
                  Both were measured against the prototype: its pinned lucide
                  build substitutes an `<svg>` for the `<i>` WITHOUT carrying
                  the requested size across, so every icon in the reference
                  resolves to 16px whatever the markup asks for; and
                  `.hsm-icon-action` is `--hsm-muted` (#475569), which is
                  `--pv-text-muted`, not slate-500 (#64748b). */}
              {backAffordance === 'back' ? (
                // Mirrored, not flipped with a transform: the two lucide
                // glyphs are drawn for their own direction, and a CSS
                // `scaleX(-1)` on an arrow leaves its stroke terminals and
                // optical weight reversed as well.
                dir === 'rtl' ? (
                  <ArrowRight size={16} aria-hidden="true" />
                ) : (
                  <ArrowLeft size={16} aria-hidden="true" />
                )
              ) : (
                <X size={16} aria-hidden="true" />
              )}
            </button>

            {/* min-w-0 is load-bearing: without it this flex child refuses to
                shrink below its text width and pushes the header — and with it
                the document — into horizontal overflow on a 320px screen. */}
            <div className="min-w-0 flex-1">
              <h1
                className="truncate text-pv-text"
                style={{ fontSize: '17px', lineHeight: 1.45, fontWeight: 700 }}
              >
                {title}
              </h1>
              {subtitle ? (
                <p
                  className="truncate text-pv-muted dark:text-slate-400"
                  // `.hsm-topbar p` sets a 12px size and no line-height, so it
                  // inherits the wrapper's `line-height: 21px` — a LENGTH, not
                  // a ratio, so it does not scale down with the font. At 18px
                  // (12 x 1.5) this line was 3px short and pushed the title 2px
                  // down on every screen that carries a subtitle.
                  style={{ fontSize: '12px', lineHeight: '21px', marginTop: '1px' }}
                  data-testid="onboarding-v2-progress"
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
            <span aria-hidden="true" data-testid="onboarding-v2-header-spacer" />
          </div>

          {/* The 4px rule the prototype draws under every header.
              `role="progressbar"` with the three aria-value attributes rather
              than a bare div: the width alone is invisible to a screen reader,
              and the count in the subtitle above is the same fact only on the
              screens that carry one. */}
          {progress !== undefined ? (
            <div
              className="h-1 w-full bg-pv-surface-sunken"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label={copy.progressAria}
              data-testid="onboarding-v2-progress-bar"
            >
              <span
                className="block h-full bg-pv-accent transition-[width] duration-200 motion-reduce:transition-none"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          ) : null}
        </header>

        {/* ── Content ─────────────────────────────────────────────────────
            The only scroll container. Horizontal overflow is clipped here as
            well as prevented by the layout, so a single long unbroken string
            in server-provided copy cannot make the PAGE scroll sideways.

            No inner max-width any more: the COLUMN is the measure now, so a
            second cap here would indent the form inside an already narrow
            card — the "card in a card" the mobile-first brief rules out. */}
        {/* `bg-pv-bg`, not the surface colour.
            The approved prototype draws its content area on the app background
            (`--pv-bg`, #f8fafc) with cards and panels in white on top of it;
            the header and the sticky action bar are the white surfaces. This
            was white here, which flattened the card against its own background
            and was the second difference the visual gate reported against
            screen 0. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-pv-bg">
          {/* A flex column that fills the scroll area, so a screen that centres
              itself vertically has a box with a resolved height to centre in.
              `min-h-full` alone left the child measuring 100% of an AUTO height,
              which collapses to zero — the centred screen simply stacked from
              the top and the diff blamed the content position. */}
          <div
            className={
              // `.hsm-main`: `padding: 20px 16px 112px`. The 112px bottom clears
              // the reference's ABSOLUTELY positioned sticky bar; ours is a flex
              // sibling that already takes its own space, so the bottom inset is
              // ordinary scroll-end breathing room instead. The 20px top is not
              // — it is the first measurement every element below inherits, and
              // at 16px the whole screen sat 4px high.
              padded
                ? 'flex min-h-full w-full flex-col px-4 pb-5 pt-5'
                : 'flex min-h-full w-full flex-col'
            }
          >
            {children}
          </div>
        </main>

        {/* ── Actions ─────────────────────────────────────────────────────
            Padded for the home indicator. `env(...)` with an explicit 0px
            fallback, because a browser that does not know the function drops
            the whole declaration and the button ends up under the bar. */}
        {footer ? (
          <div
            data-testid="onboarding-v2-sticky"
            className="flex-shrink-0 border-t border-pv-border bg-pv-surface/96 pt-3"
            style={{
              paddingBottom: 'calc(18px + env(safe-area-inset-bottom, 0px))',
              // The prototype's `.hsm-sticky` lifts itself off the content with
              // an upward shadow. Without it the six rows above the bar differ
              // from the reference on every screen that has a sticky action —
              // which was the single largest remaining block in the visual diff.
              boxShadow: '0 -6px 18px color-mix(in srgb, var(--pv-text) 7%, transparent)',
            }}
          >
            <div className="w-full px-4">{footer}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
