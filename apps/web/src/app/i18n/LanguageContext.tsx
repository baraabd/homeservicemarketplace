import { createContext, useContext, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { TRANSLATIONS, type Lang } from './translations';

// ─── Types ────────────────────────────────────────────────────────────────────
interface LangCtx {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  t: (key: string) => string;
  toggleLang: () => void;
  setLang: (l: Lang) => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────
const LanguageContext = createContext<LangCtx>({
  lang: 'en',
  dir: 'ltr',
  t: (k) => k,
  toggleLang: () => {},
  setLang: () => {},
  darkMode: false,
  toggleDarkMode: () => {},
});

// Persisted so the choice survives navigation and reload. A reader who
// switched to Arabic and then refreshed used to land back in English.
const LANG_STORAGE_KEY = 'hsm.lang';

function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ar';
}

// Read the stored preference. Wrapped because localStorage THROWS (not
// returns null) in Safari private mode and wherever site data is blocked —
// an unguarded read would take the whole app down on first render.
function readStoredLang(): Lang {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return 'en';
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Lazy initialiser so the stored language is applied on the FIRST render.
  // Reading it in an effect instead would paint one frame of English before
  // flipping, which for an RTL reader is a visible layout jump.
  const [lang, setLangState] = useState<Lang>(() =>
    typeof window === 'undefined' ? 'en' : readStoredLang(),
  );
  const [darkMode, setDarkMode] = useState(false);

  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr';

  // Mirror the language onto the DOCUMENT ELEMENT.
  //
  // `dir` was previously applied only to inner <div> wrappers, and `lang` was
  // whatever index.html hardcoded, so:
  //   - assistive technology announced Arabic content with an English voice,
  //     because `lang` never changed;
  //   - the UA's own bidi handling never engaged, so anything outside those
  //     wrappers (native form controls, scrollbar side, text selection, the
  //     ::placeholder direction) stayed LTR in an RTL layout.
  // Both are properties of the DOCUMENT, which is why they belong on <html>.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = dir;
  }, [lang, dir]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // Storage unavailable — the choice simply does not persist. Never let a
      // preference write break the render.
    }
  }, [lang]);

  const t = (key: string): string => TRANSLATIONS[lang][key] ?? TRANSLATIONS['en'][key] ?? key;

  const setLang = (l: Lang) => setLangState(l);

  const toggleLang = () => setLangState((prev) => (prev === 'en' ? 'ar' : 'en'));

  const toggleDarkMode = () => setDarkMode((v) => !v);

  return (
    <LanguageContext.Provider
      value={{ lang, dir, t, toggleLang, setLang, darkMode, toggleDarkMode }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useLang() {
  return useContext(LanguageContext);
}

// ─── Language Toggle ──────────────────────────────────────────────────────────
export function LangToggle() {
  const { lang, toggleLang } = useLang();
  return (
    <button
      onClick={toggleLang}
      className="relative flex items-center bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5 overflow-hidden"
      aria-label="Switch language"
    >
      <motion.div
        className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-white dark:bg-slate-600 rounded-[10px] shadow-sm"
        animate={{ left: lang === 'en' ? '2px' : 'calc(50%)' }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />
      {/* Sprint 09B.29 — the colours are semantic tokens, not literals.
       *
       * These were hard-coded `#F59E0B` and `#94a3b8`, measuring 2.15:1 and
       * 2.34:1 against the toggle's own track: a SERIOUS axe violation on every
       * screen, because this toggle is in the shell header and so appears on
       * all of them. `--lang-toggle-*` carries the replacement in both themes
       * (see styles/theme.css for the ratios). */}
      <span
        className={`relative z-10 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors select-none ${
          lang === 'en' ? 'text-lang-toggle-active' : 'text-lang-toggle-inactive'
        }`}
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        EN
      </span>
      <span
        className={`relative z-10 px-2.5 py-1 rounded-lg text-xs font-bold transition-colors select-none ${
          lang === 'ar' ? 'text-lang-toggle-active' : 'text-lang-toggle-inactive'
        }`}
        style={{ fontFamily: "'Cairo', sans-serif" }}
      >
        ع
      </span>
    </button>
  );
}
