import { MotionConfig, motion } from 'motion/react';
import { Link, useNavigate } from 'react-router';
import { Smartphone, Monitor, Wrench, ArrowLeft, ArrowRight, Zap } from 'lucide-react';
import { type IntendedApp, INTENDED_APP_PATHS, setIntendedApp } from '../../lib/intended-app';
import { LangToggle, useLang } from '../i18n/LanguageContext';
import {
  LEGAL_PAGE_IDS,
  LEGAL_PAGES,
  legalPath,
} from '../features/legal/copy/legal-documents.copy';

// K02 — the public entry page. One brand (translations `appName`), Arabic
// and English copy, a reachable language switch, and links to the public
// legal pages. Internal viewport/developer labels ("430px mobile PWA",
// "Desktop 1440px", an internal project name) are gone: they described how
// the prototype was built, not what a visitor can do.

type Lang = 'en' | 'ar';

interface AppCard {
  id: IntendedApp;
  path: string;
  gradient: string;
  border: string;
  icon: React.ReactNode;
}

const APPS: AppCard[] = [
  {
    id: 'seeker',
    path: INTENDED_APP_PATHS.seeker,
    gradient: 'from-amber-500 via-orange-500 to-red-500',
    border: 'border-amber-400/30',
    icon: <Smartphone size={28} className="text-white" aria-hidden="true" />,
  },
  {
    id: 'provider',
    path: INTENDED_APP_PATHS.provider,
    gradient: 'from-blue-600 via-indigo-600 to-purple-700',
    border: 'border-blue-400/30',
    icon: <Wrench size={28} className="text-white" aria-hidden="true" />,
  },
  {
    id: 'admin',
    path: INTENDED_APP_PATHS.admin,
    gradient: 'from-slate-700 via-slate-800 to-slate-900',
    border: 'border-slate-400/20',
    icon: <Monitor size={28} className="text-white" aria-hidden="true" />,
  },
];

const COPY: Record<
  Lang,
  {
    tagline: string;
    heading: string;
    sub: string;
    open: string;
    footerNav: string;
    cards: Record<IntendedApp, { label: string; sub: string; tags: string[] }>;
  }
> = {
  en: {
    tagline: 'Home services in Saudi Arabia',
    heading: 'How do you want to use the app?',
    sub: 'Request a service, offer your services as a professional, or manage the platform.',
    open: 'Continue',
    footerNav: 'Legal and contact',
    cards: {
      seeker: {
        label: 'I need a service',
        sub: 'Post a request and compare offers',
        tags: ['Post a request', 'Compare offers', 'Bookings', 'Messages'],
      },
      provider: {
        label: 'I am a professional',
        sub: 'Find jobs and send offers',
        tags: ['Nearby jobs', 'Send offers', 'Bookings', 'Booking values'],
      },
      admin: {
        label: 'Administration',
        sub: 'For authorised platform staff',
        tags: ['Reviews', 'Verification', 'Financial reports', 'Disputes'],
      },
    },
  },
  ar: {
    tagline: 'الخدمات المنزلية في المملكة العربية السعودية',
    heading: 'كيف تريد استخدام التطبيق؟',
    sub: 'اطلب خدمة، أو قدّم خدماتك كمحترف، أو أدِر المنصة.',
    open: 'متابعة',
    footerNav: 'المعلومات القانونية والتواصل',
    cards: {
      seeker: {
        label: 'أحتاج إلى خدمة',
        sub: 'انشر طلباً وقارن العروض',
        tags: ['نشر طلب', 'مقارنة العروض', 'الحجوزات', 'الرسائل'],
      },
      provider: {
        label: 'أنا مقدّم خدمة',
        sub: 'اعثر على أعمال وأرسل عروضك',
        tags: ['أعمال قريبة', 'إرسال العروض', 'الحجوزات', 'قيم الحجوزات'],
      },
      admin: {
        label: 'الإدارة',
        sub: 'لموظفي المنصة المخوّلين',
        tags: ['المراجعات', 'التحقق', 'التقارير المالية', 'النزاعات'],
      },
    },
  },
};

function renderAppCard(
  app: AppCard,
  idx: number,
  navigate: ReturnType<typeof useNavigate>,
  lang: Lang,
) {
  const copy = COPY[lang];
  const card = copy.cards[app.id];
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight;
  return (
    <motion.div
      key={app.id}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: idx * 0.1 + 0.2 }}
    >
      <motion.button
        type="button"
        whileHover={{ scale: 1.02, y: -4 }}
        whileTap={{ scale: 0.98 }}
        data-testid={`app-card-${app.id}`}
        onClick={() => {
          // Persist the user's choice so any subsequent auth detour
          // (login, signup, OTP, forgot/reset, verify-email) can route
          // the user back to the SAME experience they picked.
          setIntendedApp(app.id);
          // RequireAuth handles the redirect to /login (with returnTo
          // preserved) when the route is protected.
          navigate(app.path);
        }}
        className={`w-full group flex flex-col rounded-3xl border ${app.border} overflow-hidden cursor-pointer text-start relative focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-400`}
        style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(10px)' }}
      >
        <div className={`bg-gradient-to-br ${app.gradient} p-6 pb-8 relative overflow-hidden`}>
          <div className="absolute -top-8 -end-8 w-32 h-32 rounded-full bg-white/10" />
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center mb-4 shadow-lg">
              {app.icon}
            </div>
            <h3 className="text-white mb-1" style={{ fontSize: '20px', fontWeight: 800 }}>
              {card.label}
            </h3>
            <p className="text-white/85" style={{ fontSize: '14px' }}>
              {card.sub}
            </p>
          </div>
        </div>
        <div className="p-5 flex flex-col gap-4 flex-1">
          <ul className="flex flex-wrap gap-1.5">
            {card.tags.map((tag) => (
              <li
                key={tag}
                className="px-2.5 py-1 rounded-lg bg-white/8 border border-white/8 text-slate-200"
                style={{ fontSize: '13px', fontWeight: 500 }}
              >
                {tag}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end mt-auto pt-2">
            <span
              className="flex items-center gap-1.5 text-amber-300 group-hover:text-amber-200"
              style={{ fontSize: '15px', fontWeight: 700 }}
            >
              {copy.open} <Arrow size={16} aria-hidden="true" />
            </span>
          </div>
        </div>
      </motion.button>
    </motion.div>
  );
}

export function AppSelector() {
  const navigate = useNavigate();
  const { lang: rawLang, t } = useLang();
  const lang: Lang = rawLang === 'ar' ? 'ar' : 'en';
  const copy = COPY[lang];
  const primary = APPS.filter((a) => a.id === 'seeker' || a.id === 'provider');
  const secondary = APPS.filter((a) => a.id === 'admin');

  return (
    // Entrance motion is decorative: honour prefers-reduced-motion.
    <MotionConfig reducedMotion="user">
      <div
        className="min-h-screen flex flex-col items-center px-6 py-6"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}
      >
        <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div
            className="absolute top-1/4 start-1/3 w-96 h-96 rounded-full blur-3xl opacity-10"
            style={{ background: '#F59E0B' }}
          />
          <div
            className="absolute bottom-1/4 end-1/4 w-80 h-80 rounded-full blur-3xl opacity-10"
            style={{ background: '#6366f1' }}
          />
        </div>

        <div className="relative w-full max-w-5xl flex justify-end" data-testid="selector-lang">
          <LangToggle />
        </div>

        <main className="relative w-full max-w-5xl flex-1 flex flex-col justify-center py-8">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-3 mb-5">
              <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-amber-900/50">
                <Zap size={26} className="text-white" aria-hidden="true" />
              </div>
              <div className="text-start">
                <p
                  className="text-white"
                  style={{ fontSize: '28px', fontWeight: 900, letterSpacing: '-0.02em' }}
                  data-testid="selector-brand"
                >
                  {t('appName')}
                </p>
                <p className="text-slate-300" style={{ fontSize: '14px' }}>
                  {copy.tagline}
                </p>
              </div>
            </div>
            <h1
              className="text-white mb-3"
              style={{ fontSize: 'clamp(26px, 6vw, 36px)', fontWeight: 800, lineHeight: 1.25 }}
            >
              {copy.heading}
            </h1>
            <p className="text-slate-300 mx-auto max-w-xl" style={{ fontSize: '16px' }}>
              {copy.sub}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5" data-testid="app-cards-primary">
            {primary.map((app, idx) => renderAppCard(app, idx, navigate, lang))}
          </div>
          <div className="mt-5 max-w-md mx-auto w-full" data-testid="app-cards-secondary">
            {secondary.map((app, idx) => renderAppCard(app, primary.length + idx, navigate, lang))}
          </div>
        </main>

        <footer className="relative w-full max-w-5xl pt-6">
          <nav aria-label={copy.footerNav}>
            <ul className="flex flex-wrap justify-center gap-x-2 gap-y-1">
              {LEGAL_PAGE_IDS.map((id) => (
                <li key={id}>
                  <Link
                    to={legalPath(id)}
                    className="inline-flex min-h-11 items-center px-2 text-slate-300 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                    style={{ fontSize: '14px' }}
                  >
                    {LEGAL_PAGES[id][lang].title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </footer>
      </div>
    </MotionConfig>
  );
}
