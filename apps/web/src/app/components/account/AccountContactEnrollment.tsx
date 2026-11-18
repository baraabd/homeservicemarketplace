import { useId, useRef, useState } from 'react';
import type { AuthOtpChannel, OtpChallengeResponse } from '@homeservicemarketplace/contracts';
import { PhoneIdentityField } from '../auth/PhoneIdentityField';
import { toE164Phone, isValidPhoneIdentity } from '../../../lib/phone-identity';
import { requestContactVerification, verifyContact } from '../../../lib/auth-contact-api';
import { extractAuthError } from '../../../lib/auth-errors';
import { normalizeDecimalDigits } from '../../../lib/normalize-decimal-digits';

/** One password-confirmed ownership journey for either account contact. */
export function AccountContactEnrollment({
  channel,
  lang,
  disabled,
  canRequest = true,
  onVerified,
}: {
  channel: AuthOtpChannel;
  lang: string;
  disabled: boolean;
  canRequest?: boolean;
  onVerified: () => Promise<void>;
}) {
  const ar = lang === 'ar';
  const whatsapp = channel === 'whatsapp';
  const id = useId();
  const [country, setCountry] = useState('');
  const [number, setNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<OtpChallengeResponse | null>(null);
  const [contactConfirmed, setContactConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const flight = useRef(false);
  const validIdentity = whatsapp
    ? isValidPhoneIdentity(country, number)
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim());
  const validCode = /^\d{6}$/u.test(code);
  const contact = whatsapp ? toE164Phone(country, number) : email.trim();
  const requestDisabled = disabled || busy || !canRequest;
  async function submit() {
    if (
      flight.current ||
      disabled ||
      (challenge ? !contactConfirmed && !validCode : !canRequest || !password || !validIdentity)
    )
      return;
    flight.current = true;
    setBusy(true);
    setFeedback('');
    let confirmed = contactConfirmed;
    try {
      if (challenge) {
        if (!confirmed) {
          await verifyContact(channel, challenge.challengeId, code);
          confirmed = true;
          setContactConfirmed(true);
        }
        await onVerified();
        setCode('');
        setChallenge(null);
        setContactConfirmed(false);
        setFeedback(
          whatsapp
            ? ar
              ? 'تم تأكيد رقم واتساب.'
              : 'WhatsApp number verified.'
            : ar
              ? 'تم تأكيد البريد الإلكتروني.'
              : 'Email address verified.',
        );
      } else {
        setChallenge(await requestContactVerification(channel, contact, password));
        setPassword('');
      }
    } catch (error) {
      const { status } = extractAuthError(error);
      setFeedback(
        confirmed
          ? ar
            ? 'تم قبول الرمز، لكن تعذّر تحديث بيانات الحساب. حدّث حالة التحقق للمتابعة.'
            : 'The code was accepted, but account details could not refresh. Refresh verification to continue.'
          : status === 429
            ? ar
              ? 'طلبات كثيرة. انتظر قليلًا ثم حاول مجددًا.'
              : 'Too many requests. Please wait before trying again.'
            : ar
              ? 'تعذّر التحقق. راجع بيانات التواصل وكلمة المرور أو الرمز وحاول مجددًا.'
              : 'Verification failed. Check the contact details, password or code and try again.',
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
      aria-labelledby={`${id}-title`}
    >
      <h4 id={`${id}-title`} className="font-bold text-slate-900 dark:text-white">
        {whatsapp
          ? ar
            ? 'أكد رقم واتساب لحسابك أولًا'
            : 'Verify your WhatsApp number first'
          : ar
            ? 'أكد بريدًا إلكترونيًا لحسابك أولًا'
            : 'Verify an email address first'}
      </h4>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {ar
          ? 'لحماية وصولك إلى حسابك، أكد ملكية وسيلة التواصل قبل استخدامها لتسجيل الدخول.'
          : 'Protect access to your account by verifying this contact before using it to sign in.'}
      </p>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {challenge ? (
          <>
            <label htmlFor={`${id}-code`} className="text-sm font-semibold">
              {whatsapp
                ? ar
                  ? 'رمز التحقق المرسل إلى واتساب'
                  : 'Verification code sent to WhatsApp'
                : ar
                  ? 'رمز التحقق المرسل إلى البريد الإلكتروني'
                  : 'Verification code sent to email'}
            </label>
            {challenge.maskedDestination && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                <bdi>{challenge.maskedDestination}</bdi>
              </p>
            )}
            <input
              id={`${id}-code`}
              value={code}
              onChange={(e) =>
                setCode(normalizeDecimalDigits(e.target.value).replace(/\D/gu, '').slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="[0-9]{6}"
              dir="ltr"
              className="min-h-12 rounded-xl border border-slate-300 bg-transparent px-4 text-center text-xl tracking-widest dark:border-slate-600"
              required
              disabled={disabled || busy || contactConfirmed}
            />
          </>
        ) : (
          <>
            {whatsapp ? (
              <PhoneIdentityField
                countryCode={country}
                onCountryChange={setCountry}
                localNumber={number}
                onNumberChange={setNumber}
                disabled={requestDisabled}
              />
            ) : (
              <>
                <label htmlFor={`${id}-email`} className="text-sm font-semibold">
                  {ar ? 'البريد الإلكتروني' : 'Email address'}
                </label>
                <input
                  id={`${id}-email`}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                  className="min-h-12 rounded-xl border border-slate-300 bg-transparent px-4 text-base dark:border-slate-600"
                  required
                  disabled={requestDisabled}
                />
              </>
            )}
            <label htmlFor={`${id}-password`} className="text-sm font-semibold">
              {ar ? 'كلمة المرور الحالية' : 'Current password'}
            </label>
            <input
              id={`${id}-password`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-12 rounded-xl border border-slate-300 bg-transparent px-4 text-base dark:border-slate-600"
              required
              disabled={requestDisabled}
            />
          </>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={
              disabled ||
              busy ||
              (challenge
                ? !contactConfirmed && !validCode
                : !canRequest || !password || !validIdentity)
            }
            className="min-h-11 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {contactConfirmed
              ? busy
                ? ar
                  ? 'جارٍ تحديث حالة التحقق…'
                  : 'Refreshing verification…'
                : ar
                  ? 'تحديث حالة التحقق'
                  : 'Refresh verification'
              : busy
                ? ar
                  ? 'جارٍ التحقق…'
                  : 'Verifying…'
                : challenge
                  ? whatsapp
                    ? ar
                      ? 'تأكيد الرقم'
                      : 'Verify number'
                    : ar
                      ? 'تأكيد البريد'
                      : 'Verify email'
                  : whatsapp
                    ? ar
                      ? 'إرسال رمز إلى واتساب'
                      : 'Send code to WhatsApp'
                    : ar
                      ? 'إرسال رمز إلى البريد'
                      : 'Send code to email'}
          </button>
          {challenge && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                setCode('');
                setChallenge(null);
                setContactConfirmed(false);
                setFeedback('');
              }}
              className="min-h-11 rounded-xl px-4 py-2 text-sm underline"
            >
              {ar ? 'تغيير وسيلة التواصل أو طلب رمز جديد' : 'Change contact or request a new code'}
            </button>
          )}
        </div>
        {feedback && (
          <p className="text-sm" role="status">
            {feedback}
          </p>
        )}
      </form>
    </section>
  );
}
