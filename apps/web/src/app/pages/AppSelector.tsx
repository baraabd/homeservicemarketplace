import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Smartphone, Monitor, Wrench, ArrowRight, Zap, Shield, Globe } from 'lucide-react';
import { type IntendedApp, INTENDED_APP_PATHS, setIntendedApp } from '../../lib/intended-app';

interface AppCard {
  id: IntendedApp;
  label: string;
  sub: string;
  path: string;
  gradient: string;
  border: string;
  icon: React.ReactNode;
  badge?: string;
  badgeBg?: string;
  tags: string[];
}

const APPS: AppCard[] = [
  {
    id: 'seeker',
    label: 'Seeker App',
    sub: 'Client · Home Services Platform',
    path: INTENDED_APP_PATHS.seeker,
    gradient: 'from-amber-500 via-orange-500 to-red-500',
    border: 'border-amber-400/30',
    icon: <Smartphone size={28} className="text-white" />,
    badge: 'Mobile PWA',
    badgeBg: 'bg-amber-400/20 text-amber-200',
    tags: ['Post Jobs', 'Compare Bids', 'Track Pro', 'Payments'],
  },
  {
    id: 'provider',
    label: 'Provider App',
    sub: 'Professional · Earnings Platform',
    path: INTENDED_APP_PATHS.provider,
    gradient: 'from-blue-600 via-indigo-600 to-purple-700',
    border: 'border-blue-400/30',
    icon: <Wrench size={28} className="text-white" />,
    badge: 'Map-Centric',
    badgeBg: 'bg-blue-400/20 text-blue-200',
    tags: ['Live Job Map', 'Bid Engine', 'Wallet', 'Analytics'],
  },
  {
    id: 'admin',
    label: 'Admin Dashboard',
    sub: 'Platform Control · Maharah',
    path: INTENDED_APP_PATHS.admin,
    gradient: 'from-slate-700 via-slate-800 to-slate-900',
    border: 'border-slate-400/20',
    icon: <Monitor size={28} className="text-white" />,
    badge: 'Desktop 1440px',
    badgeBg: 'bg-slate-400/20 text-slate-300',
    tags: ['KPIs', 'Pro Verification', 'Financials', 'Disputes'],
  },
];

export function AppSelector() {
  const navigate = useNavigate();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}
    >
      {/* BG decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full blur-3xl opacity-10"
          style={{ background: '#F59E0B' }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl opacity-10"
          style={{ background: '#6366f1' }}
        />
      </div>

      <div className="relative w-full max-w-5xl">
        {/* Header */}
        <motion.div
          className="text-center mb-14"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-3 mb-5">
            <div className="w-14 h-14 rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-amber-900/50">
              <Zap size={26} className="text-white" />
            </div>
            <div className="text-start">
              <h1
                className="text-white"
                style={{ fontSize: '28px', fontWeight: 900, letterSpacing: '-0.02em' }}
              >
                FixNow
              </h1>
              <p className="text-slate-400" style={{ fontSize: '13px' }}>
                Maharah · Full Ecosystem Platform
              </p>
            </div>
          </div>

          <h2
            className="text-white mb-3"
            style={{ fontSize: '36px', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2 }}
          >
            Choose your{' '}
            <span
              className="text-transparent bg-clip-text"
              style={{ backgroundImage: 'linear-gradient(135deg, #F59E0B, #f97316)' }}
            >
              experience
            </span>
          </h2>
          <p className="text-slate-400" style={{ fontSize: '15px' }}>
            Three interconnected apps — one seamless marketplace ecosystem
          </p>

          {/* Global badges */}
          <div className="flex items-center justify-center gap-3 mt-5">
            {[
              { icon: <Globe size={13} />, label: 'Bilingual AR/EN + RTL' },
              { icon: <Zap size={13} />, label: 'Real-time Ecosystem Flow' },
              { icon: <Shield size={13} />, label: 'Connected State' },
            ].map((b) => (
              <div
                key={b.label}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-slate-300"
                style={{ fontSize: '11px' }}
              >
                <span className="text-amber-400">{b.icon}</span>
                {b.label}
              </div>
            ))}
          </div>
        </motion.div>

        {/* App cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {APPS.map((app, idx) => (
            <motion.div
              key={app.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: idx * 0.1 + 0.2 }}
            >
              <motion.button
                whileHover={{ scale: 1.02, y: -4 }}
                whileTap={{ scale: 0.98 }}
                data-testid={`app-card-${app.id}`}
                onClick={() => {
                  // Persist the user's choice so any subsequent auth detour
                  // (login, signup, OTP, forgot/reset, verify-email) can
                  // route the user back to the SAME experience they picked.
                  // Without this layer, navigating through multiple auth
                  // pages drops react-router state and the user falls back
                  // to /home (Seeker) — which is exactly how Provider
                  // appeared to "open Seeker by mistake".
                  setIntendedApp(app.id);
                  // Always navigate to the app's own path. RequireAuth
                  // handles the redirect to /login (with returnTo preserved)
                  // when the route is protected and the user is not yet
                  // authenticated. Symmetric handling keeps Seeker /
                  // Provider on the same code path so a future regression
                  // in one is harder to miss for the other.
                  navigate(app.path);
                }}
                className={`w-full group flex flex-col rounded-3xl border ${app.border} overflow-hidden cursor-pointer text-start relative`}
                style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(10px)' }}
              >
                {/* Card gradient header */}
                <div
                  className={`bg-gradient-to-br ${app.gradient} p-6 pb-8 relative overflow-hidden`}
                >
                  <div className="absolute -top-8 -end-8 w-32 h-32 rounded-full bg-white/10" />
                  <div className="absolute top-2 end-2">
                    <span
                      className={`px-2.5 py-1 rounded-full ${app.badgeBg} backdrop-blur-sm`}
                      style={{ fontSize: '10px', fontWeight: 700 }}
                    >
                      {app.badge}
                    </span>
                  </div>
                  <div className="relative">
                    <div className="w-14 h-14 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center mb-4 shadow-lg">
                      {app.icon}
                    </div>
                    <h3 className="text-white mb-1" style={{ fontSize: '20px', fontWeight: 800 }}>
                      {app.label}
                    </h3>
                    <p className="text-white/60" style={{ fontSize: '12px' }}>
                      {app.sub}
                    </p>
                  </div>
                </div>

                {/* Card body */}
                <div className="p-5 flex flex-col gap-4 flex-1">
                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {app.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-1 rounded-lg bg-white/8 border border-white/8 text-slate-300"
                        style={{ fontSize: '11px', fontWeight: 500 }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* CTA */}
                  <div className="flex items-center justify-between mt-auto pt-2">
                    <span className="text-slate-400" style={{ fontSize: '12px' }}>
                      {app.id === 'admin' ? 'Full-width desktop view' : '430px mobile PWA'}
                    </span>
                    <motion.div
                      className="flex items-center gap-1.5 text-amber-400 group-hover:text-amber-300"
                      animate={{ x: 0 }}
                      whileHover={{ x: 3 }}
                      style={{ fontSize: '13px', fontWeight: 700 }}
                    >
                      Launch <ArrowRight size={14} />
                    </motion.div>
                  </div>
                </div>
              </motion.button>
            </motion.div>
          ))}
        </div>

        {/* Footer note */}
        <motion.p
          className="text-center text-slate-500 mt-10"
          style={{ fontSize: '12px' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          Cross-app state is shared in real-time — actions in one app reflect instantly in all
          others
        </motion.p>
      </div>
    </div>
  );
}
