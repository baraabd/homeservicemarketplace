import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Outlet, useLocation, useNavigation, useOutletContext } from "react-router";
import { JobWizardModal } from "./components/wizard/JobWizardModal";
import { Snackbar }        from "./components/ds/Snackbar";
import { LanguageProvider, useLang } from "./i18n/LanguageContext";
import { EcosystemProvider } from "./context/EcosystemContext";

// ─── Shared outlet-context type ───────────────────────────────────────────────
export interface RootContext {
  isOffline:     boolean;
  openWizard:    (service: string) => void;
  toggleOffline: () => void;
}

export function useRootContext() {
  return useOutletContext<RootContext>();
}

// ─── Inner layout (needs lang context) ───────────────────────────────────────
function RootInner() {
  const { lang, dir, t, darkMode } = useLang();

  const [isOffline,    setIsOffline]    = useState(false);
  const [offlineSnack, setOfflineSnack] = useState(false);
  const [wizardOpen,   setWizardOpen]   = useState(false);
  const [selectedSvc,  setSelectedSvc]  = useState("General");

  const location   = useLocation();
  const navigation = useNavigation();
  const isHome     = location.pathname.startsWith("/home");
  const isSelect   = location.pathname === "/select";
  const isLoading  = navigation.state === "loading";

  useEffect(() => {
    const goOnline  = () => setIsOffline(false);
    const goOffline = () => { setIsOffline(true); setOfflineSnack(true); };
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const openWizard = (service: string) => { setSelectedSvc(service); setWizardOpen(true); };
  const toggleOffline = () => { const next = !isOffline; setIsOffline(next); if (next) setOfflineSnack(true); };
  const ctx: RootContext = { isOffline, openWizard, toggleOffline };

  const fontFamily = lang === "ar"
    ? "'Cairo', 'Inter', sans-serif"
    : "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

  // ── App selector: full-screen, no phone shell ─────────────────────────────
  if (isSelect) {
    return <Outlet context={ctx} />;
  }

  return (
    <div
      className="min-h-screen flex items-start justify-center"
      style={{ background: "linear-gradient(135deg, #1e293b 0%, #334155 50%, #1e1b4b 100%)" }}
    >
      {/* BG watermark */}
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none select-none opacity-5">
        <span className="text-white" style={{ fontSize: "180px", fontWeight: 900, letterSpacing: "-0.05em" }}>FN</span>
      </div>

      {/* Phone container */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={lang}
          dir={dir}
          className={`relative w-full flex flex-col overflow-hidden shadow-2xl transition-colors duration-300 ${darkMode ? "dark bg-slate-900" : "bg-white"}`}
          style={{
            maxWidth:  "430px",
            minHeight: "100svh",
            fontFamily,
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 80px rgba(0,0,0,0.6)",
          }}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
        >
          <div className="flex-1 flex flex-col transition-opacity duration-150" style={{ opacity: isLoading ? 0.5 : 1 }}>
            <Outlet context={ctx} />
          </div>

          {isHome && (
            <JobWizardModal service={selectedSvc} isOpen={wizardOpen} onClose={() => setWizardOpen(false)} isOffline={isOffline} />
          )}

          <Snackbar
            visible={offlineSnack}
            variant="offline"
            message={t("offlineBanner")}
            action={{ label: t("retry"), onClick: () => setOfflineSnack(false) }}
            onDismiss={() => setOfflineSnack(false)}
            duration={5000}
          />
        </motion.div>
      </AnimatePresence>

      {/* Desktop label */}
      <div className="fixed bottom-6 left-0 right-0 flex justify-center pointer-events-none">
        <div className="flex items-center gap-2 bg-white/10 backdrop-blur rounded-full px-4 py-2 border border-white/10">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-white/60" style={{ fontSize: "11px", fontWeight: 500, fontFamily: "'Inter', sans-serif" }}>
            FixNow · Mobile PWA · 430px
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Public Root ─────────────────────────────────────────────────────────────
export function Root() {
  return (
    <LanguageProvider>
      <EcosystemProvider>
        <RootInner />
      </EcosystemProvider>
    </LanguageProvider>
  );
}