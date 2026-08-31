import type { ReactNode } from 'react';
import { X } from 'lucide-react';

import { useLang } from '../../../i18n/LanguageContext';
import { SHELL_COPY, type Lang } from '../copy/onboarding-hub-copy';

// Sprint 9B.16 — the full-screen onboarding shell.
//
// WHAT MAKES IT "FULL SCREEN"
//
// Not that it escapes the phone frame — that frame IS the app viewport, and
// leaving it would restyle the product on desktop for no one's benefit. What
// it drops is the APPLICATION CHROME: the provider bottom navigation and the
// welcome/notifications bar. An application form with a nav bar under it
// invites the provider to wander off mid-answer, and the tabs it offers all
// lead to marketplace surfaces a DRAFT provider is not allowed to use.
//
// So this renders its own compact header and nothing else. The only way out
// is the close control, which is always visible and always goes to one place.

export interface OnboardingShellProps {
  title: string;
  /** Rendered under the title, small. The hub passes its progress count here;
   *  a task screen passes nothing. Kept on the SAME row block as the title so
   *  the header cannot grow a second overlapping bar. */
  subtitle?: string | null;
  /** Where the close control goes. Always provided — a full-screen surface
   *  with no visible way back is a trap. */
  onClose: () => void;
  /** Sticky footer actions. Sits above the bottom safe-area inset. */
  footer?: ReactNode;
  children: ReactNode;
}

export function OnboardingShell({
  title,
  subtitle,
  onClose,
  footer,
  children,
}: OnboardingShellProps) {
  const { lang, dir, darkMode } = useLang();
  const copy = SHELL_COPY[lang as Lang] ?? SHELL_COPY.en;
  const fontFamily = lang === 'ar' ? "'Cairo', 'Inter', sans-serif" : "'Inter', sans-serif";

  return (
    <div
      dir={dir}
      data-testid="onboarding-v2-shell"
      className={`flex flex-col ${darkMode ? 'dark bg-slate-900' : 'bg-white'}`}
      style={{ height: '100svh', fontFamily, direction: dir }}
    >
      {/* ── Compact header ────────────────────────────────────────────────
          One row. The title and the progress line share a single column so
          they cannot overlap each other at any width, and the close control
          is a fixed-size square that never shrinks — at 320px the TITLE
          gives up space, never the way out. */}
      <header
        className="flex-shrink-0 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            data-testid="onboarding-v2-close"
            // 44x44 is the minimum comfortable touch target, and it is set on
            // the BUTTON rather than an icon wrapper so the whole square is
            // pressable rather than just the glyph inside it.
            className="flex-shrink-0 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
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

      {/* ── Content ───────────────────────────────────────────────────────
          The only scroll container. Horizontal overflow is clipped here as
          well as prevented by the layout, so a single long unbroken string
          in server-provided copy cannot make the PAGE scroll sideways. */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Mode B — a readable measure. The shell is full-bleed now that Root no
            longer caps provider routes at 430px, so the CONTENT has to own its
            width: a form line that runs the whole of a 1440px display is
            harder to read than one that does not. */}
        <div className="mx-auto w-full max-w-3xl px-4 py-4 md:py-6">{children}</div>
      </main>

      {/* ── Actions ───────────────────────────────────────────────────────
          Padded for the home indicator. `env(...)` with an explicit 0px
          fallback, because a browser that does not know the function drops
          the whole declaration and the button ends up under the bar. */}
      {footer ? (
        <div
          className="flex-shrink-0 border-t border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 pt-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {/* The bar spans the viewport so its border reads as a real edge,
              but its CONTENT tracks the same measure as the form above it —
              otherwise the primary action drifts away from the fields it
              submits on a wide display. */}
          <div className="mx-auto w-full max-w-3xl px-4">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}
