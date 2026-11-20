import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCcw } from 'lucide-react';
import { getAuthConfiguration, type OtpChannel } from '../../../lib/auth-channel';
import { useLang, LangToggle } from '../../i18n/LanguageContext';
import { Button } from '../ds/Button';
import { AUTH_CONFIG_QUERY_KEY } from '../../../lib/auth-policy-query';
import {
  AUTH_EXPERIENCES,
  DEFAULT_EXPERIENCE_ID,
  type AuthExperience,
} from '../../../lib/auth-experience';

/** Do not guess the identity field while the server's policy is unknown. */
export function AuthConfigurationGate({
  children,
  experience = AUTH_EXPERIENCES[DEFAULT_EXPERIENCE_ID],
}: {
  children: (channel: OtpChannel, whatsappAvailable: boolean) => ReactNode;
  experience?: AuthExperience;
}) {
  const { lang } = useLang();
  const query = useQuery({
    queryKey: AUTH_CONFIG_QUERY_KEY,
    queryFn: getAuthConfiguration,
    staleTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const [confirmedAfterMount, setConfirmedAfterMount] = useState(false);
  // A cached policy may predate an admin change. Confirm it once per visit,
  // then retain the mounted form and its draft through background refetches.
  if (!confirmedAfterMount && query.isFetchedAfterMount && query.isSuccess) {
    setConfirmedAfterMount(true);
  }
  if (!confirmedAfterMount || !query.data) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-5 bg-white p-6 text-center">
        <LangToggle />
        {query.isPending || query.isFetching ? (
          <>
            <Loader2
              className={`animate-spin ${experience.classes.accentText}`}
              aria-hidden="true"
            />
            <p role="status">
              {lang === 'ar' ? 'جارٍ تجهيز تسجيل الدخول…' : 'Preparing secure sign in…'}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">
              {lang === 'ar' ? 'تعذّر تحميل خيارات الدخول' : 'Sign-in options are unavailable'}
            </h1>
            <p role="alert" className="max-w-sm text-slate-600">
              {lang === 'ar'
                ? 'تحقق من اتصالك وأعد المحاولة.'
                : 'Check your connection and try again.'}
            </p>
            <Button
              variant="primary"
              tone={experience.id}
              onClick={() => void query.refetch()}
              leadingIcon={<RefreshCcw size={18} />}
            >
              {lang === 'ar' ? 'إعادة المحاولة' : 'Try again'}
            </Button>
          </>
        )}
      </main>
    );
  }
  return children(query.data.otpChannel, query.data.whatsappAvailable);
}
