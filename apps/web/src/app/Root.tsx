import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Outlet, useLocation, useNavigate, useNavigation, useOutletContext } from 'react-router';
import { JobWizardModal } from './components/wizard/JobWizardModal';
import { Snackbar } from './components/ds/Snackbar';
import { Toaster } from './components/ui/sonner';
import { LanguageProvider, useLang } from './i18n/LanguageContext';
import { EcosystemProvider } from './context/EcosystemContext';
import { setRealtimeLang } from '../lib/realtime/realtime-i18n';
import { setRealtimeNavigator } from '../lib/realtime/realtime-navigator';
import { setRealtimeExperience } from '../lib/realtime/realtime-experience';
import './styles/toast-theme.css';

// ─── Shared outlet-context type ───────────────────────────────────────────────
export interface RootContext {
  isOffline: boolean;
  // `categoryId` is the backend ServiceCategory.id when the wizard is
  // opened from a real catalog tile; null when opened from the
  // free-form CTAs (search bar, "Post a new job" etc.) so the
  // resulting request is created with customServiceText.
  openWizard: (service: string, categoryId?: string | null) => void;
  toggleOffline: () => void;
}

export function useRootContext() {
  return useOutletContext<RootContext>();
}

// ─── Inner layout (needs lang context) ───────────────────────────────────────
function RootInner() {
  const { lang, dir, t, darkMode } = useLang();

  const [isOffline, setIsOffline] = useState(false);
  const [offlineSnack, setOfflineSnack] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedSvc, setSelectedSvc] = useState('General');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const location = useLocation();
  const navigation = useNavigation();
  const isHome = location.pathname.startsWith('/home');
  const isSelect = location.pathname === '/select';
  const isProvider = location.pathname.startsWith('/provider');
  const isLoading = navigation.state === 'loading';

  // Sprint 7.12 — bridge the active experience to realtime-experience
  // so the side-effects dispatcher (mounted above Router by
  // AuthProvider) renders toasts with the correct brand variant.
  // Provider routes → 'provider' (blue). Everything else → 'seeker'
  // (orange/amber). The bridge runs in an effect so the write
  // happens on every navigation; the read site is a pure function
  // call from any callsite.
  useEffect(() => {
    setRealtimeExperience(isProvider ? 'provider' : 'seeker');
  }, [isProvider]);

  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => {
      setIsOffline(true);
      setOfflineSnack(true);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Sprint 7.5.1 — bridge the active language into the framework-
  // independent realtime-i18n module so the side-effects dispatcher
  // (mounted by AuthProvider, OUTSIDE LanguageProvider) can localise
  // toast copy without calling useLang(). The bridge runs in an
  // effect so the write happens at mount time and on every flip;
  // the read site is a pure function call from any callsite.
  useEffect(() => {
    setRealtimeLang(lang === 'ar' ? 'ar' : 'en');
  }, [lang]);

  // Sprint 7.10 — same bridge pattern for navigation. The side-
  // effects dispatcher needs to navigate when the user clicks a
  // toast's action button, but the dispatcher is mounted ABOVE the
  // Router (AuthProvider scope). RootInner sits INSIDE the Router,
  // so `useNavigate()` works here; we register the navigator in a
  // module-level holder that the toast onClick reads via
  // `getRealtimeNavigator()`. Cleanup on unmount clears the holder
  // so a logged-out app doesn't navigate from a stale toast.
  const navigate = useNavigate();
  useEffect(() => {
    setRealtimeNavigator((deepLink) => navigate(deepLink));
    return () => setRealtimeNavigator(null);
  }, [navigate]);

  const openWizard = (service: string, categoryId: string | null = null) => {
    setSelectedSvc(service);
    setSelectedCategoryId(categoryId);
    setWizardOpen(true);
  };
  const toggleOffline = () => {
    const next = !isOffline;
    setIsOffline(next);
    if (next) setOfflineSnack(true);
  };
  const ctx: RootContext = { isOffline, openWizard, toggleOffline };

  const fontFamily =
    lang === 'ar'
      ? "'Cairo', 'Inter', sans-serif"
      : "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

  // ── Provider: full-screen, no phone shell ─────────────────────────────────
  //
  // Mode B. The phone frame below caps EVERY non-/select route at 430px on a
  // dark gradient, so at 1440 the provider application was a narrow strip with
  // roughly 70% of the viewport spent on decoration — a provider comparing
  // bids or reconciling earnings on a laptop did it through a phone-shaped
  // slot. Admin already opts out by living outside this layout; Provider is
  // the surface people work in all day and had no such exemption.
  //
  // Opting out here rather than widening the frame keeps the Seeker experience
  // exactly as it is: the phone shell is deliberate there, and this changes
  // nothing about it.
  //
  // The provider surfaces own their own width from here — see the shells,
  // which centre content on a readable measure instead of stretching a phone
  // column across a desktop.
  if (isProvider) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900" style={{ fontFamily }} dir={dir}>
        <Outlet context={ctx} />
        <Toaster
          position="top-center"
          richColors
          closeButton
          toastOptions={{ className: 'hsm-toast hsm-toast--provider' }}
        />
      </div>
    );
  }

  // ── App selector: full-screen, no phone shell ─────────────────────────────
  if (isSelect) {
    return (
      <>
        <Outlet context={ctx} />
        <Toaster
          position="top-center"
          richColors
          closeButton
          // Sprint 7.12 — even outside the phone shell, constrain
          // the toast width so the variant tokens land on the same
          // visual surface as the in-shell mount.
          className="hsm-toaster-shell"
          toastOptions={{ className: 'hsm-toast hsm-toast--seeker' }}
        />
      </>
    );
  }

  return (
    <div
      className="min-h-screen flex items-start justify-center"
      style={{ background: 'linear-gradient(135deg, #1e293b 0%, #334155 50%, #1e1b4b 100%)' }}
    >
      {/* BG watermark */}
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none select-none opacity-5">
        <span
          className="text-white"
          style={{ fontSize: '180px', fontWeight: 900, letterSpacing: '-0.05em' }}
        >
          FN
        </span>
      </div>

      {/* Phone container */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={lang}
          dir={dir}
          className={`relative w-full flex flex-col overflow-hidden shadow-2xl transition-colors duration-300 ${darkMode ? 'dark bg-slate-900' : 'bg-white'}`}
          style={{
            maxWidth: '430px',
            minHeight: '100svh',
            fontFamily,
            boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 32px 80px rgba(0,0,0,0.6)',
          }}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <div
            className="flex-1 flex flex-col transition-opacity duration-150"
            style={{ opacity: isLoading ? 0.5 : 1 }}
          >
            <Outlet context={ctx} />
          </div>

          {isHome && (
            <JobWizardModal
              service={selectedSvc}
              categoryId={selectedCategoryId}
              isOpen={wizardOpen}
              onClose={() => setWizardOpen(false)}
              isOffline={isOffline}
            />
          )}

          <Snackbar
            visible={offlineSnack}
            variant="offline"
            message={t('offlineBanner')}
            action={{ label: t('retry'), onClick: () => setOfflineSnack(false) }}
            onDismiss={() => setOfflineSnack(false)}
            duration={5000}
          />
        </motion.div>
      </AnimatePresence>
      {/* Sprint 7.x — toast surface used for graceful error handling
          (e.g. 409 on duplicate bid). Mounted once at the Root so any
          screen can call sonner's `toast.*` helpers without per-screen
          wiring.
          Sprint 7.12 — bounded to the phone-shell width via the
          `hsm-toaster-shell` viewport class so Provider toasts (and
          Seeker toasts on wide viewports) never overflow outside the
          app frame. The `hsm-toast--seeker` default flips to
          `hsm-toast--provider` per-emit via the side-effects
          dispatcher (the `experience` bridge picks the right variant
          for each toast). */}
      <Toaster
        position="top-center"
        richColors
        closeButton
        className="hsm-toaster-shell"
        toastOptions={{ className: 'hsm-toast hsm-toast--seeker' }}
      />

      {/* Desktop label — informational watermark visible only on
          screens wider than the phone container. On mobile it would
          overlay the bottom of the phone shell (auth signup's Next
          button + "Already have an account? Log in" link, the wizard's
          submit button, etc.) so we hide it below the md breakpoint. */}
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
