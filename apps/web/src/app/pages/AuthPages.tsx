import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, Eye, EyeOff, Lock, Mail, RefreshCcw, XCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth-provider';
import * as authApi from '../../lib/auth-api';
import { resetPasswordErrorMessage } from '../../lib/auth-errors';
import { getIntendedApp } from '../../lib/intended-app';
import { resolveAuthExperience, resolvePostAuthDestination } from '../../lib/auth-experience';
import { LoginScreen, SignUpScreen, ForgotPasswordScreen } from '../components/auth/AuthScreens';
import { Button } from '../components/ds/Button';
import { TextField } from '../components/ds/TextField';

// Only in-app paths are honoured as returnTo. Reject absolute URLs and
// protocol-relative strings to prevent open-redirect via the login page.
// Returning null lets the caller fall back through the wider precedence
// chain (intent → role inference) implemented in
// `resolvePostAuthDestination`. This is what keeps
// "click Provider → log in → land on Provider" working even when
// intermediate auth navigations (Sign up button, Forgot password,
// Reset password completion) drop react-router state.
function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  // /login itself is not a valid post-auth destination.
  if (raw === '/login') return null;
  return raw;
}

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
  const returnTo = sanitizeReturnTo(state?.returnTo);

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
      onSignUp={() =>
        // Forward the resolved experience explicitly so the Sign-up
        // screen keeps the SAME theme — react-router state is otherwise
        // dropped through this navigation.
        navigate('/signup', { state: { app: experience.id } })
      }
      onForgotPassword={() => navigate('/forgot-password', { state: { app: experience.id } })}
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
  const state = location.state as { app?: 'seeker' | 'provider' | 'admin' } | null;

  const experience = resolveAuthExperience({ explicit: state?.app });

  return (
    <SignUpScreen
      experience={experience}
      onBack={() => navigate('/login', { state: { app: experience.id } })}
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
  const state = location.state as { app?: 'seeker' | 'provider' | 'admin' } | null;
  const experience = resolveAuthExperience({ explicit: state?.app });
  return (
    <ForgotPasswordScreen
      experience={experience}
      onBack={() => navigate('/login', { state: { app: experience.id } })}
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
  const state = location.state as { email?: string; app?: 'seeker' | 'provider' | 'admin' } | null;
  const email = state?.email ?? '';
  const experience = resolveAuthExperience({ explicit: state?.app });
  const [isResending, setIsResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  const onResend = useCallback(async () => {
    if (!email) {
      setResendStatus('error');
      return;
    }
    setIsResending(true);
    try {
      await authApi.resendVerification(email);
      setResendStatus('sent');
    } catch {
      setResendStatus('error');
    } finally {
      setIsResending(false);
    }
  }, [email]);

  return (
    <div className="flex flex-col bg-white" style={{ minHeight: '100svh' }}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div
          data-testid={`auth-page-${experience.id}`}
          className={`w-24 h-24 rounded-full ${experience.classes.iconChipBg} flex items-center justify-center mb-6`}
        >
          <Mail size={44} className={experience.classes.iconChipText} />
        </div>
        <h1 className="text-slate-900 mb-2" style={{ fontSize: '24px', fontWeight: 800 }}>
          Check your email
        </h1>
        <p className="text-slate-500 max-w-sm mb-1" style={{ fontSize: '14px', lineHeight: '1.6' }}>
          We sent a verification link
          {email ? (
            <>
              {' '}
              to{' '}
              <span className="text-slate-900" style={{ fontWeight: 700 }}>
                {email}
              </span>
              .
            </>
          ) : (
            '.'
          )}{' '}
          Click the link in the email to activate your account, then sign in.
        </p>
        <p className="text-slate-400 mb-6" style={{ fontSize: '12px' }}>
          The link expires in 24 hours. Didn't get it? Check spam, or resend below.
        </p>

        <div className="w-full max-w-sm flex flex-col gap-3">
          <Button
            variant="primary"
            tone={experience.id}
            fullWidth
            onClick={() => navigate('/login', { state: { app: experience.id } })}
            leadingIcon={<CheckCircle2 size={16} />}
          >
            Back to sign in
          </Button>
          <Button
            variant="text"
            tone={experience.id}
            fullWidth
            state={isResending ? 'loading' : !email ? 'disabled' : 'default'}
            onClick={onResend}
            leadingIcon={<RefreshCcw size={16} />}
          >
            {isResending ? 'Resending…' : 'Resend verification email'}
          </Button>
          {resendStatus === 'sent' && (
            <p className="text-green-600" style={{ fontSize: '12px' }}>
              If an account exists for that email, a new link has been sent.
            </p>
          )}
          {resendStatus === 'error' && (
            <p className="text-red-500" style={{ fontSize: '12px' }}>
              Couldn't resend right now. Please try again shortly.
            </p>
          )}
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
  const state = location.state as { app?: 'seeker' | 'provider' | 'admin' } | null;
  const token = params.get('token');
  const firedRef = useRef(false);
  const [status, setStatus] = useState<VerifyState>(token ? 'verifying' : 'missing');
  // Verification links arrive cold (the user clicks an email link in
  // a fresh tab) so there's no react-router state — we resolve from
  // sessionStorage intent + the explicit state override.
  const experience = resolveAuthExperience({ explicit: state?.app });

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (!token) {
      setStatus('missing');
      return;
    }
    authApi
      .verifyEmail(token)
      .then(() => setStatus('success'))
      .catch((err: unknown) => {
        const axiosStatus = (err as { response?: { status?: number } } | undefined)?.response
          ?.status;
        // 400 is what the backend returns for invalid / already-consumed /
        // expired tokens (it never distinguishes, to avoid probing).
        if (axiosStatus === 400) setStatus('invalid');
        else setStatus('error');
      });
  }, [token]);

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
            onClick={() => navigate('/login', { state: { app: experience.id } })}
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
            <Button
              variant="primary"
              tone={experience.id}
              onClick={() => navigate('/login', { state: { app: experience.id } })}
            >
              Back to sign in
            </Button>
            <Button
              variant="text"
              tone={experience.id}
              onClick={() => navigate('/check-email', { state: { app: experience.id } })}
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
  const state = location.state as { app?: 'seeker' | 'provider' | 'admin' } | null;
  const token = useMemo(() => params.get('token') ?? '', [params]);
  // Password-reset links arrive cold from email — we lean on the same
  // explicit-state + intent fallback that VerifyEmailPage uses.
  const experience = resolveAuthExperience({ explicit: state?.app });
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
          onClick={() => navigate('/login', { state: { app: experience.id } })}
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
            label="Confirm password"
            type={showPw ? 'text' : 'password'}
            value={confirm}
            onChange={setConfirm}
            leadingIcon={<Lock size={16} />}
          />

          {error && (
            <p className="text-red-500 text-center" style={{ fontSize: '13px' }}>
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
          <Button
            variant="text"
            tone={experience.id}
            fullWidth
            onClick={() => navigate('/login', { state: { app: experience.id } })}
          >
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
