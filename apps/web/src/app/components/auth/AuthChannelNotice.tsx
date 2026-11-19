import { Mail, MessageCircle } from 'lucide-react';
import type { OtpChannel } from '../../../lib/auth-channel';
import { useLang } from '../../i18n/LanguageContext';

export function AuthChannelNotice({
  channel,
  available = true,
}: {
  channel: OtpChannel;
  available?: boolean;
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
        {whatsapp && !available && (
          <p role="status" className="mt-2 font-semibold">
            {lang === 'ar'
              ? 'التحقق عبر واتساب غير متاح مؤقتًا. استخدم حساب البريد الإلكتروني إن وُجد، أو حاول لاحقًا.'
              : 'WhatsApp verification is temporarily unavailable. Use an existing email account or try again later.'}
          </p>
        )}
        <p className="mt-1 text-sm leading-6">
          {whatsapp
            ? lang === 'ar'
              ? 'استخدم رقمك المرتبط بواتساب. سيصلك رمز آمن لتأكيد هويتك.'
              : 'Use your WhatsApp number. We will send a secure code to verify your identity.'
            : lang === 'ar'
              ? 'سيصلك رمز تحقق إلى بريدك الإلكتروني.'
              : 'A verification code will be sent to your email address.'}
        </p>
      </div>
    </div>
  );
}
