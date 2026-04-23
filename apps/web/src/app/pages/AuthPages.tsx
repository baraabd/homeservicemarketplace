import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, Eye, EyeOff, Lock, Mail, RefreshCcw, XCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth-provider';
import * as authApi from '../../lib/auth-api';
import { LoginScreen, SignUpScreen, ForgotPasswordScreen } from '../components/auth/AuthScreens';
import { Button } from '../components/ds/Button';
import { TextField } from '../components/ds/TextField';

// Only in-app paths are honored as returnTo. Reject absolute URLs and
// protocol-relative strings to prevent open-redirect via the login page.
function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw) return '/home';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/home';
  if (raw === '/login') return '/home';
  return raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN PAGE  /login
// ─────────────────────────────────────────────────────────────────────────────
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const state = location.state as {
    registered?: boolean;
    returnTo?: string;
    email?: string;
  } | null;
  const justRegistered = state?.registered;
  const returnTo = sanitizeReturnTo(state?.returnTo);

  const { verifyOtp, resendOtp } = useAuth();

  return (
    <LoginScreen
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
        navigate(returnTo, { replace: true });
      }}
      onOtpResend={async (challengeId: string) => {
        await resendOtp(challengeId);
      }}
      onSignUp={() => navigate('/signup')}
      onForgotPassword={() => navigate('/forgot-password')}
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
  const { register: doRegister, verifyOtp, resendOtp } = useAuth();

  return (
    <SignUpScreen
      onBack={() => navigate('/login')}
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
        // Registration OTP success also issues the session, so we drop
        // straight into the authed area rather than bouncing to /login.
        navigate('/home', { replace: true });
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
  return (
    <ForgotPasswordScreen
      onBack={() => navigate('/login')}
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
  const email = (location.state as { email?: string } | null)?.email ?? '';
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
        <div className="w-24 h-24 rounded-full bg-amber-100 flex items-center justify-center mb-6">
          <Mail size={44} className="text-amber-500" />
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
            fullWidth
            onClick={() => navigate('/login')}
            leadingIcon={<CheckCircle2 size={16} />}
          >
            Back to sign in
          </Button>
          <Button
            variant="text"
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
  const token = params.get('token');
  const firedRef = useRef(false);
  const [status, setStatus] = useState<VerifyState>(token ? 'verifying' : 'missing');

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
          <Loader2 size={40} className="text-amber-500 animate-spin mb-4" />
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
            onClick={() => navigate('/login')}
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
            <Button variant="primary" onClick={() => navigate('/login')}>
              Back to sign in
            </Button>
            <Button variant="text" onClick={() => navigate('/check-email')}>
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
  const token = useMemo(() => params.get('token') ?? '', [params]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);

  const validate = (): string | undefined => {
    if (!token) return 'This reset link is missing a token.';
    if (password.length < 12) return 'Password must be at least 12 characters.';
    if (password !== confirm) return 'Passwords do not match.';
    return undefined;
  };

  const onSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(undefined);
    setIsLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (e: unknown) {
      const axiosStatus = (e as { response?: { status?: number } } | undefined)?.response?.status;
      setError(
        axiosStatus === 400
          ? 'This reset link is invalid or expired. Request a new one.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
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
        <Button variant="primary" onClick={() => navigate('/login')}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-white" style={{ minHeight: '100svh' }}>
      <div className="flex-1 px-6 py-10 max-w-md mx-auto w-full">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-amber-100 flex items-center justify-center">
            <Lock size={32} className="text-amber-500" />
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
            fullWidth
            state={isLoading ? 'loading' : !token ? 'disabled' : 'default'}
            onClick={onSubmit}
          >
            {isLoading ? 'Updating…' : 'Update password'}
          </Button>
          <Button variant="text" fullWidth onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
