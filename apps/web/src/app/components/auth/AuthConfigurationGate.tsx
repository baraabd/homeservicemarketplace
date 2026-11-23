import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_AUTH_OTP_CHANNEL } from '@homeservicemarketplace/contracts';
import { getAuthConfiguration, type OtpChannel } from '../../../lib/auth-channel';
import { LangToggle } from '../../i18n/LanguageContext';
import { AuthConfigurationFeedback, type AuthConfigurationState } from './AuthChannelNotice';
import { AUTH_CONFIG_QUERY_KEY } from '../../../lib/auth-policy-query';
import {
  AUTH_EXPERIENCES,
  DEFAULT_EXPERIENCE_ID,
  type AuthExperience,
} from '../../../lib/auth-experience';

/** Show the default form immediately; only confirmed policy enables new requests. */
export function AuthConfigurationGate({
  children,
  experience = AUTH_EXPERIENCES[DEFAULT_EXPERIENCE_ID],
  requireConfirmation = false,
}: {
  children: (
    channel: OtpChannel,
    whatsappAvailable: boolean,
    configuration: AuthConfigurationState,
  ) => ReactNode;
  experience?: AuthExperience;
  requireConfirmation?: boolean;
}) {
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
  const confirmed = confirmedAfterMount ? query.data : undefined;
  const configuration: AuthConfigurationState = confirmed
    ? { status: 'ready' }
    : {
        status: query.isPending || query.isFetching ? 'pending' : 'error',
        retry: () => void query.refetch(),
      };
  // Recovery navigation depends on the selected method, so it must never
  // redirect an email user based on the unconfirmed presentation default.
  if (requireConfirmation && !confirmed) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-5 bg-white p-6 text-center">
        <LangToggle />
        <AuthConfigurationFeedback configuration={configuration} tone={experience.id} />
      </main>
    );
  }
  return children(
    confirmed?.otpChannel ?? DEFAULT_AUTH_OTP_CHANNEL,
    confirmed?.whatsappAvailable ?? false,
    configuration,
  );
}
