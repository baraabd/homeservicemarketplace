import { useEffect, useRef, useState } from 'react';
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
  MapPin,
  Send,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '../ds/Button';
import { TextField } from '../ds/TextField';
import { useSwipe } from '../../hooks/useSwipe';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
import { COUNTRY_DIAL_CODES, dialForCountry } from '../../../lib/country-dial-codes';
import { useGeoBootstrap } from '../../../lib/geo-bootstrap';

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

// ─── Email OTP panel (shared between Login and SignUp) ────────────────────
// Reuses the boxed OTP aesthetic from the project's design history: six
// amber-bordered squares that light up as digits arrive. Only the behavior
// is new — it consumes the real challengeId the backend returned and POSTs
// /v1/auth/verify-otp through the parent callback.
interface EmailOtpPanelProps {
  email: string;
  codeLength: number;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  isVerifying?: boolean;
  isResending?: boolean;
  verifyError?: string;
  resendNotice?: string;
}

export function EmailOtpPanel({
  email,
  codeLength,
  onVerify,
  onResend,
  isVerifying,
  isResending,
  verifyError,
  resendNotice,
}: EmailOtpPanelProps) {
  const [code, setCode] = useState('');
  const canSubmit = code.length === codeLength && !isVerifying;
  // Ref so any tap/click on the visual boxes can programmatically focus the
  // visually-hidden <input>. Without this, mobile users literally cannot
  // bring up the numeric keyboard (the input is sr-only — offscreen), and
  // desktop users lose focus after the initial autoFocus fires.
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = () => inputRef.current?.focus();

  return (
    <div className="flex flex-col items-center text-center gap-4">
      <div className="w-20 h-20 rounded-2xl bg-amber-100 flex items-center justify-center">
        <Mail size={32} className="text-amber-500" />
      </div>
      <div>
        <h3 className="text-slate-900" style={{ fontSize: '18px', fontWeight: 800 }}>
          Verify your email
        </h3>
        <p className="text-slate-400 mt-1" style={{ fontSize: '13px' }}>
          Enter the {codeLength}-digit code we sent
          {email ? (
            <>
              {' '}
              to{' '}
              <span className="text-slate-700" style={{ fontWeight: 600 }}>
                {email}
              </span>
              .
            </>
          ) : (
            '.'
          )}
        </p>
      </div>

      {/* Code boxes — identical aesthetic to the previous 4-box design,
          just wider to fit a 6-digit code. The container is a click-capture
          target that routes every tap to the real input; cursor: text
          signals "this is a text field" to users. Individual boxes pick up
          the click via event bubbling. */}
      <div
        className="flex gap-3 mt-2 cursor-text"
        onClick={focusInput}
        onTouchStart={focusInput}
        role="group"
        aria-label={`${codeLength}-digit verification code`}
      >
        {Array.from({ length: codeLength }).map((_, i) => (
          <div
            key={i}
            data-testid={`otp-box-${i}`}
            className={`w-12 h-14 rounded-2xl border-2 flex items-center justify-center transition-all ${
              code.length > i ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-slate-50'
            }`}
            style={{ fontSize: '24px', fontWeight: 700, color: '#F59E0B' }}
          >
            {code[i] ?? ''}
          </div>
        ))}
      </div>

      {/* Real text input, visually hidden but keyboard-accessible. inputMode
          hints numeric keyboards on mobile; autoComplete lets modern browsers
          pull the code from SMS/email app-clips if the device supports it.
          The ref lets the boxes above route clicks/taps to focus this. */}
      <input
        ref={inputRef}
        data-testid="otp-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={codeLength}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, codeLength))}
        aria-label={`${codeLength}-digit verification code`}
        className="sr-only"
        autoFocus
      />

      {verifyError && (
        <p className="text-red-500" style={{ fontSize: '13px' }}>
          {verifyError}
        </p>
      )}

      <Button
        variant="primary"
        fullWidth
        state={isVerifying ? 'loading' : !canSubmit ? 'disabled' : 'default'}
        onClick={() => {
          if (canSubmit) void onVerify(code);
        }}
        leadingIcon={<CheckCircle2 size={16} />}
      >
        {isVerifying ? 'Verifying…' : 'Confirm'}
      </Button>

      <button
        type="button"
        onClick={() => void onResend()}
        disabled={isResending}
        className="text-amber-600 active:opacity-70 disabled:opacity-50"
        style={{ fontSize: '13px', fontWeight: 600 }}
      >
        {isResending ? 'Sending…' : 'Resend code'}
      </button>
      {resendNotice && (
        <p className="text-slate-500" style={{ fontSize: '12px' }}>
          {resendNotice}
        </p>
      )}
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
// LOGIN SCREEN — credentials (step 1) + OTP (step 2)
//
// onLogin returns the OTP challenge issued by the backend. When the login
// response resolves, this screen transitions to the OTP panel in the same
// card layout (no visual redesign). The session is only produced after
// onOtpVerify resolves successfully.
// ─────────────────────────────────────────────────────────────────────────────
export interface LoginOtpChallenge {
  challengeId: string;
  codeLength: number;
  expiresInSeconds: number;
}

interface LoginProps {
  onLogin: (email: string, password: string) => Promise<LoginOtpChallenge>;
  onOtpVerify: (challengeId: string, code: string) => Promise<void>;
  onOtpResend: (challengeId: string) => Promise<void>;
  onSignUp: () => void;
  onForgotPassword: () => void;
  banner?: string;
}

export function LoginScreen({
  onLogin,
  onOtpVerify,
  onOtpResend,
  onSignUp,
  onForgotPassword,
  banner,
}: LoginProps) {
  const { t } = useLang();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [otpError, setOtpError] = useState<string | undefined>();
  const [resendNotice, setResendNotice] = useState<string | undefined>();

  const handleLogin = async () => {
    if (!email || !password) {
      setEmailError(t('emailAddress') + ' / ' + t('password'));
      return;
    }
    setEmailError(undefined);
    setIsLoading(true);
    try {
      const out = await onLogin(email.trim(), password);
      setChallenge(out);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Invalid credentials';
      setEmailError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpVerify = async (code: string) => {
    if (!challenge) return;
    setIsVerifying(true);
    setOtpError(undefined);
    try {
      await onOtpVerify(challenge.challengeId, code);
      // Success is surfaced by the parent (which navigates to /home or
      // the saved returnTo path). No further UI change needed here.
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      setOtpError(
        code === 'AUTH_OTP_LOCKED'
          ? 'Too many attempts. Please sign in again to get a new code.'
          : code === 'AUTH_OTP_EXPIRED'
            ? 'This code has expired. Please request a new one.'
            : 'Incorrect code. Please try again.',
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleOtpResend = async () => {
    if (!challenge) return;
    setIsResending(true);
    setResendNotice(undefined);
    setOtpError(undefined);
    try {
      await onOtpResend(challenge.challengeId);
      setResendNotice('A new code has been sent.');
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      setOtpError(
        code === 'AUTH_OTP_RESEND_EXCEEDED'
          ? 'Resend limit reached. Please sign in again.'
          : 'Could not resend the code. Please try again.',
      );
    } finally {
      setIsResending(false);
    }
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
        {banner && (
          <div className="mb-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
            <p className="text-green-800" style={{ fontSize: '13px', fontWeight: 500 }}>
              {banner}
            </p>
          </div>
        )}
        <h2 className="text-slate-900 mb-1" style={{ fontSize: '22px', fontWeight: 800 }}>
          {t('welcomeBack')}
        </h2>
        <p className="text-slate-400 mb-6" style={{ fontSize: '14px' }}>
          {t('signInContinue')}
        </p>

        {challenge ? (
          <EmailOtpPanel
            email={email.trim()}
            codeLength={challenge.codeLength}
            onVerify={handleOtpVerify}
            onResend={handleOtpResend}
            isVerifying={isVerifying}
            isResending={isResending}
            verifyError={otpError}
            resendNotice={resendNotice}
          />
        ) : (
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

            {/* OAuth providers (Google/Apple) and the local "demo login" hint
              were removed here in the auth-ux-alignment pass — neither had
              a real backend. Reintroduce only when OAuth is actually wired. */}

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
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN UP SCREEN — email OTP flow (aligned with backend IAM).
//
// Backend truth: POST /v1/auth/register returns 202 + an OTP challenge
// envelope, and emails a 6-digit code. The session is issued only when
// /v1/auth/verify-otp succeeds. This screen is a three-step wizard:
//   Step 1 — Personal info (name + phone with auto-selected dial code,
//            best-effort country badge). Phone is onboarding-only today and
//            is NOT sent to the backend (no phone column yet).
//   Step 2 — Email + password + terms. On "Create account" we POST the
//            real register endpoint and receive the OTP challenge.
//   Step 3 — Enter the emailed code. On success the parent navigates to
//            the authenticated home.
// ─────────────────────────────────────────────────────────────────────────────
interface SignUpProps {
  onBack: () => void;
  // Parent POSTs the credentials, receives the OTP challenge, and returns
  // it so this screen can drive Step 3. Session issuance happens via the
  // OTP callbacks below, NOT here.
  onCredentialsSubmit: (data: {
    name: string;
    email: string;
    password: string;
  }) => Promise<LoginOtpChallenge>;
  onOtpVerify: (challengeId: string, code: string) => Promise<void>;
  onOtpResend: (challengeId: string) => Promise<void>;
}

export function SignUpScreen({
  onBack,
  onCredentialsSubmit,
  onOtpVerify,
  onOtpResend,
}: SignUpProps) {
  const { t } = useLang();
  const geo = useGeoBootstrap();
  const dialEntry = dialForCountry(geo.countryCode);

  const [step, setStep] = useState(1); // 1 = info, 2 = credentials, 3 = OTP
  const [name, setName] = useState('');
  // Phone is split into a dial code the user can override + the local number.
  const [dialCode, setDialCode] = useState<string>(dialEntry.dialCode);
  const [localNumber, setLocalNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [signUpError, setSignUpError] = useState<string | undefined>();
  const [dialCodeTouched, setDialCodeTouched] = useState(false);
  const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [otpError, setOtpError] = useState<string | undefined>();
  const [resendNotice, setResendNotice] = useState<string | undefined>();

  // If the geo fallback resolves AFTER mount (rare; `useGeoBootstrap`
  // resolves synchronously on initial render), keep the dial code in sync
  // until the user edits it.
  useEffect(() => {
    if (dialCodeTouched) return;
    if (dialEntry.dialCode !== dialCode) setDialCode(dialEntry.dialCode);
  }, [dialEntry.dialCode, dialCode, dialCodeTouched]);

  // Phone is onboarding UI state ONLY — not POSTed. See the PR notes.
  // The step-1 gate still requires a local number so the UX feels complete.
  const canStep1 =
    name.trim().length > 2 && /^[0-9 ()-]{6,}$/.test(localNumber) && dialCode.startsWith('+');
  const canStep2 = email.includes('@') && password.length >= 12 && agreed;

  const goNext = async () => {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      setIsLoading(true);
      setSignUpError(undefined);
      try {
        const issued = await onCredentialsSubmit({ name, email: email.trim(), password });
        setChallenge(issued);
        setStep(3);
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
            ?.message ?? 'Registration failed';
        setSignUpError(msg);
      } finally {
        setIsLoading(false);
      }
      return;
    }
    // Step 3 has its own primary CTA inside EmailOtpPanel — the sticky
    // bottom CTA is hidden in that step (see render below).
  };

  const handleOtpVerify = async (code: string) => {
    if (!challenge) return;
    setIsVerifying(true);
    setOtpError(undefined);
    try {
      await onOtpVerify(challenge.challengeId, code);
      // Parent takes over (navigation to /home / returnTo).
    } catch (err: unknown) {
      const errCode = (err as { response?: { data?: { error?: { code?: string } } } })?.response
        ?.data?.error?.code;
      setOtpError(
        errCode === 'AUTH_OTP_LOCKED'
          ? 'Too many attempts. Please restart sign-up to get a new code.'
          : errCode === 'AUTH_OTP_EXPIRED'
            ? 'This code has expired. Please request a new one.'
            : 'Incorrect code. Please try again.',
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const handleOtpResend = async () => {
    if (!challenge) return;
    setIsResending(true);
    setResendNotice(undefined);
    setOtpError(undefined);
    try {
      await onOtpResend(challenge.challengeId);
      setResendNotice('A new code has been sent.');
    } catch (err: unknown) {
      const errCode = (err as { response?: { data?: { error?: { code?: string } } } })?.response
        ?.data?.error?.code;
      setOtpError(
        errCode === 'AUTH_OTP_RESEND_EXCEEDED'
          ? 'Resend limit reached. Please restart sign-up.'
          : 'Could not resend the code. Please try again.',
      );
    } finally {
      setIsResending(false);
    }
  };

  const stepLabels = [t('accountInfo'), t('createAccount'), t('verification')];

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
                {i < stepLabels.length - 1 && (
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

              {/* Phone number: country dial code + local number. Dial code is
                  editable; we pre-select from best-effort geo/locale. Phone
                  is onboarding-only and not persisted yet (see PR notes). */}
              <div>
                <label
                  className="text-slate-600 mb-1.5 block"
                  style={{ fontSize: '12px', fontWeight: 600 }}
                >
                  {t('phoneNumber')}
                </label>
                <div className="flex items-stretch gap-2">
                  <div className="relative">
                    <select
                      data-testid="dial-code-select"
                      value={dialCode}
                      onChange={(e) => {
                        setDialCode(e.target.value);
                        setDialCodeTouched(true);
                      }}
                      className="appearance-none h-12 rounded-2xl border-2 border-slate-200 bg-white pl-3 pr-7 text-slate-700"
                      style={{ fontSize: '13px', fontWeight: 600 }}
                    >
                      {COUNTRY_DIAL_CODES.map((c) => (
                        <option key={c.iso2} value={c.dialCode}>
                          {c.iso2} {c.dialCode}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <TextField
                      label=""
                      type="tel"
                      value={localNumber}
                      onChange={setLocalNumber}
                      leadingIcon={<Phone size={16} />}
                      hint={t('phoneHint')}
                    />
                  </div>
                </div>
              </div>

              {/* Location badge — reflects what we actually resolved.
                  Only claims a real fix when the browser gave one. */}
              <div className="bg-slate-50 rounded-2xl border border-slate-200 px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <MapPin size={14} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-slate-700" style={{ fontSize: '13px', fontWeight: 600 }}>
                    {geo.countryCode
                      ? `${dialEntry.name} (${geo.countryCode})`
                      : 'Country not detected'}
                  </p>
                  <p className="text-slate-400" style={{ fontSize: '11px' }}>
                    {geo.source === 'geo'
                      ? 'Detected from device location'
                      : geo.source === 'locale'
                        ? 'Inferred from browser locale'
                        : geo.source === 'timezone'
                          ? 'Inferred from timezone'
                          : 'Select your country dial code above'}
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

          {/* ── Step 3: Email OTP verification ── */}
          {step === 3 && challenge && (
            <EmailOtpPanel
              email={email.trim()}
              codeLength={challenge.codeLength}
              onVerify={handleOtpVerify}
              onResend={handleOtpResend}
              isVerifying={isVerifying}
              isResending={isResending}
              verifyError={otpError}
              resendNotice={resendNotice}
            />
          )}

          <div className="h-4" />
        </div>

        {/* Sticky bottom CTA — hidden on Step 3 because the OTP panel
            ships its own primary action. */}
        {step !== 3 && (
          <div className="bg-white border-t border-slate-100 px-6 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
            {signUpError && (
              <p className="text-red-500 text-center mb-2" style={{ fontSize: '13px' }}>
                {signUpError}
              </p>
            )}
            <Button
              variant="primary"
              state={
                isLoading
                  ? 'loading'
                  : (step === 1 && !canStep1) || (step === 2 && !canStep2)
                    ? 'disabled'
                    : 'default'
              }
              fullWidth
              onClick={goNext}
              leadingIcon={step < 2 ? <ArrowRight size={16} /> : <CheckCircle2 size={16} />}
            >
              {step === 2 ? t('register') : t('next')}
            </Button>
            <p className="text-center text-slate-400 mt-3" style={{ fontSize: '12px' }}>
              {t('alreadyHaveAccount')}{' '}
              <button onClick={onBack} className="text-amber-600 font-semibold">
                {t('login')}
              </button>
            </p>
          </div>
        )}
      </div>
    </SwipeableScreen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD SCREEN — wired to POST /v1/auth/forgot-password.
//
// The backend returns 202 for both existing and unknown emails
// (anti-enumeration). We always show the "check inbox" success state on a
// 2xx response, and keep the user on the form with an error hint on a
// network/5xx failure.
// ─────────────────────────────────────────────────────────────────────────────
interface ForgotPwProps {
  onBack: () => void;
  onSubmit: (email: string) => Promise<void>;
}

export function ForgotPasswordScreen({ onBack, onSubmit }: ForgotPwProps) {
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleSend = async () => {
    if (!email) return;
    setIsLoading(true);
    setError(undefined);
    try {
      await onSubmit(email.trim());
      setSubmitted(true);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Could not request a reset link. Please try again.';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
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
                <Button
                  variant="text"
                  onClick={() => {
                    // Take the user back to the form so they can re-submit
                    // against the real endpoint (we don't auto-resend here).
                    setSubmitted(false);
                    setError(undefined);
                  }}
                >
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

                {error && (
                  <p className="text-red-500 text-center" style={{ fontSize: '13px' }}>
                    {error}
                  </p>
                )}

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
