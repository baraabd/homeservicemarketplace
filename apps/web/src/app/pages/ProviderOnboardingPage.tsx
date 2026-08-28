import { Navigate, useParams } from 'react-router';

import { isProviderOnboardingV2Enabled } from '../../lib/feature-flags';
import { OnboardingHubScreen } from '../features/provider-onboarding-v2/components/OnboardingHubScreen';
import { OnboardingTaskScreen } from '../features/provider-onboarding-v2/components/OnboardingTaskScreen';

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
