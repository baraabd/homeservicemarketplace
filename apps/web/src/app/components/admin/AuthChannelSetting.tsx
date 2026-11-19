import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Mail, MessageCircle, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../../lib/auth-provider';
import { getAuthConfiguration } from '../../../lib/auth-channel';
import { AUTH_CONFIG_QUERY_KEY } from '../../../lib/auth-policy-query';
import { refreshVerifiedContact } from '../../../lib/auth-contact-api';
import { AccountContactEnrollment } from '../account/AccountContactEnrollment';

/** The server remains authoritative for provider readiness and verified ownership. */
export function AuthChannelSetting({
  value,
  savedValue,
  onChange,
  disabled,
  lang,
}: {
  value: unknown;
  savedValue: unknown;
  onChange: (channel: string) => void;
  disabled: boolean;
  lang: string;
}) {
  const ar = lang === 'ar';
  const { user } = useAuth();
  const qc = useQueryClient();
  const config = useQuery({
    queryKey: AUTH_CONFIG_QUERY_KEY,
    queryFn: getAuthConfiguration,
    staleTime: 0,
  });
  const verifiedPhone = Boolean(user?.phoneVerifiedAt && user.phoneNumber);
  const verifiedEmail = Boolean(user?.emailVerifiedAt && user.email);
  const ready = config.data?.whatsappAvailable === true;
  const configKnown = config.isSuccess && !config.isFetching;
  const canRequestWhatsApp = configKnown && ready;
  const [hadWhatsAppReadiness, setHadWhatsAppReadiness] = useState(false);
  if (canRequestWhatsApp && !hadWhatsAppReadiness) setHadWhatsAppReadiness(true);
  const explain = ar
    ? 'تطبق القناة المحفوظة على التسجيل والدخول في تطبيقات العميل والمهني والأدمن. الحسابات السابقة تحتفظ بطريقة دخول متاحة لها.'
    : 'The saved channel applies to customer, professional and admin sign-up and sign-in. Existing accounts keep an available sign-in method.';
  return (
    <section
      className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6"
      aria-labelledby="auth-channel-title"
      dir={ar ? 'rtl' : 'ltr'}
    >
      <div className="mb-5 flex items-start gap-3">
        <ShieldCheck className="mt-1 shrink-0 text-blue-600" size={24} aria-hidden />
        <div className="min-w-0">
          <h3 id="auth-channel-title" className="text-lg font-bold text-slate-900 dark:text-white">
            {ar ? 'طريقة التسجيل ورموز التحقق' : 'Sign-up and verification codes'}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{explain}</p>
        </div>
      </div>
      <fieldset disabled={disabled || config.isPending || config.isError}>
        <legend className="sr-only">
          {ar ? 'اختر قناة رموز التحقق' : 'Choose verification channel'}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['email', 'whatsapp'] as const).map((channel) => {
            const whatsapp = channel === 'whatsapp';
            const selected = value === channel;
            const unavailable = whatsapp ? !ready || !verifiedPhone : !verifiedEmail;
            const Icon = whatsapp ? MessageCircle : Mail;
            return (
              <label
                key={channel}
                className={`relative flex cursor-pointer flex-col gap-3 rounded-2xl border-2 p-4 transition-colors focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 ${selected ? 'border-blue-600 bg-white dark:bg-slate-800' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'} ${unavailable ? 'cursor-not-allowed opacity-65' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="auth-channel"
                    value={channel}
                    checked={selected}
                    onChange={() => onChange(channel)}
                    disabled={unavailable}
                    className="h-5 w-5 accent-blue-600"
                  />
                  <Icon
                    size={22}
                    aria-hidden
                    className={
                      whatsapp
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-blue-600 dark:text-blue-400'
                    }
                  />
                  <span className="font-bold text-slate-900 dark:text-white">
                    {whatsapp ? (ar ? 'واتساب' : 'WhatsApp') : ar ? 'البريد الإلكتروني' : 'Email'}
                  </span>
                  {savedValue === channel && (
                    <Check
                      size={18}
                      aria-label={ar ? 'القناة الحالية' : 'Current channel'}
                      className="ms-auto text-emerald-700"
                    />
                  )}
                </div>
                <span className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {whatsapp
                    ? ar
                      ? 'حساب برقم الهاتف ورمز يصل عبر واتساب، دون اشتراط بريد إلكتروني.'
                      : 'A phone number and a code delivered on WhatsApp. No email required.'
                    : ar
                      ? 'حساب بالبريد الإلكتروني ورمز يصل إلى صندوق الوارد.'
                      : 'An email account and a verification code delivered to the inbox.'}
                </span>
                <span className="rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  {ar ? 'العميل · المهني · الأدمن' : 'Customer · Professional · Admin'}
                  <br />
                  {whatsapp
                    ? ar
                      ? 'رقم الهاتف ← كلمة المرور ← رمز واتساب'
                      : 'Phone → Password → WhatsApp code'
                    : ar
                      ? 'البريد ← كلمة المرور ← رمز البريد'
                      : 'Email → Password → Email code'}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {config.isPending && (
        <p role="status" className="mt-4 text-sm">
          {ar ? 'جارٍ فحص جاهزية القنوات…' : 'Checking channel readiness…'}
        </p>
      )}
      {config.isError && (
        <div role="alert" className="mt-4 text-sm text-rose-700 dark:text-rose-300">
          {ar ? 'تعذّر تحميل إعدادات الدخول.' : 'Could not load sign-in settings.'}
          <button
            type="button"
            onClick={() => void config.refetch()}
            className="ms-2 min-h-11 underline"
          >
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}
      {config.data && !ready && (
        <p className="mt-4 text-sm leading-6 text-amber-800 dark:text-amber-200">
          {ar
            ? 'لتفعيل واتساب، يجب إعداد خدمة WhatsApp Business وقالب رسائل المصادقة المعتمد على الخادم أولًا.'
            : 'To enable WhatsApp, first configure WhatsApp Business and an approved authentication template on the server.'}
        </p>
      )}
      {!verifiedEmail && (
        <AccountContactEnrollment
          channel="email"
          lang={lang}
          disabled={disabled}
          canRequest={configKnown}
          onVerified={() => refreshVerifiedContact(qc, user?.id ?? '', 'email')}
        />
      )}
      {(canRequestWhatsApp || hadWhatsAppReadiness) && !verifiedPhone && (
        <AccountContactEnrollment
          channel="whatsapp"
          lang={lang}
          disabled={disabled}
          canRequest={canRequestWhatsApp}
          onVerified={() => refreshVerifiedContact(qc, user?.id ?? '', 'whatsapp')}
        />
      )}
      {verifiedEmail && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
          <ShieldCheck size={18} aria-hidden />
          {ar ? 'بريد حسابك موثق:' : 'Your verified email:'}
          <bdi>{user?.email}</bdi>
        </p>
      )}
      {verifiedPhone && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
          <ShieldCheck size={18} aria-hidden />
          {ar ? 'رقم حسابك موثق:' : 'Your verified number:'}
          <bdi>{user?.phoneNumber}</bdi>
        </p>
      )}
      {value !== savedValue && (
        <p className="mt-4 text-sm font-medium text-blue-700 dark:text-blue-300">
          {ar
            ? 'اختيارك لم يُحفظ بعد. اضغط «حفظ التغييرات» لتطبيقه.'
            : 'This selection is not saved yet. Choose “Save changes” to apply it.'}
        </p>
      )}
    </section>
  );
}
