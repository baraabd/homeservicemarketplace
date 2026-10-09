import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ProviderCapabilitiesResponse } from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../../../lib/provider/query-keys';

// R17-E (E-5) — keep an open provider workspace in step with the server's
// authority decision, without a second source of it.
//
// The server decides on every request (ProviderCapabilityGuard reads fresh
// state; no capability lives in the token). What went stale was the CLIENT:
// it asked once per mount, so a provider restricted or suspended mid-session
// kept seeing the feed and its write buttons until they signed out. This hook
// adds the two missing signals and one consequence:
//
//   1. any provider endpoint answering 403 means the decision changed: ask
//      again now (the capability endpoint itself is excluded, or a provider
//      who lost the role would loop);
//   2. useProviderCapabilities also re-asks on an interval and on focus;
//   3. when the new answer withdraws a capability, the data only that
//      capability could read is dropped from the cache, so regaining it later
//      starts from the server rather than from a stale page.
//
// Routing is not authorization: ProviderApp only hides what the server would
// refuse anyway.

const CAPABILITY_URL = /\/v1\/me\/provider\/capabilities(?:$|\?)/;
const PROVIDER_URL = /\/v1\/(?:me\/)?provider\//;

export function isProviderAuthorityLoss(error: unknown): boolean {
  const e = error as { response?: { status?: number }; config?: { url?: string } } | null;
  const url = e?.config?.url ?? '';
  return e?.response?.status === 403 && PROVIDER_URL.test(url) && !CAPABILITY_URL.test(url);
}

type Allowed = ProviderCapabilitiesResponse['allowed'];

/** Data each capability is the only reader of. */
const READ_SCOPE: ReadonlyArray<[Allowed[number], readonly (readonly unknown[])[]]> = [
  [
    'VIEW_MARKETPLACE',
    [
      providerQueryKeys.availableRequests.root,
      providerQueryKeys.jobs.root,
      providerQueryKeys.bids.root,
    ],
  ],
  ['MANAGE_BOOKINGS', [providerQueryKeys.bookings.root, providerQueryKeys.chat.root]],
  ['VIEW_EARNINGS', [providerQueryKeys.wallet.root]],
];

export function dropWithdrawnReads(qc: QueryClient, before: Allowed, after: Allowed): void {
  for (const [capability, roots] of READ_SCOPE) {
    if (before.includes(capability) && !after.includes(capability)) {
      for (const queryKey of roots) qc.removeQueries({ queryKey });
    }
  }
}

export function useProviderAuthorityRefresh(allowed: Allowed | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    const refresh = (error: unknown) => {
      if (isProviderAuthorityLoss(error))
        void qc.invalidateQueries({ queryKey: providerQueryKeys.capabilities.get() });
    };
    const queries = qc.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') refresh(event.action.error);
    });
    const mutations = qc.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') refresh(event.action.error);
    });
    return () => {
      queries();
      mutations();
    };
  }, [qc]);

  const previous = useRef<Allowed | null>(null);
  const signature = allowed ? [...allowed].sort().join(',') : null;
  useEffect(() => {
    if (!allowed) return;
    if (previous.current) dropWithdrawnReads(qc, previous.current, allowed);
    previous.current = allowed;
    // `signature` is the dependency: the array identity changes on every
    // refetch even when the decision did not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, signature]);
}
