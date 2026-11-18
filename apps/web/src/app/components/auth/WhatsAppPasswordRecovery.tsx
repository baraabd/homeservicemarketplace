import { useRef, useState } from 'react';
import { CheckCircle2, Lock } from 'lucide-react';
import { forgotPasswordOtp, resetPasswordOtp, resendOtp } from '../../../lib/auth-api';
import type { AuthExperience } from '../../../lib/auth-experience';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
import { Button } from '../ds/Button';
import { TextField } from '../ds/TextField';
import { EmailOtpPanel, type LoginOtpChallenge } from './AuthScreens';
import { AuthChannelNotice } from './AuthChannelNotice';
import { PhoneIdentityField } from './PhoneIdentityField';
import { toE164Phone, isValidPhoneIdentity } from '../../../lib/phone-identity';
import { otpErrorMessage, otpRecoveryAction } from '../../../lib/auth-errors';

export function WhatsAppPasswordRecovery({
  available = true,
  experience,
  onBack,
  onUseEmail,
}: {
  available?: boolean;
  experience: AuthExperience;
  onBack: () => void;
  onUseEmail: () => void;
}) {
  const { lang } = useLang();
  const [countryCode, setCountryCode] = useState('');
  const [number, setNumber] = useState('');
  const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [restart, setRestart] = useState(false);
  const [done, setDone] = useState(false);
  const flight = useRef(false);
  const phoneNumber = toE164Phone(countryCode, number);
  const request = async () => {
    if (flight.current || !available || !isValidPhoneIdentity(countryCode, number)) return;
    flight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      setChallenge(await forgotPasswordOtp(phoneNumber));
      setRestart(false);
    } catch {
      setError(
        lang === 'ar'
          ? 'تعذّر إرسال الطلب. انتظر قليلًا وحاول مجددًا.'
          : 'We could not confirm your request. Please try again shortly.',
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  const resend = async () => {
    if (!challenge || flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await resendOtp(challenge.challengeId);
    } catch (cause) {
      setError(otpErrorMessage(cause, 'resend', lang));
      setRestart(otpRecoveryAction(cause, 'resend') === 'restart');
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  const reset = async (code: string) => {
    if (!challenge || flight.current) return;
    if (password.length < 12 || password !== confirmation) {
      setError(
        lang === 'ar'
          ? 'اكتب كلمة مرور من 12 حرفًا على الأقل وأكدها بنفس القيمة.'
          : 'Use at least 12 characters and enter the same password twice.',
      );
      return;
    }
    flight.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await resetPasswordOtp(challenge.challengeId, code, password);
      setPassword('');
      setConfirmation('');
      setDone(true);
    } catch (cause) {
      setError(otpErrorMessage(cause, 'verify', lang));
      setRestart(otpRecoveryAction(cause, 'verify') === 'restart');
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  return (
    <main className="min-h-svh bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <button
          type="button"
          className="min-h-11 rounded-xl px-3 text-slate-700 underline"
          onClick={onBack}
        >
          {lang === 'ar' ? 'العودة للدخول' : 'Back to sign in'}
        </button>
        <LangToggle />
      </header>
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-5 py-8">
        <h1 className="text-2xl font-bold text-slate-900">
          {done
            ? lang === 'ar'
              ? 'تم تحديث كلمة المرور'
              : 'Password updated'
            : lang === 'ar'
              ? 'استعادة حسابك'
              : 'Recover your account'}
        </h1>
        {done ? (
          <>
            <CheckCircle2 className="text-emerald-700" size={42} />
            <p role="status">
              {lang === 'ar'
                ? 'يمكنك الآن الدخول بكلمة المرور الجديدة.'
                : 'You can now sign in with your new password.'}
            </p>
            <Button variant="primary" tone={experience.id} onClick={onBack}>
              {lang === 'ar' ? 'تسجيل الدخول' : 'Sign in'}
            </Button>
          </>
        ) : !challenge ? (
          <>
            <AuthChannelNotice channel="whatsapp" available={available} />
            <p className="text-sm leading-6 text-slate-600">
              {lang === 'ar'
                ? 'إذا كان الرقم مرتبطًا بحساب مؤهل، سيصلك رمز استعادة عبر واتساب.'
                : 'If this number belongs to an eligible account, you will receive a recovery code on WhatsApp.'}
            </p>
            <PhoneIdentityField
              countryCode={countryCode}
              onCountryChange={setCountryCode}
              localNumber={number}
              onNumberChange={setNumber}
              disabled={busy}
            />
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <Button
              variant="primary"
              tone={experience.id}
              fullWidth
              state={
                busy
                  ? 'loading'
                  : !available || !isValidPhoneIdentity(countryCode, number)
                    ? 'disabled'
                    : 'default'
              }
              onClick={() => void request()}
            >
              {lang === 'ar' ? 'طلب رمز الاستعادة' : 'Send recovery code'}
            </Button>
            <button type="button" className="min-h-11 text-sm underline" onClick={onUseEmail}>
              {lang === 'ar' ? 'استعادة حساب البريد الإلكتروني' : 'Recover an email account'}
            </button>
          </>
        ) : (
          <>
            <TextField
              label={lang === 'ar' ? 'كلمة المرور الجديدة' : 'New password'}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              leadingIcon={<Lock size={18} />}
              hint={lang === 'ar' ? '12 حرفًا على الأقل' : 'At least 12 characters'}
              disabled={busy}
            />
            <TextField
              label={lang === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password'}
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={setConfirmation}
              disabled={busy}
            />
            <EmailOtpPanel
              email={challenge.maskedDestination ?? phoneNumber}
              channel="whatsapp"
              codeLength={challenge.codeLength}
              onVerify={reset}
              onResend={resend}
              isVerifying={busy}
              verifyError={error}
              recovery={restart ? 'restart' : null}
              experience={experience}
              onRestart={() => {
                setChallenge(null);
                setError(undefined);
                setRestart(false);
              }}
              restartLabel={lang === 'ar' ? 'طلب رمز جديد' : 'Request a new code'}
            />
          </>
        )}
      </div>
    </main>
  );
}
