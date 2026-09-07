import type { ReactNode } from 'react';
import { X } from 'lucide-react';

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
  /** Sticky footer actions. Sits above the bottom safe-area inset. */
  footer?: ReactNode;
  children: ReactNode;
}

export function OnboardingShell({
  title,
  subtitle,
  onClose,
  closeBusy = false,
  footer,
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
        className={`flex w-full flex-col sm:max-w-[480px] sm:border-x sm:shadow-xl ${
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
          className="flex-shrink-0 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <div className="flex w-full items-center gap-2 px-3 py-2">
            <button
              type="button"
              onClick={onClose}
              disabled={closeBusy}
              aria-label={copy.close}
              aria-busy={closeBusy || undefined}
              data-testid="onboarding-v2-close"
              // 44x44 is the minimum comfortable touch target, and it is set
              // on the BUTTON rather than an icon wrapper so the whole square
              // is pressable rather than just the glyph inside it.
              className="flex-shrink-0 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              style={{ minWidth: '44px', minHeight: '44px' }}
            >
              <X size={20} aria-hidden="true" />
            </button>

            {/* min-w-0 is load-bearing: without it this flex child refuses to
                shrink below its text width and pushes the header — and with it
                the document — into horizontal overflow on a 320px screen. */}
            <div className="min-w-0 flex-1">
              <h1
                className="truncate text-slate-900 dark:text-white"
                style={{ fontSize: '15px', fontWeight: 700 }}
              >
                {title}
              </h1>
              {subtitle ? (
                <p
                  className="truncate text-slate-500 dark:text-slate-400"
                  style={{ fontSize: '12px' }}
                  data-testid="onboarding-v2-progress"
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
        </header>

        {/* ── Content ─────────────────────────────────────────────────────
            The only scroll container. Horizontal overflow is clipped here as
            well as prevented by the layout, so a single long unbroken string
            in server-provided copy cannot make the PAGE scroll sideways.

            No inner max-width any more: the COLUMN is the measure now, so a
            second cap here would indent the form inside an already narrow
            card — the "card in a card" the mobile-first brief rules out. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full px-4 py-4">{children}</div>
        </main>

        {/* ── Actions ─────────────────────────────────────────────────────
            Padded for the home indicator. `env(...)` with an explicit 0px
            fallback, because a browser that does not know the function drops
            the whole declaration and the button ends up under the bar. */}
        {footer ? (
          <div
            className="flex-shrink-0 border-t border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 pt-3"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="w-full px-4">{footer}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
