import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ChevronLeft,
  ChevronRight,
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  Phone,
  AlertCircle,
  CheckCircle2,
  Send,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '../ds/Button';
import { TextField } from '../ds/TextField';
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
function AuthTopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="sticky top-0 z-20 bg-white/96 backdrop-blur-md flex items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-100 shadow-sm">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
        >
          <BackChevron />
        </button>
        <h2 className="text-slate-900" style={{ fontSize: '16px', fontWeight: 700 }}>
          {title}
        </h2>
      </div>
      <LangToggle />
    </div>
  );
}

// ─── Password Strength ────────────────────────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  const score =
    (password.length >= 8 ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);

  const config = [
    { label: 'Too short', labelAr: 'قصير جداً', color: 'bg-slate-200' },
    { label: 'Weak', labelAr: 'ضعيفة', color: 'bg-red-500' },
    { label: 'Fair', labelAr: 'مقبولة', color: 'bg-amber-500' },
    { label: 'Good', labelAr: 'جيدة', color: 'bg-yellow-400' },
    { label: 'Strong', labelAr: 'قوية', color: 'bg-green-500' },
  ];

  const { lang } = useLang();
  if (!password) return null;

  return (
    <div className="flex items-center gap-3 mt-1.5 px-1">
      <div className="flex gap-1 flex-1">
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={`flex-1 h-1 rounded-full transition-all duration-300 ${
              level <= score ? config[score].color : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      <span className="text-slate-500 flex-shrink-0" style={{ fontSize: '11px', fontWeight: 500 }}>
        {lang === 'ar' ? config[score].labelAr : config[score].label}
      </span>
    </div>
  );
}

// ─── Swipeable wrapper ────────────────────────────────────────────────────────
function SwipeableScreen({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
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

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────
interface LoginProps {
  onLogin: () => void;
  onSignUp: () => void;
  onForgotPassword: () => void;
}

export function LoginScreen({ onLogin, onSignUp, onForgotPassword }: LoginProps) {
  const { t } = useLang();
  const navigate = useNavigate();
  const [email, setEmail] = useState('ahmed@fixnow.app');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>();

  const handleLogin = () => {
    if (!email || !password) {
      setEmailError(t('emailAddress') + ' / ' + t('password'));
      return;
    }
    setEmailError(undefined);
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      if (email.trim() === 'ahmed@fixnow.app' && password === 'password') {
        onLogin();
      } else {
        setEmailError('Invalid credentials. Hint: "ahmed@fixnow.app" / "password"');
      }
    }, 1600);
  };

  return (
    <div className="flex flex-col bg-white" style={{ minHeight: '100svh' }}>
      {/* ── Gradient Hero ── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 via-amber-500 to-orange-600 px-6 pt-16 pb-20">
        <div className="absolute -top-12 -end-12 w-48 h-48 rounded-full bg-white/10" />
        <div className="absolute -bottom-8 start-8 w-32 h-32 rounded-full bg-orange-600/40" />
        <div className="absolute top-8 end-28 w-16 h-16 rounded-full bg-white/10" />

        {/* Language toggle — top-right corner */}
        <div className="absolute top-5 end-5">
          <LangToggle />
        </div>

        {/* Back to app selector — top-left */}
        <button
          onClick={() => navigate('/select')}
          className="absolute top-5 start-5 flex items-center gap-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all rounded-xl px-3 py-2 border border-white/20"
        >
          <ArrowLeft size={14} className="text-white rtl:rotate-180" />
          <span className="text-white/90" style={{ fontSize: '12px', fontWeight: 600 }}>
            Apps
          </span>
        </button>

        <div className="relative flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center mb-4 shadow-xl shadow-orange-900/20">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <h1 className="text-white" style={{ fontSize: '28px', fontWeight: 800 }}>
            {t('appName')}
          </h1>
          <p className="text-white/70 mt-1" style={{ fontSize: '13px' }}>
            {t('appTagline')}
          </p>
        </div>
      </div>

      {/* ── Card ── */}
      <div className="flex-1 bg-white rounded-t-3xl -mt-6 px-6 pt-8 pb-6">
        <h2 className="text-slate-900 mb-1" style={{ fontSize: '22px', fontWeight: 800 }}>
          {t('welcomeBack')}
        </h2>
        <p className="text-slate-400 mb-6" style={{ fontSize: '14px' }}>
          {t('signInContinue')}
        </p>

        <div className="flex flex-col gap-4">
          <TextField
            label={t('emailAddress')}
            type="email"
            value={email}
            onChange={setEmail}
            error={emailError}
            leadingIcon={<Mail size={16} />}
          />

          <TextField
            label={t('password')}
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={setPassword}
            leadingIcon={<Lock size={16} />}
            trailingIcon={
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="flex items-center justify-center w-5 h-5"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />

          <div className="flex justify-end -mt-2">
            <button
              onClick={onForgotPassword}
              className="text-amber-600 active:opacity-70 transition-opacity"
              style={{ fontSize: '13px', fontWeight: 600 }}
            >
              {t('forgotPassword')}
            </button>
          </div>

          <Button
            variant="primary"
            state={isLoading ? 'loading' : 'default'}
            fullWidth
            onClick={handleLogin}
          >
            {t('login')}
          </Button>

          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-2xl px-3.5 py-3">
            <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-amber-700" style={{ fontSize: '12px', lineHeight: '1.5' }}>
              <strong>{t('demoLogin')}:</strong> ahmed@fixnow.app &nbsp;/&nbsp; password
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-slate-400" style={{ fontSize: '11px' }}>
              {t('orContinueWith')}
            </span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              className="h-12 rounded-2xl border-2 border-slate-200 flex items-center justify-center gap-2 text-slate-700 active:bg-slate-50 transition-all"
              style={{ fontSize: '13px', fontWeight: 600 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google
            </button>
            <button
              className="h-12 rounded-2xl border-2 border-slate-200 flex items-center justify-center gap-2 text-slate-700 active:bg-slate-50 transition-all"
              style={{ fontSize: '13px', fontWeight: 600 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
              </svg>
              Apple
            </button>
          </div>

          <p className="text-center text-slate-500 pb-2" style={{ fontSize: '14px' }}>
            {t('noAccount')}{' '}
            <button
              onClick={onSignUp}
              className="text-amber-600 active:opacity-70"
              style={{ fontWeight: 700 }}
            >
              {t('signUp')}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN UP SCREEN
// ─────────────────────────────────────────────────────────────────────────────
interface SignUpProps {
  onBack: () => void;
  onSuccess: () => void;
}

export function SignUpScreen({ onBack, onSuccess }: SignUpProps) {
  const { t } = useLang();
  const [step, setStep] = useState(1); // wizard step 1-3
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const canStep1 = name.length > 2 && phone.length > 7;
  const canStep2 = email.includes('@') && password.length >= 8 && agreed;
  const canStep3 = otp.length === 4;

  const goNext = () => {
    if (step < 3) setStep((s) => s + 1);
    else {
      setIsLoading(true);
      setTimeout(() => {
        setIsLoading(false);
        onSuccess();
      }, 1500);
    }
  };

  const stepLabels = [t('accountInfo'), t('verification'), t('allSet')];

  return (
    <SwipeableScreen onBack={step > 1 ? () => setStep((s) => s - 1) : onBack}>
      <div className="flex flex-col bg-white" style={{ height: '100svh' }}>
        <AuthTopBar
          title={t('createAccount')}
          onBack={step > 1 ? () => setStep((s) => s - 1) : onBack}
        />

        <div className="flex-1 overflow-y-auto px-6 py-6" style={{ scrollbarWidth: 'none' }}>
          <div className="mb-6">
            <h2 className="text-slate-900 mb-1" style={{ fontSize: '22px', fontWeight: 800 }}>
              {t('letsGetStarted')}
            </h2>
            <p className="text-slate-400" style={{ fontSize: '14px' }}>
              {t('fillDetails')}
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {stepLabels.map((label, i) => (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div
                  className={`flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 transition-all ${
                    i + 1 < step
                      ? 'bg-amber-500 text-white'
                      : i + 1 === step
                        ? 'bg-amber-500 text-white ring-2 ring-amber-200'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                  style={{ fontSize: '11px', fontWeight: 800 }}
                >
                  {i + 1 < step ? (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: i + 1 <= step ? 700 : 400,
                    color: i + 1 <= step ? '#F59E0B' : '#94a3b8',
                  }}
                >
                  {label}
                </span>
                {i < 2 && (
                  <div
                    className={`flex-1 h-0.5 rounded-full ${i + 1 < step ? 'bg-amber-300' : 'bg-slate-100'}`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* ── Step 1: Personal Info ── */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <TextField
                label={t('fullName')}
                value={name}
                onChange={setName}
                leadingIcon={<User size={16} />}
                hint={t('nameOnId')}
              />
              <TextField
                label={t('phoneNumber')}
                type="tel"
                value={phone}
                onChange={setPhone}
                leadingIcon={<Phone size={16} />}
                hint={t('phoneHint')}
              />
              {/* Location row */}
              <div className="bg-slate-50 rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-amber-600" style={{ fontSize: '16px' }}>
                    📍
                  </span>
                </div>
                <div>
                  <p className="text-slate-700" style={{ fontSize: '13px', fontWeight: 600 }}>
                    Riyadh, Saudi Arabia
                  </p>
                  <p className="text-slate-400" style={{ fontSize: '11px' }}>
                    Auto-detected location
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Account Credentials ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <TextField
                label={t('emailAddress')}
                type="email"
                value={email}
                onChange={setEmail}
                leadingIcon={<Mail size={16} />}
              />
              <div>
                <TextField
                  label={t('password')}
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={setPassword}
                  leadingIcon={<Lock size={16} />}
                  hint={t('minPassword')}
                  trailingIcon={
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="flex items-center justify-center w-5 h-5"
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                <PasswordStrength password={password} />
              </div>

              <button
                onClick={() => setAgreed((v) => !v)}
                className="flex items-start gap-3 text-start active:opacity-80 transition-opacity"
              >
                <div
                  className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${
                    agreed ? 'bg-amber-500 border-amber-500' : 'border-slate-300 bg-white'
                  }`}
                >
                  {agreed && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <p className="text-slate-500" style={{ fontSize: '13px', lineHeight: '1.5' }}>
                  {t('agreeTerms')}{' '}
                  <span className="text-amber-600 font-semibold">{t('termsConditions')}</span>{' '}
                  {t('andWord')}{' '}
                  <span className="text-amber-600 font-semibold">{t('privacyPolicy')}</span>
                </p>
              </button>
            </div>
          )}

          {/* ── Step 3: OTP Verification ── */}
          {step === 3 && (
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-amber-100 flex items-center justify-center">
                <Phone size={32} className="text-amber-500" />
              </div>
              <div>
                <h3 className="text-slate-900" style={{ fontSize: '18px', fontWeight: 800 }}>
                  Verify Your Number
                </h3>
                <p className="text-slate-400 mt-1" style={{ fontSize: '13px' }}>
                  {phone ? `Code sent to ${phone}` : 'Enter the 4-digit OTP'}
                </p>
              </div>
              {/* OTP boxes */}
              <div className="flex gap-3 mt-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all ${
                      otp.length > i
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-slate-200 bg-slate-50'
                    }`}
                    style={{ fontSize: '24px', fontWeight: 700, color: '#F59E0B' }}
                  >
                    {otp[i] ?? ''}
                  </div>
                ))}
              </div>
              {/* Hidden number input driving OTP */}
              <input
                type="number"
                maxLength={4}
                value={otp}
                onChange={(e) => setOtp(e.target.value.slice(0, 4))}
                className="sr-only"
                autoFocus
              />
              <button
                onClick={() => setOtp('1234')}
                className="text-amber-600 active:opacity-70"
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                Use Demo OTP: 1234
              </button>
              <div className="flex items-start gap-2 bg-green-50 border border-green-100 rounded-2xl px-4 py-3 w-full text-start">
                <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
                <p className="text-green-700" style={{ fontSize: '12px' }}>
                  Your account is almost ready! Tap confirm to get started.
                </p>
              </div>
            </div>
          )}

          <div className="h-4" />
        </div>

        {/* Sticky bottom CTA */}
        <div className="bg-white border-t border-slate-100 px-6 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
          <Button
            variant="primary"
            state={
              isLoading
                ? 'loading'
                : (step === 1 && !canStep1) ||
                    (step === 2 && !canStep2) ||
                    (step === 3 && !canStep3)
                  ? 'disabled'
                  : 'default'
            }
            fullWidth
            onClick={goNext}
            leadingIcon={step < 3 ? <ArrowRight size={16} /> : <CheckCircle2 size={16} />}
          >
            {step === 3 ? t('register') : t('next')}
          </Button>
          <p className="text-center text-slate-400 mt-3" style={{ fontSize: '12px' }}>
            {t('alreadyHaveAccount')}{' '}
            <button onClick={onBack} className="text-amber-600 font-semibold">
              {t('login')}
            </button>
          </p>
        </div>
      </div>
    </SwipeableScreen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD SCREEN
// ─────────────────────────────────────────────────────────────────────────────
interface ForgotPwProps {
  onBack: () => void;
}

export function ForgotPasswordScreen({ onBack }: ForgotPwProps) {
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSend = () => {
    if (!email) return;
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setSubmitted(true);
    }, 1500);
  };

  return (
    <SwipeableScreen onBack={onBack}>
      <div className="flex flex-col bg-white" style={{ minHeight: '100svh' }}>
        <AuthTopBar title={t('resetPassword')} onBack={onBack} />

        <div className="flex-1 px-6 py-8">
          {submitted ? (
            <div className="flex flex-col items-center text-center py-8">
              <div className="relative mb-6">
                <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 size={44} className="text-green-500" />
                </div>
                <div className="absolute -top-1 -end-1 w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center shadow-md">
                  <Send size={14} className="text-white" />
                </div>
              </div>
              <h2 className="text-slate-900 mb-2" style={{ fontSize: '22px', fontWeight: 800 }}>
                {t('checkInbox')}
              </h2>
              <p
                className="text-slate-400 mb-2 max-w-[260px]"
                style={{ fontSize: '14px', lineHeight: '1.6' }}
              >
                {t('sentResetTo')}
              </p>
              <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-2 mb-8">
                <Mail size={14} className="text-amber-600" />
                <span className="text-amber-700" style={{ fontSize: '14px', fontWeight: 600 }}>
                  {email}
                </span>
              </div>
              <Button variant="primary" fullWidth onClick={onBack}>
                {t('backToLogin')}
              </Button>
              <div className="mt-4">
                <Button variant="text" onClick={() => setSubmitted(false)}>
                  {t('resendEmail')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex justify-center mb-6">
                <div className="relative">
                  <div className="w-20 h-20 rounded-2xl bg-amber-100 flex items-center justify-center">
                    <Lock size={32} className="text-amber-500" />
                  </div>
                  <div className="absolute -top-2 -end-2 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shadow-md">
                    <Mail size={14} className="text-white" />
                  </div>
                </div>
              </div>

              <h2 className="text-slate-900 mb-2" style={{ fontSize: '22px', fontWeight: 800 }}>
                {t('forgotPasswordTitle')}
              </h2>
              <p className="text-slate-400 mb-8" style={{ fontSize: '14px', lineHeight: '1.7' }}>
                {t('forgotPasswordDesc')}
              </p>

              <div className="flex flex-col gap-5">
                <TextField
                  label={t('emailAddress')}
                  type="email"
                  value={email}
                  onChange={setEmail}
                  leadingIcon={<Mail size={16} />}
                />

                <Button
                  variant="primary"
                  state={isLoading ? 'loading' : !email ? 'disabled' : 'default'}
                  fullWidth
                  onClick={handleSend}
                  leadingIcon={<Send size={16} />}
                >
                  {t('sendResetLink')}
                </Button>

                <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                  <AlertCircle size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
                  <p className="text-slate-500" style={{ fontSize: '12px', lineHeight: '1.5' }}>
                    {t('resetExpiry')}
                  </p>
                </div>

                <div className="flex justify-center mt-2">
                  <Button variant="text" onClick={onBack}>
                    {t('backToLogin')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </SwipeableScreen>
  );
}
