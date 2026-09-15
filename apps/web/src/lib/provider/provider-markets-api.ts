import type { ProviderSupportedMarketsResponse } from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 09B.29 Phase 5B — the market registry, as the client reads it.
//
// docs/provider-experience-v2/PHASE5A_INTEGRATION_GAPS.md G-01
//
// WHY THIS DID NOT EXIST UNTIL NOW
//
// C2 built the whole server side — an operator-configured registry, ISO
// validation, market enablement checked on every LOCATION write, radius bounds
// and timezone resolution per market — and shipped `GET /markets` to expose it.
// Nothing in the web app ever called it. The approved work-area screen has no
// country control, so the migration had nowhere to put one, and
// `serviceAreaCountry` stayed REQUIRED for submission with no way to supply it.
//
// That is the gap this closes, and it closes it by consuming what already
// exists rather than by inventing a second source of truth. The enabled list,
// the ordering, the radius bounds and whether a timezone must be confirmed are
// all the server's answers.

/**
 * The markets a provider may choose between, and which one they are in.
 *
 * A separate route from the draft on purpose: the list is OPERATOR state. It
 * changes when a market opens, not when the provider types, so folding it into
 * the draft would re-fetch it on every keystroke.
 */
export async function getSupportedMarkets(): Promise<ProviderSupportedMarketsResponse> {
  const { data } = await api.get<ProviderSupportedMarketsResponse>(
    '/v1/me/provider/onboarding/markets',
  );
  return data;
}
