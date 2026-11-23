import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Lock, Mail, Send } from 'lucide-react';
import { Button } from '../ds/Button';
import { TextField } from '../ds/TextField';
import { useLang } from '../../i18n/LanguageContext';
import { recoveryRequestErrorMessage } from '../../../lib/auth-errors';
import {
  type AuthExperience,
  AUTH_EXPERIENCES,
  DEFAULT_EXPERIENCE_ID,
} from '../../../lib/auth-experience';
import { AuthTopBar, SwipeableScreen } from './AuthLayout';

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD SCREEN — wired to POST /v1/auth/forgot-password.
//
// The backend returns 202 for both existing and unknown emails
// (anti-enumeration). We always show the "check inbox" success state on a
// 2xx response, and keep the user on the form with an error hint on a
// network/5xx failure.
// ─────────────────────────────────────────────────────────────────────────────
interface ForgotPwProps {
  onUseWhatsApp?: () => void;
  onBack: () => void;
  onSubmit: (email: string) => Promise<void>;
  // Sprint 5.1.1: experience-aware theming.
  experience?: AuthExperience;
}

export function ForgotPasswordScreen({
  onUseWhatsApp,
  onBack,
  onSubmit,
  experience = AUTH_EXPERIENCES[DEFAULT_EXPERIENCE_ID],
}: ForgotPwProps) {
  const { t, lang } = useLang();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const requestFlight = useRef(false);
  const handleSend = async () => {
    if (!email || requestFlight.current) return;
    requestFlight.current = true;
    setIsLoading(true);
    setError(undefined);
    try {
      await onSubmit(email.trim());
      setSubmitted(true);
    } catch (err: unknown) {
      setError(
        lang === 'ar'
          ? 'تعذر تأكيد الطلب. حاول مجدداً بعد قليل.'
          : recoveryRequestErrorMessage(err),
      );
    } finally {
      requestFlight.current = false;
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
                <div
                  className={`absolute -top-1 -end-1 w-8 h-8 rounded-full ${experience.classes.accentBg} flex items-center justify-center shadow-md`}
                >
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
                {lang === 'ar'
                  ? 'تم استلام الطلب. إذا كان الحساب مؤهلاً فستصلك تعليمات الاستعادة.'
                  : 'Request received. If the account is eligible, check your inbox for recovery instructions.'}
              </p>
              <div
                className={`inline-flex items-center gap-2 ${experience.classes.softBg} border ${experience.classes.softBorder} rounded-2xl px-4 py-2 mb-8`}
              >
                <Mail size={14} className={experience.classes.accentText} />
                <span
                  className={experience.classes.accentText}
                  style={{ fontSize: '14px', fontWeight: 600 }}
                >
                  {email}
                </span>
              </div>
              <Button variant="primary" tone={experience.id} fullWidth onClick={onBack}>
                {t('backToLogin')}
              </Button>
              <div className="mt-4">
                <Button
                  variant="text"
                  tone={experience.id}
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
                  <div
                    className={`w-20 h-20 rounded-2xl ${experience.classes.iconChipBg} flex items-center justify-center`}
                  >
                    <Lock size={32} className={experience.classes.iconChipText} />
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
                  autoComplete="email"
                  onEnter={() => {
                    void handleSend();
                  }}
                  value={email}
                  onChange={setEmail}
                  leadingIcon={<Mail size={16} />}
                />

                <Button
                  variant="primary"
                  tone={experience.id}
                  state={isLoading ? 'loading' : !email ? 'disabled' : 'default'}
                  fullWidth
                  onClick={handleSend}
                  leadingIcon={<Send size={16} />}
                >
                  {t('sendResetLink')}
                </Button>

                {onUseWhatsApp && (
                  <button
                    type="button"
                    className="min-h-11 text-sm underline"
                    onClick={onUseWhatsApp}
                  >
                    {lang === 'ar' ? 'استعادة حساب واتساب' : 'Recover a WhatsApp account'}
                  </button>
                )}

                {error && (
                  <p role="alert" className="text-red-500 text-center" style={{ fontSize: '13px' }}>
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
                  <Button variant="text" tone={experience.id} onClick={onBack}>
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
