import { Navigate, Outlet, useNavigate, useParams } from 'react-router';

import { isProviderOnboardingV2Enabled } from '../../lib/feature-flags';
import { OnboardingHubScreen } from '../features/provider-onboarding-v2/components/OnboardingHubScreen';
import { OnboardingTaskScreen } from '../features/provider-onboarding-v2/components/OnboardingTaskScreen';
import { ProviderOnboardingAutosaveProvider } from '../features/provider-onboarding-v2/autosave/ProviderOnboardingAutosaveProvider';
import { OnboardingShell } from '../features/provider-onboarding-v2/components/OnboardingShell';
import { ProviderVerificationScreen } from '../features/provider-verification/components/ProviderVerificationScreen';
import { useLang } from '../i18n/LanguageContext';
import { REVIEW_FEEDBACK_COPY } from '../features/provider-onboarding-v2/copy/review-feedback-copy';

// Sprint 9B.16 — the V2 onboarding routes, behind the flag.
//
// With the flag OFF these paths do not exist as far as a provider is
// concerned: they bounce to /provider, which serves the Sprint 8 wizard
// exactly as it did before. That matters more than it looks — the flag is the
// rollback, and a rollback that leaves a deep link rendering a half-built
// surface is not one.
//
// `replace` rather than a push, so the browser's back button returns to
// wherever the provider actually came from instead of bouncing them through
// the disabled route again.

export function ProviderOnboardingHubPage() {
  if (!isProviderOnboardingV2Enabled()) return <Navigate to="/provider" replace />;
  return <OnboardingHubScreen />;
}

export function ProviderOnboardingTaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  if (!isProviderOnboardingV2Enabled()) return <Navigate to="/provider" replace />;
  // A bare /provider/onboarding/ with no id is the hub, not a task with an
  // empty name.
  if (!taskId) return <Navigate to="/provider/onboarding" replace />;
  return <OnboardingTaskScreen />;
}

/** Evidence belongs to applicants as well as active providers. Authorization
 * remains in the existing verification API and its server-owned actions. */
export function ProviderVerificationPage() {
  const { lang } = useLang();
  const navigate = useNavigate();
  return (
    <OnboardingShell
      title={REVIEW_FEEDBACK_COPY[lang].verificationTitle}
      onClose={() => navigate('/provider/status')}
    >
      <ProviderVerificationScreen />
    </OnboardingShell>
  );
}

/**
 * The onboarding LAYOUT route.
 *
 * Sprint 9B.28 — this exists for one reason: the autosave coordinator has to
 * outlive the task components. It used to be seven independent hook instances
 * living INSIDE the task screens, so the act of leaving a task — which is
 * exactly when an unwritten edit is most at risk — unmounted the timer holding
 * the only copy of it.
 *
 * Mounting the provider here puts it above both `/provider/onboarding` and
 * `/provider/onboarding/:taskId`, so moving between the hub and a task, or
 * between two tasks, never tears down the queue. It is torn down only when
 * onboarding itself is left, which is the one case where `beforeunload` and
 * the exit guard have already had their say.
 *
 * The flag check stays on the LEAF routes rather than moving here. A layout
 * that redirected would take the flag decision away from the two components
 * that document it, and the redirect targets differ (`/provider` for the hub,
 * the hub for a task with no id).
 */
export function ProviderOnboardingLayout() {
  return (
    <ProviderOnboardingAutosaveProvider>
      <Outlet />
    </ProviderOnboardingAutosaveProvider>
  );
}
