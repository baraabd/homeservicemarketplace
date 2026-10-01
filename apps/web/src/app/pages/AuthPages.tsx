import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, Eye, EyeOff, Lock, Mail, RefreshCcw, XCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth-provider';
import * as authApi from '../../lib/auth-api';
import { recoveryRequestErrorMessage, resetPasswordErrorMessage } from '../../lib/auth-errors';
import { sanitizeAuthReturnTo, selectAuthReturnTo } from '../../lib/auth-return-to';
import { useLang } from '../i18n/LanguageContext';
import { getIntendedApp } from '../../lib/intended-app';
import { resolveAuthExperience, resolvePostAuthDestination } from '../../lib/auth-experience';
import { LoginScreen, SignUpScreen, ForgotPasswordScreen } from '../components/auth/AuthScreens';
import { Button } from '../components/ds/Button';
import { TextField } from '../components/ds/TextField';

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN PAGE  /login
//
// Two responsibilities:
//   1. THEME — resolve the right experience (Seeker / Provider / Admin)
//      from explicit state, returnTo, or sessionStorage intent. This is
//      what makes "click Provider → /login" render with the Provider
//      identity instead of orange Seeker branding.
//   2. ROUTE — after a successful OTP verify, send the user to the
//      strongest available destination signal:
//        returnTo > intent > role inference > /home.
// ─────────────────────────────────────────────────────────────────────────────
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { login, user } = useAuth();
  const state = location.state as {
    registered?: boolean;
    returnTo?: string;
    email?: string;
    // Some internal navigations (e.g. an "Admin login" button on a
    // landing page) can pass an explicit experience id so the theme
    // resolves without waiting for sessionStorage to kick in.
    app?: 'seeker' | 'provider' | 'admin';
  } | null;
  const justRegistered = state?.registered;
  // Internal navigation carries returnTo in router state. A cold/direct login
  // URL cannot, so accept the sanitized query parameter as the fallback.
  // GuestOnly uses the same resolver so its authenticated rerender cannot win
  // the OTP navigation race and drop a valid deep link.
  const returnTo = selectAuthReturnTo(state?.returnTo, searchParams.get('returnTo'));

  const { verifyOtp, resendOtp } = useAuth();

  // Theme decision happens at render time — explicit state.app wins,
  // then returnTo prefix, then sessionStorage intent, then default.
  const experience = resolveAuthExperience({
    explicit: state?.app,
    returnTo,
  });

  return (
    <LoginScreen
      experience={experience}
      onLogin={async (email: string, password: string) => {
        const challenge = await login({ email, password });
        return {
          challengeId: challenge.challengeId,
          codeLength: challenge.codeLength,
          expiresInSeconds: challenge.expiresInSeconds,
        };
      }}
      onOtpVerify={async (challengeId: string, code: string) => {
        await verifyOtp(challengeId, code);
        // After OTP verify the auth provider has refetched /me. The
        // destination resolver applies the full precedence chain;
        // experienceId is the load-bearing fallback when no intent
        // is present (e.g., a direct /login deep-link without a prior
        // /select bounce).
        //
        // Sprint 7.x — DO NOT call clearIntendedApp() here. The intent
        // is per-tab sessionStorage; the canonical consumption point
        // is `useAuth().logout`. Clearing it in-flight introduced a
        // render race where GuestOnly re-rendered after /me populated
        // but before navigate landed, found intent already null, fell
        // through to customer role inference, and sent the user to
        // /home instead of the intended /provider.
        const dest = resolvePostAuthDestination({
          returnTo,
          intentApp: getIntendedApp(),
          experienceId: experience.id,
          userRoles: user?.roles ?? null,
        });
        navigate(dest, { replace: true });
      }}
      onOtpResend={async (challengeId: string) => {
        await resendOtp(challengeId);
      }}
      onRecoverVerification={(email) => navigate('/check-email', { state: { app: experience.id, returnTo, email } })}
      onSignUp={() =>
        // Forward the resolved experience explicitly so the Sign-up
        // screen keeps the SAME theme — react-router state is otherwise
        // dropped through this navigation.
        navigate('/signup', { state: { app: experience.id, returnTo } })
      }
      onForgotPassword={() => navigate('/forgot-password', { state: { app: experience.id, returnTo } })}
      banner={justRegistered ? 'Your account is ready. Sign in to continue.' : undefined}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGN-UP PAGE  /signup
// Credentials (step 1+2) are submitted to /v1/auth/register which returns
// an OTP challenge; step 3 (inside SignUpScreen) verifies that OTP against
// /v1/auth/verify-otp and — on success — the session cookies are issued.
// ─────────────────────────────────────────────────────────────────────────────
export function SignUpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { register: doRegister, verifyOtp, resendOtp, user } = useAuth();
  const state = location.state as { app?: 'seeker' | 'provider' | 'admin'; returnTo?: string } | null;

  const returnTo = sanitizeAuthReturnTo(state?.returnTo);
  const experience = resolveAuthExperience({ explicit: state?.app, returnTo });

  return (
    <SignUpScreen
      experience={experience}
      onRecoverVerification={(email) => navigate('/check-email', { state: { app: experience.id, returnTo, email } })}
      onBack={() => navigate('/login', { state: { app: experience.id, returnTo } })}
      onCredentialsSubmit={async (data: { name: string; email: string; password: string }) => {
        const [firstName, ...rest] = data.name.trim().split(' ');
        const lastName = rest.join(' ') || firstName;
        const challenge = await doRegister({
          email: data.email,
          password: data.password,
          firstName,
          lastName,
        });
        return {
          challengeId: challenge.challengeId,
          codeLength: challenge.codeLength,
          expiresInSeconds: challenge.expiresInSeconds,
        };
      }}
      onOtpVerify={async (challengeId: string, code: string) => {
        await verifyOtp(challengeId, code);
        // Registration OTP success issues the session and lands the
        // new user in the authed area. The destination resolver picks
        // the strongest signal:
        //   returnTo > intent > experienceId > role inference > /home.
        // experienceId is the load-bearing fallback for the original
        // patch-2 regression: a brand-new customer-only user signing
        // up from a Provider-themed flow must land on /provider, not
        // /home.
        //
        // Sprint 7.x — DO NOT call clearIntendedApp() here. The intent
        // is per-tab sessionStorage; the canonical consumption point
        // is `useAuth().logout`. Clearing it in-flight introduced a
        // render race where GuestOnly re-rendered after /me populated
        // but before navigate landed, found intent already null, fell
        // through to customer role inference, and sent the user to
        // /home instead of the intended /provider.
        const dest = resolvePostAuthDestination({
          returnTo,
          intentApp: getIntendedApp(),
          experienceId: experience.id,
          userRoles: user?.roles ?? null,
        });
        navigate(dest, { replace: true });
      }}
      onOtpResend={async (challengeId: string) => {
        await resendOtp(challengeId);
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT-PASSWORD PAGE  /forgot-password
// Wires the form to POST /v1/auth/forgot-password for real. Backend always
// returns 202 (anti-enumeration); the UI shows the "check inbox" state on
// any 2xx and a generic error on network / 5xx.
// ─────────────────────────────────────────────────────────────────────────────
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { app?: 'seeker' | 'provider' | 'admin'; returnTo?: string } | null;
  const returnTo = sanitizeAuthReturnTo(state?.returnTo);
  const experience = resolveAuthExperience({ explicit: state?.app, returnTo });
  return (
    <ForgotPasswordScreen
      experience={experience}
      onBack={() => navigate('/login', { state: { app: experience.id, returnTo } })}
      onSubmit={async (email) => {
        await authApi.forgotPassword(email);
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK EMAIL PAGE  /check-email
// Landing page shown after register (state.email) or after forgot-password
// if the caller chose to redirect here. Offers a "resend verification"
// action hitting the real backend endpoint.
// ─────────────────────────────────────────────────────────────────────────────
export function CheckEmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { lang } = useLang();
  const state = location.state as { email?: string; app?: 'seeker' | 'provider' | 'admin'; returnTo?: string } | null;
  const [email, setEmail] = useState(state?.email ?? '');
  const returnTo = sanitizeAuthReturnTo(state?.returnTo);
  const experience = resolveAuthExperience({ explicit: state?.app, returnTo });
  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sent'>('idle');
  const [error, setError] = useState<string>();
  const flight = useRef(false);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim());
  const onResend = useCallback(async () => {
    if (flight.current || !validEmail) return;
    flight.current = true;
    setIsResending(true);
    setError(undefined);
    setResendStatus('idle');
    try {
      await authApi.resendVerification(email.trim());
      setResendStatus('sent');
    } catch (cause) {
      setError(lang === 'ar' ? 'تعذر تأكيد الطلب. انتظر قليلاً ثم حاول مجدداً.' : recoveryRequestErrorMessage(cause));
    } finally {
      flight.current = false;
      setIsResending(false);
    }
  }, [email, validEmail, lang]);
  return (
    <div className="flex flex-col bg-white" style={{ minHeight: '100svh' }}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div data-testid={`auth-page-${experience.id}`} className={`w-24 h-24 rounded-full ${experience.classes.iconChipBg} flex items-center justify-center mb-6`}>
          <Mail size={44} className={experience.classes.iconChipText} />
        </div>
        <h1 className="text-slate-900 mb-2" style={{ fontSize: '24px', fontWeight: 800 }}>
          {lang === 'ar' ? 'التحقق من البريد الإلكتروني' : 'Check your email'}
        </h1>
        <p className="text-slate-500 max-w-sm mb-6" style={{ fontSize: '14px', lineHeight: '1.6' }}>
          {lang === 'ar' ? 'أدخل بريدك لطلب رابط تحقق جديد. استخدم الرابط لتفعيل حسابك ثم سجّل الدخول.' : 'Enter your email to request a new verification link. Use the link to activate your account, then sign in.'}
        </p>
        <div className="w-full max-w-sm flex flex-col gap-3">
          <TextField label={lang === 'ar' ? 'البريد الإلكتروني' : 'Email address'} type="email" autoComplete="email" value={email}
            onChange={(value) => { setEmail(value); setResendStatus('idle'); }} onEnter={() => { void onResend(); }} disabled={isResending} />
          <Button variant="primary" tone={experience.id} fullWidth state={isResending ? 'loading' : !validEmail ? 'disabled' : 'default'} onClick={() => { void onResend(); }} leadingIcon={<RefreshCcw size={16} />}>
            {lang === 'ar' ? 'طلب رابط تحقق' : 'Resend verification email'}
          </Button>
          {resendStatus === 'sent' && <p role="status" className="text-green-700" style={{ fontSize: '13px' }}>
            {lang === 'ar' ? 'تم استلام الطلب. إذا كان الحساب مؤهلاً فستصلك تعليمات التحقق. تحقق أيضاً من البريد غير المرغوب فيه.' : 'Request received. If the account is eligible, check your inbox and spam folder for verification instructions.'}
          </p>}
          {error && <p role="alert" className="text-red-600" style={{ fontSize: '13px' }}>{error}</p>}
          <Button variant="text" tone={experience.id} fullWidth onClick={() => navigate('/login', { state: { app: experience.id, returnTo } })}>
            {lang === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to sign in'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY EMAIL PAGE  /verify-email?token=...
// Backend email link lands here. We POST the token exactly once on mount
// (guarded against React 18 StrictMode double-invocation) and render
// success / invalid / network error with actions.
// ─────────────────────────────────────────────────────────────────────────────
type VerifyState = 'verifying' | 'success' | 'invalid' | 'missing' | 'error';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { app?: 'seeker' | 'provider' | 'admin'; returnTo?: string } | null;
  const token = params.get('token');
  const attemptRef = useRef<{ token: string; retry: number; promise: Promise<void> } | null>(null);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<VerifyState>(token ? 'verifying' : 'missing');
  // Verification links arrive cold (the user clicks an email link in
  // a fresh tab) so there's no react-router state — we resolve from
  // sessionStorage intent + the explicit state override.
  const returnTo = sanitizeAuthReturnTo(state?.returnTo);
  const experience = resolveAuthExperience({ explicit: state?.app, returnTo });

  useEffect(() => {
    if (!token) { setStatus('missing'); return; }
    let active = true;
    setStatus('verifying');
    if (attemptRef.current?.token !== token || attemptRef.current.retry !== retry) {
      attemptRef.current = { token, retry, promise: authApi.verifyEmail(token) };
    }
    void attemptRef.current.promise.then(() => { if (active) setStatus('success'); }).catch((err: unknown) => {
      if (!active) return;
      const code = (err as { response?: { status?: number } } | undefined)?.response?.status;
      setStatus(code === 400 || code === 403 ? 'invalid' : 'error');
    });
    return () => { active = false; };
  }, [token, retry]);

  return (
    <div
      className="flex flex-col items-center justify-center bg-white px-6 text-center"
      style={{ minHeight: '100svh' }}
    >
      {status === 'verifying' && (
        <>
          <Loader2
            size={40}
            data-testid={`auth-page-${experience.id}`}
            className={`${experience.classes.iconChipText} animate-spin mb-4`}
          />
          <h1 className="text-slate-900" style={{ fontSize: '20px', fontWeight: 800 }}>
            Verifying your email…
          </h1>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle2 size={44} className="text-green-500" />
          </div>
          <h1 className="text-slate-900 mb-2" style={{ fontSize: '22px', fontWeight: 800 }}>
            Email verified
          </h1>
          <p className="text-slate-500 max-w-sm mb-6" style={{ fontSize: '14px' }}>
            Your account is active. You can now sign in.
          </p>
          <Button
            variant="primary"
            tone={experience.id}
            onClick={() => navigate('/login', { state: { app: experience.id, returnTo } })}
            leadingIcon={<CheckCircle2 size={16} />}
          >
            Go to sign in
          </Button>
        </>
      )}

      {(status === 'invalid' || status === 'missing' || status === 'error') && (
        <>
          <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <XCircle size={44} className="text-red-500" />
          </div>
          <h1 className="text-slate-900 mb-2" style={{ fontSize: '22px', fontWeight: 800 }}>
            {status === 'missing'
              ? 'No verification token'
              : status === 'invalid'
                ? 'Link invalid or expired'
                : 'Something went wrong'}
          </h1>
          <p className="text-slate-500 max-w-sm mb-6" style={{ fontSize: '14px' }}>
            {status === 'missing'
              ? 'The verification link is missing a token. Open the email link again.'
              : status === 'invalid'
                ? 'This verification link is no longer valid. Request a new one and try again.'
                : "We couldn't reach the server. Please try again in a moment."}
          </p>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {status === 'error' && <Button variant="primary" tone={experience.id} onClick={() => setRetry((value) => value + 1)}>Try verification again</Button>}
            <Button
              variant="primary"
              tone={experience.id}
              onClick={() => navigate('/login', { state: { app: experience.id, returnTo } })}
            >
              Back to sign in
            </Button>
            <Button
              variant="text"
              tone={experience.id}
              onClick={() => navigate('/check-email', { state: { app: experience.id, returnTo } })}
            >
              Resend verification
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD PAGE  /reset-password?token=...
// ─────────────────────────────────────────────────────────────────────────────
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { app?: 'seeker' | 'provider' | 'admin'; returnTo?: string } | null;
  const token = useMemo(() => params.get('token') ?? '', [params]);
  // Password-reset links arrive cold from email — we lean on the same
  // explicit-state + intent fallback that VerifyEmailPage uses.
  const returnTo = sanitizeAuthReturnTo(state?.returnTo);
  const experience = resolveAuthExperience({ explicit: state?.app, returnTo });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  // Synchronous in-flight latch. State (`isLoading`) can't guard against two
  // clicks fired in the same tick — both read the same stale render closure.
  // A ref flips synchronously, so the second click is dropped immediately.
  const inFlight = useRef(false);

  const validate = (): string | undefined => {
    if (!token) return 'This reset link is missing a token.';
    if (password.length < 12) return 'Password must be at least 12 characters.';
    if (password !== confirm) return 'Passwords do not match.';
    return undefined;
  };

  const onSubmit = async () => {
    if (inFlight.current) return; // exactly one request per submit
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    inFlight.current = true;
    setError(undefined);
    setIsLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (e: unknown) {
      setError(resetPasswordErrorMessage(e));
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  };

  if (done) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-white px-6 text-center"
        style={{ minHeight: '100svh' }}
      >
        <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mb-4">
          <CheckCircle2 size={44} className="text-green-500" />
        </div>
        <h1 className="text-slate-900 mb-2" style={{ fontSize: '22px', fontWeight: 800 }}>
          Password updated
        </h1>
        <p className="text-slate-500 max-w-sm mb-6" style={{ fontSize: '14px' }}>
          You can now sign in with your new password.
        </p>
        <Button
          variant="primary"
          tone={experience.id}
          onClick={() => navigate('/login', { state: { app: experience.id, returnTo } })}
        >
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-white" style={{ minHeight: '100svh' }}>
      <div className="flex-1 px-6 py-10 max-w-md mx-auto w-full">
        <div className="flex justify-center mb-6">
          <div
            data-testid={`auth-page-${experience.id}`}
            className={`w-20 h-20 rounded-2xl ${experience.classes.iconChipBg} flex items-center justify-center`}
          >
            <Lock size={32} className={experience.classes.iconChipText} />
          </div>
        </div>
        <h1
          className="text-slate-900 mb-1 text-center"
          style={{ fontSize: '22px', fontWeight: 800 }}
        >
          Choose a new password
        </h1>
        <p className="text-slate-400 mb-6 text-center" style={{ fontSize: '13px' }}>
          Reset links expire quickly. If this one has expired, request a new one.
        </p>

        <div className="flex flex-col gap-4">
          <TextField
            autoComplete="new-password"
            label="New password"
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={setPassword}
            leadingIcon={<Lock size={16} />}
            hint="At least 12 characters"
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
          <TextField
            autoComplete="new-password"
            onEnter={() => { void onSubmit(); }}
            label="Confirm password"
            type={showPw ? 'text' : 'password'}
            value={confirm}
            onChange={setConfirm}
            leadingIcon={<Lock size={16} />}
          />

          {error && (
            <p role="alert" className="text-red-500 text-center" style={{ fontSize: '13px' }}>
              {error}
            </p>
          )}

          <Button
            variant="primary"
            tone={experience.id}
            fullWidth
            state={isLoading ? 'loading' : !token ? 'disabled' : 'default'}
            onClick={onSubmit}
          >
            {isLoading ? 'Updating…' : 'Update password'}
          </Button>
          {(!token || error) && <Button variant="text" tone={experience.id} fullWidth onClick={() => navigate('/forgot-password', { state: { app: experience.id, returnTo } })}>Request a new reset link</Button>}
          <Button
            variant="text"
            tone={experience.id}
            fullWidth
            onClick={() => navigate('/login', { state: { app: experience.id, returnTo } })}
          >
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
