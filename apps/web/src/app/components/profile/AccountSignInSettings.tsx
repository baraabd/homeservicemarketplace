import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuthOtpChannel, MeResponse } from '@homeservicemarketplace/contracts';
import { useAuth } from '../../../lib/auth-provider';
import { getAuthConfiguration } from '../../../lib/auth-channel';
import { AUTH_CONFIG_QUERY_KEY } from '../../../lib/auth-policy-query';
import { refreshVerifiedContact } from '../../../lib/auth-contact-api';
import { useLang } from '../../i18n/LanguageContext';
import { AccountContactEnrollment } from '../account/AccountContactEnrollment';

/** Account credentials are separate from the editable public/profile phone. */
export function AccountSignInSettings() {
  const { lang, dir } = useLang();
  const ar = lang === 'ar';
  const { user, isLoading, isDegraded } = useAuth();
  const qc = useQueryClient();
  const [configurationConfirmed, setConfigurationConfirmed] = useState(false);
  const config = useQuery({
    queryKey: AUTH_CONFIG_QUERY_KEY,
    queryFn: getAuthConfiguration,
    staleTime: 0,
    enabled: !!user,
  });
  if (!configurationConfirmed && config.isFetchedAfterMount && config.isSuccess) {
    setConfigurationConfirmed(true);
  }

  if (isLoading) return <p role="status">{ar ? 'جارٍ تحميل الحساب…' : 'Loading account…'}</p>;
  if (!user) return null;
  const accountId = user.id;
  const canRequest = config.isSuccess && !config.isFetching && !isDegraded;

  const verified = (account: MeResponse, channel: AuthOtpChannel) =>
    channel === 'whatsapp'
      ? Boolean(account.phoneNumber && account.phoneVerifiedAt)
      : Boolean(account.email && account.emailVerifiedAt);

  return (
    <section
      aria-labelledby="account-sign-in-title"
      className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
      dir={dir}
    >
      <h2 id="account-sign-in-title" className="text-lg font-bold text-slate-900 dark:text-white">
        {ar ? 'وسائل تسجيل الدخول' : 'Sign-in methods'}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {ar
          ? 'اربط رقم واتساب أو بريدًا إلكترونيًا بهذا الحساب باستخدام كلمة مرورك الحالية ورمز تحقق. وسائل الدخول الموثقة الحالية تظل متاحة.'
          : 'Link WhatsApp or email to this account using your current password and a verification code. Your existing verified sign-in methods remain available.'}
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
        {ar
          ? 'رقم التواصل في الملف الشخصي منفصل؛ تغييره لا يغيّر رقم تسجيل الدخول.'
          : 'Your profile contact number is separate; editing it does not change your sign-in number.'}
      </p>
      {isDegraded && (
        <p role="alert" className="mt-3 text-sm text-amber-800 dark:text-amber-200">
          {ar
            ? 'تعذّر تحديث الحساب. تظهر البيانات السابقة؛ أعد محاولة تحديث التحقق أو حمّل الصفحة مجددًا.'
            : 'Your account could not be refreshed. Earlier details are shown; retry the verification refresh or reload.'}
        </p>
      )}
      {!configurationConfirmed && !config.isError && (
        <p role="status" className="mt-3">
          {ar ? 'جارٍ فحص القنوات…' : 'Checking available channels…'}
        </p>
      )}
      {config.isError && (
        <div role="alert" className="mt-3 text-sm text-rose-700 dark:text-rose-300">
          {ar ? 'تعذّر تحميل وسائل الدخول.' : 'Could not load sign-in methods.'}
          <button
            type="button"
            className="ms-2 min-h-11 underline"
            onClick={() => void config.refetch()}
          >
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}
      {(['whatsapp', 'email'] as const).map((channel) => {
        const whatsapp = channel === 'whatsapp';
        if (verified(user, channel)) {
          return (
            <div
              key={channel}
              className="mt-4 rounded-2xl bg-emerald-50 p-4 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100"
              data-testid={`account-verified-${channel}`}
            >
              <p className="font-semibold">
                {whatsapp
                  ? ar
                    ? 'رقم واتساب موثق'
                    : 'Verified WhatsApp number'
                  : ar
                    ? 'بريد إلكتروني موثق'
                    : 'Verified email'}
              </p>
              <bdi dir="ltr" className="mt-1 block break-all">
                {whatsapp ? user.phoneNumber : user.email}
              </bdi>
            </div>
          );
        }
        if (!configurationConfirmed) return null;
        return (
          <div key={`${user.id}:${channel}`}>
            {whatsapp && config.data?.whatsappAvailable === false && (
              <p
                role="status"
                className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300"
              >
                {ar
                  ? 'ربط واتساب غير متاح مؤقتًا. يمكنك متابعة استخدام بريدك الإلكتروني أو ربطه.'
                  : 'WhatsApp linking is temporarily unavailable. You can keep using or link your email.'}
              </p>
            )}
            <AccountContactEnrollment
              channel={channel}
              lang={lang}
              disabled={false}
              canRequest={canRequest && (!whatsapp || config.data?.whatsappAvailable === true)}
              onVerified={() => refreshVerifiedContact(qc, accountId, channel)}
            />
          </div>
        );
      })}
    </section>
  );
}
