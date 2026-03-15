import { createContext, useContext, useState } from "react";
import { motion } from "motion/react";
import { TRANSLATIONS, type Lang } from "./translations";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LangCtx {
  lang:           Lang;
  dir:            "ltr" | "rtl";
  t:              (key: string) => string;
  toggleLang:     () => void;
  setLang:        (l: Lang) => void;
  darkMode:       boolean;
  toggleDarkMode: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────
const LanguageContext = createContext<LangCtx>({
  lang:           "en",
  dir:            "ltr",
  t:              (k) => k,
  toggleLang:     () => {},
  setLang:        () => {},
  darkMode:       false,
  toggleDarkMode: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang,     setLangState] = useState<Lang>("en");
  const [darkMode, setDarkMode]  = useState(false);

  const dir: "ltr" | "rtl" = lang === "ar" ? "rtl" : "ltr";

  const t = (key: string): string =>
    TRANSLATIONS[lang][key] ?? TRANSLATIONS["en"][key] ?? key;

  const setLang = (l: Lang) => setLangState(l);

  const toggleLang = () => setLangState((prev) => (prev === "en" ? "ar" : "en"));

  const toggleDarkMode = () => setDarkMode((v) => !v);

  return (
    <LanguageContext.Provider value={{ lang, dir, t, toggleLang, setLang, darkMode, toggleDarkMode }}>
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
        animate={{ left: lang === "en" ? "2px" : "calc(50%)" }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      />
      <span
        className="relative z-10 px-2.5 py-1 rounded-lg transition-colors select-none"
        style={{
          fontSize: "11px", fontWeight: 700,
          color: lang === "en" ? "#F59E0B" : "#94a3b8",
          fontFamily: "'Inter', sans-serif",
        }}
      >EN</span>
      <span
        className="relative z-10 px-2.5 py-1 rounded-lg transition-colors select-none"
        style={{
          fontSize: "12px", fontWeight: 700,
          color: lang === "ar" ? "#F59E0B" : "#94a3b8",
          fontFamily: "'Cairo', sans-serif",
        }}
      >ع</span>
    </button>
  );
}