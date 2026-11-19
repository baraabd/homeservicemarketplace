import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CURRENT_LEGAL_DOCUMENTS,
  DEFAULT_AUTH_OTP_CHANNEL,
  type LegalAcceptanceInput,
} from '@homeservicemarketplace/contracts';
import { Button } from '../ds/Button';
import { TextField } from '../ds/TextField';
import { useLang } from '../../i18n/LanguageContext';
import { getLegalDocuments } from '../../../lib/auth-api';
import {
  SIGNUP_CONSENT_COPY,
  clearSignupDraft,
  legalRefusalReason,
  readSignupDraft,
  writeSignupDraft,
} from '../../features/legal/signup-consent';
import type { OtpChannel } from '../../../lib/auth-channel';
import { PhoneIdentityField } from './PhoneIdentityField';
import { toE164Phone, isValidPhoneIdentity } from '../../../lib/phone-identity';
import { AuthChannelNotice } from './AuthChannelNotice';
import {
  extractAuthError,
  otpErrorMessage,
  otpRecoveryAction,
  type OtpRecoveryAction,
  registrationErrorMessage,
} from '../../../lib/auth-errors';
import {
  type AuthExperience,
  AUTH_EXPERIENCES,
  DEFAULT_EXPERIENCE_ID,
} from '../../../lib/auth-experience';
import { EmailOtpPanel, type LoginOtpChallenge } from './AuthScreens';
import { AuthTopBar, SwipeableScreen } from './AuthLayout';

// Policy content loads only when its dialog is opened.
const PolicyDialog = lazy(() =>
  import('../../features/legal/components/PolicyDialog').then((module) => ({
    default: module.PolicyDialog,
  })),
);

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

// ─────────────────────────────────────────────────────────────────────────────
// SIGN UP SCREEN — server-selected identity, credentials, then OTP verification.
// Country is suggested from device settings; precise location remains opt-in.
// ─────────────────────────────────────────────────────────────────────────────
interface SignUpProps {
  channel?: OtpChannel;
  whatsappAvailable?: boolean;
  onBack: () => void;
  onRecoverVerification?: (email: string) => void;
  // Parent POSTs the credentials, receives the OTP challenge, and returns
  // it so this screen can drive Step 3. Session issuance happens via the
  // OTP callbacks below, NOT here.
  onCredentialsSubmit: (data: {
    name: string;
    email?: string;
    phoneNumber?: string;
    password: string;
    legalAcceptance: LegalAcceptanceInput;
  }) => Promise<LoginOtpChallenge>;
  onOtpVerify: (challengeId: string, code: string) => Promise<void>;
  onOtpResend: (challengeId: string) => Promise<void>;
  // Sprint 5.1.1: experience-aware theming. See LoginScreen prop
  // comment for rationale.
  experience?: AuthExperience;
}

export function SignUpScreen({
  channel = DEFAULT_AUTH_OTP_CHANNEL,
  whatsappAvailable = false,
  onBack,
  onRecoverVerification,
  onCredentialsSubmit,
  onOtpVerify,
  onOtpResend,
  experience = AUTH_EXPERIENCES[DEFAULT_EXPERIENCE_ID],
}: SignUpProps) {
  const { t, lang } = useLang();
  const queryClient = useQueryClient();

  // K02 — a non-secret draft (never the password) survives a reload or a
  // visit to a full policy page; the in-place policy dialog keeps everything
  // in memory, so it needs no storage at all.
  const draft = useMemo(readSignupDraft, []);
  const [step, setStep] = useState<number>(draft?.step ?? 1); // 1 = info, 2 = credentials, 3 = OTP
  const [name, setName] = useState(draft?.name ?? '');
  // Phone is split into a dial code the user can override + the local number.
  const [countryCode, setCountryCode] = useState(draft?.countryCode ?? '');
  const [localNumber, setLocalNumber] = useState(draft?.localNumber ?? '');
  const [email, setEmail] = useState(draft?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [acceptance, setAcceptance] = useState<LegalAcceptanceInput | null>(null);
  const [policyOpen, setPolicyOpen] = useState<'terms' | 'privacy' | null>(null);
  const legalQuery = useQuery({
    queryKey: ['legal', 'documents'],
    queryFn: getLegalDocuments,
    staleTime: 5 * 60_000,
  });
  const legalDocs = legalQuery.data;
  const termsDoc = legalDocs?.documents.find((d) => d.kind === 'TERMS_OF_SERVICE');
  const privacyDoc = legalDocs?.documents.find((d) => d.kind === 'PRIVACY_NOTICE');
  // The dialog renders the policy text shipped with this web build. During a
  // rolling release it can lag behind the API's current document versions.
  const samePolicies =
    termsDoc?.version === CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version &&
    privacyDoc?.version === CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version;
  const legalReady = samePolicies && legalDocs?.acceptanceOpen === true;
  const agreed =
    legalReady &&
    acceptance !== null &&
    acceptance.termsVersion === termsDoc?.version &&
    acceptance.privacyVersion === privacyDoc?.version &&
    acceptance.locale === lang;
  useEffect(() => {
    if (acceptance && !agreed) setAcceptance(null);
  }, [acceptance, agreed]);
  const consentCopy = SIGNUP_CONSENT_COPY[lang === 'ar' ? 'ar' : 'en'];

  useEffect(() => {
    if (step < 3) writeSignupDraft({ step, name, email, countryCode, localNumber });
  }, [step, name, email, countryCode, localNumber]);
  const [isLoading, setIsLoading] = useState(false);
  const [signUpError, setSignUpError] = useState<string | undefined>();
  const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [otpError, setOtpError] = useState<Record<'en' | 'ar', string> | undefined>();
  const [otpRecovery, setOtpRecovery] = useState<OtpRecoveryAction>(null);
  const [resendNotice, setResendNotice] = useState<string | undefined>();
  const requestFlight = useRef(false);

  const phoneNumber = toE164Phone(countryCode, localNumber);
  const canStep1 =
    name.trim().length > 2 &&
    (channel === 'email' || (whatsappAvailable && isValidPhoneIdentity(countryCode, localNumber)));
  const canStep2 =
    (channel === 'whatsapp'
      ? whatsappAvailable && isValidPhoneIdentity(countryCode, localNumber)
      : email.includes('@')) &&
    password.length >= 12 &&
    agreed &&
    legalReady;

  const goNext = async () => {
    if (requestFlight.current) return;
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      requestFlight.current = true;
      setIsLoading(true);
      setSignUpError(undefined);
      try {
        if (!canStep2 || !acceptance) return;
        const issued = await onCredentialsSubmit({
          name,
          ...(channel === 'whatsapp' ? { phoneNumber } : { email: email.trim() }),
          password,
          legalAcceptance: acceptance,
        });
        clearSignupDraft();
        setChallenge(issued);
        setOtpRecovery(null);
        setOtpError(undefined);
        setResendNotice(undefined);
        setStep(3);
      } catch (err: unknown) {
        if (extractAuthError(err).code === 'AUTH_CHANNEL_CHANGED') {
          await queryClient.invalidateQueries({ queryKey: ['auth', 'config'] });
          setStep(1);
          setSignUpError(
            lang === 'ar'
              ? 'تغيرت طريقة التحقق. راجع بيانات التواصل ثم تابع.'
              : 'The verification method changed. Review your contact details to continue.',
          );
        } else if (legalRefusalReason(err) === 'LEGAL_VERSION_STALE') {
          // The policy changed while the form was open: the box is cleared
          // so the person accepts the version they can now read.
          setAcceptance(null);
          void legalQuery.refetch();
          setSignUpError(consentCopy.stale);
        } else if (legalRefusalReason(err) === 'LEGAL_ACCEPTANCE_CLOSED') {
          setAcceptance(null);
          void legalQuery.refetch();
          setSignUpError(consentCopy.closed);
        } else {
          setSignUpError(
            lang === 'ar'
              ? 'تعذر تأكيد التسجيل. تحقق من البيانات وحاول مجدداً.'
              : registrationErrorMessage(err),
          );
        }
      } finally {
        requestFlight.current = false;
        setIsLoading(false);
      }
      return;
    }
    // Step 3 has its own primary CTA inside EmailOtpPanel — the sticky
    // bottom CTA is hidden in that step (see render below).
  };

  const handleOtpVerify = async (code: string) => {
    if (!challenge || requestFlight.current || otpRecovery === 'restart') return;
    requestFlight.current = true;
    setIsVerifying(true);
    setOtpError(undefined);
    try {
      await onOtpVerify(challenge.challengeId, code);
      // Parent takes over (navigation to /home / returnTo).
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

  if (step < 3 && legalDocs && !legalReady) {
    return (
      <SwipeableScreen onBack={onBack}>
        <div className="flex min-h-svh flex-col bg-white">
          <AuthTopBar title={t('createAccount')} onBack={onBack} />
          <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-8">
            <h2 role="status" className="text-lg font-semibold text-slate-900">
              {legalDocs.acceptanceOpen ? consentCopy.updateRequired : consentCopy.closed}
            </h2>
            <a className="min-h-11 underline" href="/legal/terms">
              {consentCopy.readTerms}
            </a>
            <a className="min-h-11 underline" href="/legal/privacy">
              {consentCopy.readPrivacy}
            </a>
            <Button variant="primary" tone={experience.id} onClick={onBack}>
              {t('login')}
            </Button>
            {legalDocs.acceptanceOpen && (
              <button
                type="button"
                className="min-h-11 underline"
                onClick={() => window.location.reload()}
              >
                {consentCopy.reload}
              </button>
            )}
          </main>
        </div>
      </SwipeableScreen>
    );
  }

  const stepLabels = [t('accountInfo'), t('createAccount'), t('verification')];

  return (
    <SwipeableScreen onBack={step > 1 ? () => setStep((s) => s - 1) : onBack}>
      <div className="flex flex-col bg-white" style={{ height: '100svh' }}>
        <AuthTopBar
          title={t('createAccount')}
          onBack={step > 1 ? () => setStep((s) => s - 1) : onBack}
        />

        <div
          className="flex-1 overflow-y-auto px-6 py-6"
          style={{
            scrollbarWidth: 'none',
            // Phase 1 Bug 1 — guarantee that the iOS safe-area inset
            // (home-bar / bottom gesture area) is never under the
            // sticky-bottom CTA. The form's own footer takes care of
            // its own padding; this is an additional gutter so any
            // future floating element (e.g. the desktop watermark)
            // can never re-creep over the scrollable content.
            paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
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
              <div key={label} className="flex min-w-0 items-center gap-2 flex-1">
                <div
                  className={`flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 transition-all ${
                    i + 1 < step
                      ? `${experience.classes.accentBg} text-white`
                      : i + 1 === step
                        ? `${experience.classes.accentBg} text-white ring-2 ${experience.classes.activeRing}`
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
                    color: i + 1 <= step ? experience.accentHex : '#94a3b8',
                  }}
                >
                  {label}
                </span>
                {i < stepLabels.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 rounded-full ${i + 1 < step ? experience.classes.activeConnector : 'bg-slate-100'}`}
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

              <AuthChannelNotice channel={channel} available={whatsappAvailable} />
              {channel === 'whatsapp' && (
                <PhoneIdentityField
                  experience={experience.id}
                  countryCode={countryCode}
                  onCountryChange={setCountryCode}
                  localNumber={localNumber}
                  onNumberChange={setLocalNumber}
                />
              )}
            </div>
          )}

          {/* ── Step 2: Account Credentials ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              {channel === 'email' ? (
                <TextField
                  label={t('emailAddress')}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={setEmail}
                  leadingIcon={<Mail size={16} />}
                />
              ) : (
                <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950">
                  <p>{lang === 'ar' ? 'رقم واتساب' : 'WhatsApp number'}</p>
                  <p dir="ltr" className="mt-1 font-semibold">
                    {phoneNumber}
                  </p>
                  <button
                    type="button"
                    className="mt-1 min-h-11 underline"
                    onClick={() => setStep(1)}
                  >
                    {lang === 'ar' ? 'تعديل الرقم' : 'Change number'}
                  </button>
                </div>
              )}
              <div>
                <TextField
                  label={t('password')}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={setPassword}
                  leadingIcon={<Lock size={16} />}
                  hint={t('minPassword')}
                  trailingIcon={
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={consentCopy.showPassword}
                      aria-pressed={showPw}
                      className="flex items-center justify-center w-11 h-11 -me-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      {showPw ? (
                        <EyeOff size={18} aria-hidden="true" />
                      ) : (
                        <Eye size={18} aria-hidden="true" />
                      )}
                    </button>
                  }
                />
                <PasswordStrength password={password} />
              </div>

              <div className="flex flex-col gap-2" data-testid="signup-consent">
                <div className="flex items-start gap-3">
                  <input
                    id="signup-consent"
                    type="checkbox"
                    checked={agreed}
                    onChange={(event) =>
                      setAcceptance(
                        event.target.checked && legalReady && termsDoc && privacyDoc
                          ? {
                              termsVersion: termsDoc.version,
                              privacyVersion: privacyDoc.version,
                              locale: lang,
                            }
                          : null,
                      )
                    }
                    disabled={!legalReady}
                    aria-describedby="signup-consent-links"
                    className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
                  />
                  <label
                    htmlFor="signup-consent"
                    className="cursor-pointer text-slate-700"
                    style={{ fontSize: '15px', lineHeight: '1.5' }}
                  >
                    {consentCopy.statement}
                  </label>
                </div>
                <p
                  id="signup-consent-links"
                  className="flex flex-wrap gap-x-4 ps-9"
                  style={{ fontSize: '15px' }}
                >
                  {(['terms', 'privacy'] as const).map((id) => (
                    <a
                      key={id}
                      href={id === 'terms' ? '/legal/terms' : '/legal/privacy'}
                      onClick={(event) => {
                        // A plain click reads the policy in place; a
                        // modified or middle click opens the real page.
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey ||
                          event.button !== 0
                        )
                          return;
                        event.preventDefault();
                        setPolicyOpen(id);
                      }}
                      className={`inline-flex min-h-11 items-center underline underline-offset-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${experience.classes.accentText}`}
                    >
                      {id === 'terms' ? consentCopy.readTerms : consentCopy.readPrivacy}
                    </a>
                  ))}
                </p>
                {legalQuery.isPending ? (
                  <p className="ps-9 text-slate-500" style={{ fontSize: '14px' }} role="status">
                    {consentCopy.loading}
                  </p>
                ) : legalQuery.isError ? (
                  <p className="ps-9 text-red-600" style={{ fontSize: '14px' }} role="alert">
                    {consentCopy.loadFailed}{' '}
                    <button
                      type="button"
                      onClick={() => void legalQuery.refetch()}
                      className="inline-flex min-h-11 items-center underline font-semibold"
                    >
                      {consentCopy.retry}
                    </button>
                  </p>
                ) : null}
              </div>
              {policyOpen !== null ? (
                <Suspense fallback={null}>
                  <PolicyDialog
                    id={policyOpen}
                    lang={lang === 'ar' ? 'ar' : 'en'}
                    onClose={() => setPolicyOpen(null)}
                  />
                </Suspense>
              ) : null}
            </div>
          )}

          {/* ── Step 3: Email OTP verification ── */}
          {step === 3 && challenge && (
            <EmailOtpPanel
              email={
                challenge.maskedDestination ?? (channel === 'whatsapp' ? phoneNumber : email.trim())
              }
              channel={challenge.channel ?? channel}
              codeLength={challenge.codeLength}
              onVerify={handleOtpVerify}
              onResend={handleOtpResend}
              isVerifying={isVerifying}
              isResending={isResending}
              verifyError={otpError?.[lang]}
              recovery={otpRecovery}
              resendNotice={resendNotice}
              experience={experience}
              onRestart={() =>
                (challenge.channel ?? channel) === 'email' && onRecoverVerification
                  ? onRecoverVerification(email.trim())
                  : onBack()
              }
              restartLabel={
                (challenge.channel ?? channel) === 'whatsapp'
                  ? lang === 'ar'
                    ? 'العودة لتسجيل الدخول'
                    : 'Back to sign in'
                  : lang === 'ar'
                    ? 'طلب رابط تحقق بدلاً من الرمز'
                    : 'Use a verification link instead'
              }
            />
          )}

          <div className="h-4" />
        </div>

        {/* Sticky bottom CTA — hidden on Step 3 because the OTP panel
            ships its own primary action. */}
        {step !== 3 && (
          <div className="bg-white border-t border-slate-100 px-6 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
            {signUpError && (
              <p
                role="alert"
                className="text-red-500 text-center mb-2"
                style={{ fontSize: '13px' }}
              >
                {signUpError}
              </p>
            )}
            <Button
              variant="primary"
              tone={experience.id}
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
              <button onClick={onBack} className={`${experience.classes.accentText} font-semibold`}>
                {t('login')}
              </button>
            </p>
          </div>
        )}
      </div>
    </SwipeableScreen>
  );
}
