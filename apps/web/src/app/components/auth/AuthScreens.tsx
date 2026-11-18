import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Mail, MessageCircle, Lock, Eye, EyeOff, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '../ds/Button';
import { TextField } from '../ds/TextField';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
import type { OtpChannel } from '../../../lib/auth-channel';
import { PhoneIdentityField } from './PhoneIdentityField';
import { toE164Phone, isValidPhoneIdentity } from '../../../lib/phone-identity';
import { AuthChannelNotice } from './AuthChannelNotice';
import {
  extractAuthError,
  loginErrorMessage,
  otpErrorMessage,
  otpRecoveryAction,
  type OtpRecoveryAction,
} from '../../../lib/auth-errors';
import {
  type AuthExperience,
  AUTH_EXPERIENCES,
  DEFAULT_EXPERIENCE_ID,
} from '../../../lib/auth-experience';

// ─── Channel-aware OTP panel (shared between Login and SignUp) ────────────────────
// Reuses the boxed OTP aesthetic from the project's design history: six
// amber-bordered squares that light up as digits arrive. Only the behavior
// is new — it consumes the real challengeId the backend returned and POSTs
// /v1/auth/verify-otp through the parent callback.
interface EmailOtpPanelProps {
  email: string;
  channel?: OtpChannel;
  codeLength: number;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  isVerifying?: boolean;
  isResending?: boolean;
  verifyError?: string;
  resendNotice?: string;
  recovery?: OtpRecoveryAction;
  onRestart?: () => void;
  restartLabel?: string;
  // Experience-aware theming (Sprint 5.1.1). Defaults to seeker so any
  // call site that hasn't been threaded yet keeps the historical orange
  // identity exactly. Layout / spacing / typography are unchanged.
  experience?: AuthExperience;
}

export function EmailOtpPanel({
  email,
  channel = 'email',
  codeLength,
  onVerify,
  onResend,
  isVerifying,
  isResending,
  verifyError,
  resendNotice,
  recovery = null,
  onRestart,
  restartLabel,
  experience = AUTH_EXPERIENCES[DEFAULT_EXPERIENCE_ID],
}: EmailOtpPanelProps) {
  const { lang } = useLang();
  const [code, setCode] = useState('');
  const canSubmit =
    code.length === codeLength && !isVerifying && !isResending && recovery !== 'restart';
  // Ref so any tap/click on the visual boxes can programmatically focus the
  // visually-hidden <input>. Without this, mobile users literally cannot
  // bring up the numeric keyboard (the input is sr-only — offscreen), and
  // desktop users lose focus after the initial autoFocus fires.
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = () => inputRef.current?.focus();

  return (
    <div className="flex flex-col items-center text-center gap-4">
      <div
        className={`w-20 h-20 rounded-2xl ${experience.classes.iconChipBg} flex items-center justify-center`}
      >
        {channel === 'whatsapp' ? (
          <MessageCircle size={32} className="text-emerald-700" />
        ) : (
          <Mail size={32} className={experience.classes.iconChipText} />
        )}
      </div>
      <div>
        <h3 className="text-slate-900" style={{ fontSize: '18px', fontWeight: 800 }}>
          {channel === 'whatsapp'
            ? lang === 'ar'
              ? 'تحقق من واتساب'
              : 'Check WhatsApp'
            : lang === 'ar'
              ? 'تحقق من بريدك الإلكتروني'
              : 'Verify your email'}
        </h3>
        <p className="text-slate-400 mt-1" style={{ fontSize: '13px' }}>
          {lang === 'ar'
            ? `أدخل رمز التحقق المكوّن من ${codeLength} أرقام من ${channel === 'whatsapp' ? 'واتساب' : 'بريدك الإلكتروني'}`
            : `Enter the ${codeLength}-digit code from ${channel === 'whatsapp' ? 'WhatsApp' : 'your email'}`}
          {email ? (
            <>
              {' '}
              {lang === 'ar' ? 'إلى' : 'to'}{' '}
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
        className="grid gap-2 mt-2 w-full max-w-[348px] cursor-text"
        style={{ gridTemplateColumns: `repeat(${codeLength}, minmax(0, 1fr))` }}
        dir="ltr"
        onClick={focusInput}
        onTouchStart={focusInput}
        role="group"
        aria-label={
          lang === 'ar'
            ? `رمز التحقق المكوّن من ${codeLength} أرقام`
            : `${codeLength}-digit verification code`
        }
      >
        {Array.from({ length: codeLength }).map((_, i) => (
          <div
            key={i}
            data-testid={`otp-box-${i}`}
            className={`min-w-0 h-14 rounded-2xl border-2 flex items-center justify-center transition-all ${
              code.length > i
                ? `${experience.classes.accentBorder} ${experience.classes.softBg}`
                : 'border-slate-200 bg-slate-50'
            }`}
            style={{ fontSize: '24px', fontWeight: 700, color: experience.accentHex }}
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
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canSubmit) {
            event.preventDefault();
            void onVerify(code);
          }
        }}
        disabled={isVerifying || isResending || recovery === 'restart'}
        aria-invalid={!!verifyError}
        aria-describedby={verifyError ? 'otp-verification-error' : undefined}
        aria-label={
          lang === 'ar'
            ? `رمز التحقق المكوّن من ${codeLength} أرقام`
            : `${codeLength}-digit verification code`
        }
        className="sr-only"
        autoFocus
      />

      {verifyError && (
        <p
          id="otp-verification-error"
          role="alert"
          className="text-red-500"
          style={{ fontSize: '13px' }}
        >
          {verifyError}
        </p>
      )}

      <Button
        variant="primary"
        tone={experience.id}
        fullWidth
        state={isVerifying ? 'loading' : !canSubmit ? 'disabled' : 'default'}
        onClick={() => {
          if (canSubmit) void onVerify(code);
        }}
        leadingIcon={<CheckCircle2 size={16} />}
      >
        {lang === 'ar'
          ? isVerifying
            ? 'جارٍ التحقق…'
            : 'تأكيد'
          : isVerifying
            ? 'Verifying…'
            : 'Confirm'}
      </Button>

      <button
        type="button"
        onClick={() => void onResend()}
        disabled={isResending || isVerifying || recovery !== null}
        className={`${experience.classes.accentText} active:opacity-70 disabled:opacity-50`}
        style={{ fontSize: '13px', fontWeight: 600 }}
      >
        {lang === 'ar'
          ? isResending
            ? 'جارٍ الطلب…'
            : 'إعادة طلب الرمز'
          : isResending
            ? 'Sending…'
            : 'Resend code'}
      </button>
      {onRestart && (
        <button
          type="button"
          onClick={onRestart}
          disabled={isVerifying || isResending}
          className="text-slate-700 underline disabled:opacity-50"
          style={{ fontSize: '13px' }}
        >
          {restartLabel ?? (lang === 'ar' ? 'بدء تسجيل الدخول مجدداً' : 'Start sign-in again')}
        </button>
      )}
      {resendNotice && (
        <p role="status" className="text-slate-500" style={{ fontSize: '12px' }}>
          {resendNotice}
        </p>
      )}
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
  channel?: OtpChannel;
  maskedDestination?: string;
  challengeId: string;
  codeLength: number;
  expiresInSeconds: number;
}

interface LoginProps {
  whatsappAvailable?: boolean;
  channel?: OtpChannel;
  onLogin: (identity: string, password: string, channel?: OtpChannel) => Promise<LoginOtpChallenge>;
  onOtpVerify: (challengeId: string, code: string) => Promise<void>;
  onOtpResend: (challengeId: string) => Promise<void>;
  onSignUp: () => void;
  onForgotPassword: () => void;
  onRecoverVerification?: (email: string) => void;
  banner?: string;
  // Sprint 5.1.1: experience-aware theming. Defaults to seeker so any
  // call site that hasn't been threaded yet keeps the historical orange
  // identity exactly. Layout / spacing / typography unchanged.
  experience?: AuthExperience;
}

export function LoginScreen({
  channel = 'email',
  whatsappAvailable = false,
  onLogin,
  onOtpVerify,
  onOtpResend,
  onSignUp,
  onForgotPassword,
  onRecoverVerification,
  banner,
  experience = AUTH_EXPERIENCES[DEFAULT_EXPERIENCE_ID],
}: LoginProps) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [localNumber, setLocalNumber] = useState('');
  const [identityOverride, setIdentityOverride] = useState<OtpChannel | null>(null);
  const selectedChannel = identityOverride ?? channel;
  const identity =
    selectedChannel === 'whatsapp' ? toE164Phone(countryCode, localNumber) : email.trim();
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<{
    messages: Record<'en' | 'ar', string>;
    code: string | null;
  }>();
  const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [otpError, setOtpError] = useState<Record<'en' | 'ar', string> | undefined>();
  const [otpRecovery, setOtpRecovery] = useState<OtpRecoveryAction>(null);
  const [resendNotice, setResendNotice] = useState<string | undefined>();
  const requestFlight = useRef(false);
  const credentialsRevision = useRef(0);

  const handleLogin = async () => {
    if (requestFlight.current || (selectedChannel === 'whatsapp' && !whatsappAvailable)) return;
    setLoginError(undefined);
    if (
      !identity ||
      !password ||
      (selectedChannel === 'whatsapp' && !isValidPhoneIdentity(countryCode, localNumber))
    ) {
      setLoginError({
        messages: {
          en:
            selectedChannel === 'whatsapp'
              ? 'Enter a valid WhatsApp number and password.'
              : 'Email Address / Password',
          ar:
            selectedChannel === 'whatsapp'
              ? 'أدخل رقم واتساب صحيحًا وكلمة المرور.'
              : 'البريد الإلكتروني / كلمة المرور',
        },
        code: null,
      });
      return;
    }
    requestFlight.current = true;
    const revision = credentialsRevision.current;
    setIsLoading(true);
    try {
      const out = await onLogin(identity, password, selectedChannel);
      // Inputs remain editable during the request. A reply for an earlier
      // draft must not offer recovery or an OTP challenge for the new draft.
      if (revision !== credentialsRevision.current) return;
      setChallenge(out);
      setOtpRecovery(null);
      setOtpError(undefined);
      setResendNotice(undefined);
    } catch (err: unknown) {
      if (revision !== credentialsRevision.current) return;
      // Map the backend's stable error CODE to user copy here — never
      // render response.data.error.message verbatim. That used to leak raw
      // framework text like "Unauthorized Exception" onto the login form.
      setLoginError({
        messages: {
          en: loginErrorMessage(err, 'en', selectedChannel),
          ar: loginErrorMessage(err, 'ar', selectedChannel),
        },
        code: extractAuthError(err).code,
      });
    } finally {
      requestFlight.current = false;
      setIsLoading(false);
    }
  };

  const handleOtpVerify = async (code: string) => {
    if (!challenge || requestFlight.current || otpRecovery === 'restart') return;
    requestFlight.current = true;
    setIsVerifying(true);
    setOtpError(undefined);
    try {
      await onOtpVerify(challenge.challengeId, code);
      // Success is surfaced by the parent (which navigates to /home or
      // the saved returnTo path). No further UI change needed here.
    } catch (err: unknown) {
      setOtpError({
        en: otpErrorMessage(err, 'verify', 'en'),
        ar: otpErrorMessage(err, 'verify', 'ar'),
      });
      const recovery = otpRecoveryAction(err, 'verify');
      if (recovery) setOtpRecovery(recovery);
    } finally {
      requestFlight.current = false;
      setIsVerifying(false);
    }
  };

  const handleOtpResend = async () => {
    if (!challenge || requestFlight.current || otpRecovery !== null) return;
    requestFlight.current = true;
    setIsResending(true);
    setResendNotice(undefined);
    setOtpError(undefined);
    try {
      await onOtpResend(challenge.challengeId);
      setResendNotice(
        lang === 'ar'
          ? 'تم استلام الطلب. استخدم أحدث رمز يصلك.'
          : 'Request received. Use the most recent code you receive.',
      );
    } catch (err: unknown) {
      setOtpError({
        en: otpErrorMessage(err, 'resend', 'en'),
        ar: otpErrorMessage(err, 'resend', 'ar'),
      });
      const recovery = otpRecoveryAction(err, 'resend');
      if (recovery) setOtpRecovery(recovery);
    } finally {
      requestFlight.current = false;
      setIsResending(false);
    }
  };

  return (
    <div className="flex flex-col bg-white" style={{ minHeight: '100svh' }}>
      {/* ── Gradient Hero — driven by the resolved experience theme ── */}
      <div
        data-testid={`auth-hero-${experience.id}`}
        className={`relative overflow-hidden bg-gradient-to-br ${experience.gradient} px-6 pt-16 pb-20`}
      >
        <div className="absolute -top-12 -end-12 w-48 h-48 rounded-full bg-white/10" />
        <div className="absolute -bottom-8 start-8 w-32 h-32 rounded-full bg-white/10" />
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
          <div
            className={`w-16 h-16 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center mb-4 shadow-xl ${experience.heroShadow}`}
          >
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
            {experience.brand.title}
          </h1>
          <p className="text-white/70 mt-1" style={{ fontSize: '13px' }}>
            {experience.brand.subtitle}
          </p>
        </div>
      </div>

      {/* ── Card ── */}
      <div className="relative mx-auto w-full max-w-lg flex-1 bg-white rounded-t-3xl -mt-6 px-6 pt-8 pb-6">
        {!challenge &&
          selectedChannel === 'email' &&
          loginError?.code === 'AUTH_ACCOUNT_UNVERIFIED' &&
          onRecoverVerification && (
            <button
              type="button"
              className="text-slate-700 underline mb-3"
              onClick={() => onRecoverVerification(email.trim())}
            >
              {lang === 'ar' ? 'طلب رابط للتحقق من البريد' : 'Request email verification'}
            </button>
          )}
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
            email={challenge.maskedDestination ?? identity}
            channel={challenge.channel ?? selectedChannel}
            codeLength={challenge.codeLength}
            onVerify={handleOtpVerify}
            onResend={handleOtpResend}
            isVerifying={isVerifying}
            isResending={isResending}
            verifyError={otpError?.[lang]}
            recovery={otpRecovery}
            resendNotice={resendNotice}
            experience={experience}
            onRestart={() => {
              setChallenge(null);
              setOtpRecovery(null);
              setPassword('');
              setLoginError(undefined);
              credentialsRevision.current += 1;
              setOtpError(undefined);
              setResendNotice(undefined);
            }}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <AuthChannelNotice channel={selectedChannel} available={whatsappAvailable} />
            {selectedChannel === 'whatsapp' ? (
              <PhoneIdentityField
                countryCode={countryCode}
                onCountryChange={(value) => {
                  setCountryCode(value);
                  credentialsRevision.current += 1;
                  setLoginError(undefined);
                }}
                localNumber={localNumber}
                onNumberChange={(value) => {
                  setLocalNumber(value);
                  credentialsRevision.current += 1;
                  setLoginError(undefined);
                }}
                error={loginError?.messages[lang]}
              />
            ) : (
              <TextField
                label={t('emailAddress')}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(value) => {
                  setEmail(value);
                  setLoginError(undefined);
                  credentialsRevision.current += 1;
                }}
                error={loginError?.messages[lang]}
                leadingIcon={<Mail size={16} />}
              />
            )}
            {(channel === 'whatsapp' || whatsappAvailable) && (
              <button
                type="button"
                className="min-h-11 text-sm text-slate-700 underline"
                onClick={() => {
                  setIdentityOverride(selectedChannel === 'email' ? 'whatsapp' : 'email');
                  setLoginError(undefined);
                  credentialsRevision.current += 1;
                }}
              >
                {selectedChannel === 'email'
                  ? lang === 'ar'
                    ? 'لدي حساب واتساب'
                    : 'I have a WhatsApp account'
                  : lang === 'ar'
                    ? 'لدي حساب بريد إلكتروني'
                    : 'I have an email account'}
              </button>
            )}

            <TextField
              label={t('password')}
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              onEnter={() => {
                void handleLogin();
              }}
              value={password}
              onChange={(value) => {
                setPassword(value);
                setLoginError(undefined);
                credentialsRevision.current += 1;
              }}
              leadingIcon={<Lock size={16} />}
              trailingIcon={
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={lang === 'ar' ? 'إظهار كلمة المرور' : 'Show password'}
                  aria-pressed={showPw}
                  className="flex items-center justify-center w-11 h-11 -me-3 rounded-xl focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />

            <div className="flex justify-end -mt-2">
              <button
                onClick={onForgotPassword}
                className={`${experience.classes.accentText} active:opacity-70 transition-opacity`}
                style={{ fontSize: '13px', fontWeight: 600 }}
              >
                {t('forgotPassword')}
              </button>
            </div>

            <Button
              variant="primary"
              tone={experience.id}
              state={
                isLoading
                  ? 'loading'
                  : selectedChannel === 'whatsapp' && !whatsappAvailable
                    ? 'disabled'
                    : 'default'
              }
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
                className={`${experience.classes.accentText} active:opacity-70`}
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
