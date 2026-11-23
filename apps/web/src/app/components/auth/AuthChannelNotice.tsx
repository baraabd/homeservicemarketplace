import { Mail, MessageCircle } from 'lucide-react';
import type { OtpChannel } from '../../../lib/auth-channel';
import type { AuthExperienceId } from '../../../lib/auth-experience';
import { useLang } from '../../i18n/LanguageContext';
import { Button } from '../ds/Button';

export type AuthConfigurationState =
  | { status: 'ready' }
  | { status: 'pending' | 'error'; retry: () => void };

export function AuthConfigurationFeedback({
  configuration,
  tone,
}: {
  configuration: AuthConfigurationState;
  tone: AuthExperienceId;
}) {
  const { lang } = useLang();
  if (configuration.status === 'ready') return null;
  const pending = configuration.status === 'pending';
  return (
    <div className="flex flex-col items-start gap-3 text-sm leading-6">
      <p role={pending ? 'status' : 'alert'}>
        {pending
          ? lang === 'ar'
            ? 'جارٍ تجهيز تسجيل الدخول…'
            : 'Preparing secure sign in…'
          : lang === 'ar'
            ? 'خدمة تسجيل الدخول غير متاحة مؤقتًا. يرجى إعادة المحاولة بعد قليل.'
            : 'The sign-in service is temporarily unavailable. Please try again shortly.'}
      </p>
      {!pending && (
        <Button contrast="strong" tone={tone} onClick={configuration.retry}>
          {lang === 'ar' ? 'إعادة المحاولة' : 'Try again'}
        </Button>
      )}
    </div>
  );
}

export function AuthChannelNotice({
  channel,
  available,
  configuration,
  tone = 'seeker',
}: {
  channel: OtpChannel;
  available: boolean;
  configuration?: AuthConfigurationState;
  tone?: AuthExperienceId;
}) {
  const { lang } = useLang();
  const whatsapp = channel === 'whatsapp';
  const Icon = whatsapp ? MessageCircle : Mail;
  return (
    <div
      data-testid={`auth-channel-${channel}`}
      className={`flex items-start gap-3 rounded-2xl border p-4 ${whatsapp ? 'border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-slate-200 bg-slate-50 text-slate-800'}`}
    >
      <Icon size={22} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">
          {whatsapp
            ? lang === 'ar'
              ? 'التحقق عبر واتساب'
              : 'Verify with WhatsApp'
            : lang === 'ar'
              ? 'التحقق عبر البريد الإلكتروني'
              : 'Verify with email'}
        </p>
        {whatsapp && !available && (!configuration || configuration.status === 'ready') && (
          <p role="status" className="mt-2 font-semibold">
            {lang === 'ar'
              ? 'التحقق عبر واتساب غير متاح مؤقتًا. يرجى المحاولة لاحقًا.'
              : 'WhatsApp verification is temporarily unavailable. Please try again later.'}
          </p>
        )}
        <p className="mt-1 text-sm leading-6">
          {whatsapp
            ? lang === 'ar'
              ? 'أدخل رقمك المرتبط بواتساب لطلب رمز التحقق.'
              : 'Enter your WhatsApp number to request a verification code.'
            : lang === 'ar'
              ? 'سيصلك رمز تحقق إلى بريدك الإلكتروني.'
              : 'A verification code will be sent to your email address.'}
        </p>
        {configuration && configuration.status !== 'ready' && (
          <div className="mt-3">
            <AuthConfigurationFeedback configuration={configuration} tone={tone} />
          </div>
        )}
      </div>
    </div>
  );
}
