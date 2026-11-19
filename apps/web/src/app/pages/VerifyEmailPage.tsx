import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth-provider';
import * as authApi from '../../lib/auth-api';
import { sanitizeAuthReturnTo } from '../../lib/auth-return-to';
import { resolveAuthExperience } from '../../lib/auth-experience';
import { useLang } from '../i18n/LanguageContext';
import { Button } from '../components/ds/Button';

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY EMAIL PAGE  /verify-email?token=...
// Backend email link lands here. We POST the token exactly once on mount
// (guarded against React 18 StrictMode double-invocation) and render
// success / invalid / network error with actions.
// ─────────────────────────────────────────────────────────────────────────────
type VerifyState = 'verifying' | 'success' | 'invalid' | 'missing' | 'error';

const VERIFY_EMAIL_COPY = {
  en: {
    verifying: 'Verifying your email…',
    success: 'Email verified',
    successBody: 'Your account is active. You can now sign in.',
    signIn: 'Go to sign in',
    missing: 'No verification token',
    missingBody: 'The verification link is missing a token. Open the email link again.',
    invalid: 'Link invalid or expired',
    invalidBody: 'This verification link is no longer valid. Request a new one and try again.',
    error: 'Something went wrong',
    errorBody: "We couldn't reach the server. Please try again in a moment.",
    retry: 'Try verification again',
    back: 'Back to sign in',
    resend: 'Resend verification',
  },
  ar: {
    verifying: 'جارٍ التحقق من بريدك الإلكتروني…',
    success: 'تم التحقق من البريد الإلكتروني',
    successBody: 'حسابك نشط الآن. يمكنك تسجيل الدخول.',
    signIn: 'الانتقال إلى تسجيل الدخول',
    missing: 'رمز التحقق غير موجود',
    missingBody: 'رابط التحقق لا يحتوي على رمز. افتح الرابط من رسالة البريد مجددًا.',
    invalid: 'الرابط غير صالح أو منتهي الصلاحية',
    invalidBody: 'لم يعد رابط التحقق هذا صالحًا. اطلب رابطًا جديدًا وحاول مجددًا.',
    error: 'تعذّر إتمام التحقق',
    errorBody: 'تعذّر الاتصال بالخادم. انتظر قليلًا ثم حاول مجددًا.',
    retry: 'إعادة محاولة التحقق',
    back: 'العودة إلى تسجيل الدخول',
    resend: 'طلب رابط تحقق جديد',
  },
} as const;

export function VerifyEmailPage() {
  const { lang } = useLang();
  const copy = VERIFY_EMAIL_COPY[lang];
  const { isLoading: isAuthLoading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    app?: 'seeker' | 'provider' | 'admin';
    returnTo?: string;
  } | null;
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
    if (!token) {
      setStatus('missing');
      return;
    }
    // A cold /me refusal establishes the anonymous auth boundary. Start the
    // token request afterwards so that bootstrap cannot discard its successful
    // response as belonging to an older session. Keep normal request fencing.
    if (isAuthLoading) return;
    let active = true;
    setStatus('verifying');
    if (attemptRef.current?.token !== token || attemptRef.current.retry !== retry) {
      attemptRef.current = { token, retry, promise: authApi.verifyEmail(token) };
    }
    void attemptRef.current.promise
      .then(() => {
        if (active) setStatus('success');
      })
      .catch((err: unknown) => {
        if (!active) return;
        const code = (err as { response?: { status?: number } } | undefined)?.response?.status;
        setStatus(code === 400 || code === 403 ? 'invalid' : 'error');
      });
    return () => {
      active = false;
    };
  }, [token, retry, isAuthLoading]);

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
            {copy.verifying}
          </h1>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle2 size={44} className="text-green-500" />
          </div>
          <h1 className="text-slate-900 mb-2" style={{ fontSize: '22px', fontWeight: 800 }}>
            {copy.success}
          </h1>
          <p className="text-slate-500 max-w-sm mb-6" style={{ fontSize: '14px' }}>
            {copy.successBody}
          </p>
          <Button
            variant="primary"
            tone={experience.id}
            onClick={() => navigate('/login', { state: { app: experience.id, returnTo } })}
            leadingIcon={<CheckCircle2 size={16} />}
          >
            {copy.signIn}
          </Button>
        </>
      )}

      {(status === 'invalid' || status === 'missing' || status === 'error') && (
        <>
          <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <XCircle size={44} className="text-red-500" />
          </div>
          <h1 className="text-slate-900 mb-2" style={{ fontSize: '22px', fontWeight: 800 }}>
            {status === 'missing' ? copy.missing : status === 'invalid' ? copy.invalid : copy.error}
          </h1>
          <p className="text-slate-500 max-w-sm mb-6" style={{ fontSize: '14px' }}>
            {status === 'missing'
              ? copy.missingBody
              : status === 'invalid'
                ? copy.invalidBody
                : copy.errorBody}
          </p>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {status === 'error' && (
              <Button
                variant="primary"
                tone={experience.id}
                onClick={() => setRetry((value) => value + 1)}
              >
                {copy.retry}
              </Button>
            )}
            <Button
              variant="primary"
              tone={experience.id}
              onClick={() => navigate('/login', { state: { app: experience.id, returnTo } })}
            >
              {copy.back}
            </Button>
            <Button
              variant="text"
              tone={experience.id}
              onClick={() => navigate('/check-email', { state: { app: experience.id, returnTo } })}
            >
              {copy.resend}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
