import { useQuery } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type {
  ProviderOnboardingDraftView,
  ProviderSupportedMarketsResponse,
  SupportedMarketView,
} from '@homeservicemarketplace/contracts';

import { getSupportedMarkets } from '../../../lib/provider/provider-markets-api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';

/**
 * The markets an operator has opened, and the one this provider is in.
 *
 * Sprint 09B.29 Phase 5B — G-01.
 *
 * `staleTime` is generous because this is operator configuration: a market does
 * not open while somebody is typing a city name. It is invalidated explicitly
 * by the LOCATION write, which is the one client action that can change the
 * answer.
 */
export function useSupportedMarkets() {
  return useQuery<ProviderSupportedMarketsResponse, AxiosError>({
    queryKey: providerQueryKeys.onboarding.markets(),
    queryFn: getSupportedMarkets,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * What the work-area screen has to ask, if anything.
 *
 * Sprint 09B.29 Phase 5B. This is the whole of G-01's client-side policy, kept
 * as a pure function so every branch can be asserted without a browser.
 *
 * WHY THE APPROVED SCREEN IS STILL THE DEFAULT
 *
 * The reference draws one city field, a map band and a reward sentence — no
 * country control — and that is correct for the state it depicts: a provider
 * whose market is already known and still open. Adding a permanent country row
 * would change a screen the prototype froze, for a question most providers
 * never have to answer.
 *
 * So the control is a SUBSTATE, exactly as the approved deviation register
 * describes (D5-01). It appears only when the server's answer makes it
 * necessary, and the settled case renders the approved screen unchanged.
 */
export type MarketPrompt =
  /** Nothing to ask: the provider's market is known and still enabled. */
  | { kind: 'SETTLED'; market: SupportedMarketView }
  /** No market recorded yet. The provider must choose one before submitting. */
  | { kind: 'CHOOSE' }
  /**
   * A market IS recorded, but the operator has withdrawn from it.
   *
   * The two halves of this are what make it explainable: the code is still on
   * the profile, and it is absent from the enabled list. Saying "choose a
   * country" to somebody who already chose one would read as data loss.
   */
  | { kind: 'WITHDRAWN'; previousCountryCode: string }
  /**
   * The market is settled but its timezone is ambiguous, so the provider has to
   * confirm one before availability can mean anything.
   */
  | { kind: 'CONFIRM_TIMEZONE'; market: SupportedMarketView }
  /** The registry could not be read. Never guess — say so and offer a retry. */
  | { kind: 'UNAVAILABLE' };

export function marketPrompt(
  markets: ProviderSupportedMarketsResponse | undefined,
  draft: ProviderOnboardingDraftView | undefined,
): MarketPrompt | null {
  // No answer yet is not the same as no market. Rendering a picker here would
  // flash a question at a provider who has already answered it.
  if (markets === undefined) return null;

  // `Array.isArray`, not `?? []`.
  //
  // A client cannot verify what a server sent it: a stale deployment, a proxy
  // or a rolled-back API can all put the wrong shape on the wire, and an object
  // is truthy so `?? []` lets it straight through to `.find` and a white
  // screen. The same guard, for the same reason, as `deriveVerificationView` —
  // which was written after exactly that shipped.
  //
  // Degrading to UNAVAILABLE is the safe direction: the provider is told the
  // list could not be read and offered a retry, rather than being shown a
  // question with no answers or no screen at all.
  if (!Array.isArray(markets.markets)) return { kind: 'UNAVAILABLE' };

  const selected = markets.selectedCountryCode ?? draft?.data.serviceAreaCountryCode ?? null;
  if (!selected) return { kind: 'CHOOSE' };

  const market = markets.markets.find((m) => m.countryCode === selected);
  if (!market) return { kind: 'WITHDRAWN', previousCountryCode: selected };

  // The server decides whether a country pins a zone. A country that spans
  // several — or one the platform has no mapping for — comes back as ASK, and
  // an unconfirmed zone makes every stored working hour ambiguous.
  const stored = draft?.data.timezone ?? null;
  if (market.timezone.kind === 'ASK' && !stored) {
    return { kind: 'CONFIRM_TIMEZONE', market };
  }

  return { kind: 'SETTLED', market };
}
