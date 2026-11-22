import { useRef, useState } from 'react';
import { Mail, MessageCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../ds/Button';
import { useLang } from '../../i18n/LanguageContext';
import { normalizeDecimalDigits } from '../../../lib/normalize-decimal-digits';
import { AUTH_EXPERIENCES, DEFAULT_EXPERIENCE_ID } from '../../../lib/auth-experience';
import type { EmailOtpPanelProps } from './otp-types';
import { useOtpCountdown } from './use-otp-countdown';

// Shared channel-aware verification UI, loaded after a challenge is issued.
export function EmailOtpPanel({
  email,
  channel = 'email',
  codeLength,
  expiresAt,
  codeRevision = 0,
  onVerify,
  onResend,
  onRequestNewCode,
  isVerifying,
  isResending,
  resendLimitReached = false,
  verifyError,
  resendNotice,
  recovery = null,
  onRestart,
  restartLabel,
  experience = AUTH_EXPERIENCES[DEFAULT_EXPERIENCE_ID],
}: EmailOtpPanelProps) {
  const { lang } = useLang();
  const [draft, setDraft] = useState({ revision: codeRevision, value: '' });
  const countdown = useOtpCountdown(expiresAt);
  const expired = countdown.expired;
  // Reset for a new code or expiry before rendering. An effect could erase a
  // fast first keystroke after mounting; language changes retain this draft.
  if (draft.revision !== codeRevision || (expired && draft.value !== '')) {
    setDraft({ revision: codeRevision, value: '' });
  }
  const code = expired || draft.revision !== codeRevision ? '' : draft.value;
  const canSubmit =
    code.length === codeLength &&
    !isVerifying &&
    !isResending &&
    recovery !== 'restart' &&
    !expired;
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

      {countdown.label !== null && (
        <p
          data-testid="otp-countdown"
          role="timer"
          aria-live="off"
          className="text-sm font-semibold text-slate-700"
        >
          {lang === 'ar' ? 'صلاحية الرمز المتبقية: ' : 'Code expires in: '}
          <bdi dir="ltr">{countdown.label}</bdi>
        </p>
      )}
      {expired && (
        <p role="status" className="text-sm text-slate-700">
          {lang === 'ar'
            ? 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا للمتابعة.'
            : 'This code has expired. Request a new code to continue.'}
        </p>
      )}
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
        <p className="text-slate-600 mt-1" style={{ fontSize: '13px' }}>
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
            className={`min-w-0 h-14 rounded-2xl border-2 flex items-center justify-center transition-all ${experience.classes.accentText} ${
              code.length > i
                ? `${experience.classes.accentBorder} ${experience.classes.softBg}`
                : 'border-slate-200 bg-slate-50'
            }`}
            style={{ fontSize: '24px', fontWeight: 700 }}
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
        onChange={(e) =>
          setDraft({
            revision: codeRevision,
            value: normalizeDecimalDigits(e.target.value).replace(/\D/gu, '').slice(0, codeLength),
          })
        }
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canSubmit) {
            event.preventDefault();
            void onVerify(code);
          }
        }}
        disabled={isVerifying || isResending || recovery === 'restart' || expired}
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
          className="text-red-700"
          style={{ fontSize: '13px' }}
        >
          {verifyError}
        </p>
      )}

      {expired && onRequestNewCode ? (
        <Button
          contrast="strong"
          variant="primary"
          tone={experience.id}
          fullWidth
          state={isResending ? 'loading' : isVerifying ? 'disabled' : 'default'}
          onClick={() => {
            void onRequestNewCode();
          }}
        >
          {lang === 'ar' ? 'طلب رمز جديد' : 'Request a new code'}
        </Button>
      ) : (
        <Button
          contrast="strong"
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
      )}

      {!expired && (
        <button
          type="button"
          onClick={() => void onResend()}
          disabled={isResending || isVerifying || recovery !== null || resendLimitReached}
          className={`${experience.classes.accentText} min-h-11 active:underline disabled:opacity-50`}
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
      )}
      {!expired && resendLimitReached && (
        <p className="text-sm text-slate-600">
          {lang === 'ar'
            ? 'وصلت إلى حد طلبات هذا الرمز. انتظر انتهاء صلاحيته، ثم اطلب رمزًا جديدًا.'
            : 'You have reached the request limit for this code. Wait until it expires, then request a new code.'}
        </p>
      )}
      {onRestart && (
        <button
          type="button"
          onClick={onRestart}
          disabled={isVerifying || isResending}
          className="min-h-11 text-slate-700 underline disabled:opacity-50"
          style={{ fontSize: '13px' }}
        >
          {restartLabel ?? (lang === 'ar' ? 'بدء تسجيل الدخول مجدداً' : 'Start sign-in again')}
        </button>
      )}
      {resendNotice && !expired && (
        <p role="status" className="text-slate-500" style={{ fontSize: '12px' }}>
          {resendNotice}
        </p>
      )}
    </div>
  );
}
