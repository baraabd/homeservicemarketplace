import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useLang } from '../../i18n/LanguageContext';
import { ProviderButton } from '../../features/provider-ui';
import { OnboardingShell } from '../../features/provider-onboarding-v2/components/OnboardingShell';
import { OnboardingAlert } from '../../features/provider-onboarding-v2/components/OnboardingAlert';

/** A failed permission read is neither approval nor an incomplete application. */
export function ProviderAccessUnavailable({ retry, busy }: { retry: () => void; busy: boolean }) {
  const { lang } = useLang();
  const navigate = useNavigate();
  const copy =
    lang === 'ar'
      ? {
          title: 'تعذّر التحقق من صلاحية الدخول',
          body: 'تعذّر تحميل حالة حسابك الآن. أعد المحاولة للمتابعة.',
          retry: 'إعادة المحاولة',
        }
      : {
          title: 'Unable to check access',
          body: 'We could not load your account access right now. Try again to continue.',
          retry: 'Try again',
        };
  return (
    <OnboardingShell
      title={copy.title}
      onClose={() => navigate('/select')}
      footer={
        <ProviderButton size="block" shape="onboarding" onClick={retry} disabled={busy}>
          {copy.retry}
        </ProviderButton>
      }
    >
      <OnboardingAlert
        tone="warning"
        icon={ShieldAlert}
        title={copy.title}
        body={copy.body}
        role="alert"
      />
    </OnboardingShell>
  );
}
