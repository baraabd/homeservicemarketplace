import type { ProviderOnboardingHubView } from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 9B.16 — the onboarding hub read-model, client side.
//
// One GET, one shape. The hub is READ-ONLY: it shows what the server says
// about six tasks and offers a way into whichever one is next. Every write
// still goes through the per-task endpoints, so there is nothing here that
// could let a client advance its own application.
//
// No call names a provider. Ownership comes from the session, so there is no
// id for the client to get wrong or for anyone to tamper with — the same
// choice the Sprint 8 wizard API made, for the same reason.

export async function getOnboardingHub(): Promise<ProviderOnboardingHubView> {
  const { data } = await api.get<ProviderOnboardingHubView>('/v1/me/provider/onboarding/hub');
  return data;
}
