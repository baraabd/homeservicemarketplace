import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSwipe } from '../../hooks/useSwipe';
import { useLang, LangToggle } from '../../i18n/LanguageContext';

// ─── Back chevron (flips in RTL) ──────────────────────────────────────────────
function BackChevron() {
  const { dir } = useLang();
  return dir === 'rtl' ? (
    <ChevronRight size={20} className="text-slate-700" />
  ) : (
    <ChevronLeft size={20} className="text-slate-700" />
  );
}

// ─── Shared top bar ───────────────────────────────────────────────────────────
export function AuthTopBar({ title, onBack }: { title: string; onBack: () => void }) {
  const { lang } = useLang();
  // K02 — at 200% zoom the language control wraps onto its own row instead
  // of being pushed off-screen, and the title keeps whole words; the back
  // control is named and 44px.
  return (
    <div className="sticky top-0 z-20 bg-white/96 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-100 shadow-sm">
      <div className="flex min-w-[8rem] flex-1 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={lang === 'ar' ? 'رجوع' : 'Back'}
          className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center active:scale-90 transition-all flex-shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <BackChevron />
        </button>
        <h2
          className="min-w-0 text-slate-900"
          style={{ fontSize: '16px', fontWeight: 700, overflowWrap: 'break-word' }}
        >
          {title}
        </h2>
      </div>
      <div className="shrink-0">
        <LangToggle />
      </div>
    </div>
  );
}

// ─── Swipeable wrapper ────────────────────────────────────────────────────────
export function SwipeableScreen({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const { dir } = useLang();
  const { onTouchStart, onTouchMove, onTouchEnd, dragX } = useSwipe({
    onSwipeRight: dir === 'ltr' ? onBack : undefined,
    onSwipeLeft: dir === 'rtl' ? onBack : undefined,
    threshold: 70,
    edgeStartOnly: true,
    edgeWidth: 60,
  });

  return (
    <div
      className="flex flex-col"
      style={{
        minHeight: '100svh',
        transform: `translateX(${dir === 'ltr' ? Math.max(dragX * 0.4, 0) : Math.min(dragX * 0.4, 0)}px)`,
        transition: dragX !== 0 ? 'none' : 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {children}
    </div>
  );
}
