import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import { useOnboardingDraft } from '../../../hooks/provider/useProviderOnboarding';
import {
  ProviderOnboardingAutosaveProvider,
  useOnboardingStepAutosave,
} from './ProviderOnboardingAutosaveProvider';

// Sprint 09B.29 Phase 4 — THE MONOTONIC GUARD MUST NEVER COMPARE TWO PEOPLE.
//
// `useOnboardingDraft` keeps the higher-versioned draft when a stale GET lands
// after a write. That rule is correct only within ONE draft. The cache slot is
// keyed by resource — `['provider','onboarding','draft']` — and carries no
// user, provider, session or generation, so without scoping the comparison is
// between bare integers that may not be on the same scale at all.
//
// Two ways that goes wrong, and the second is a data-protection incident:
//
//   reset draft     one provider's draft row is recreated and restarts at
//                   version 0. A version-only rule pins the client to the dead
//                   generation for as long as the entry survives.
//   cross-provider  provider A at version 50, a sign-out, then provider B at
//                   version 3. A version-only rule KEEPS A. Provider B is
//                   shown, and can submit, another provider's application.
//
// The repair scopes the comparison to `draftId`, which the server now returns
// and which changes on both. These tests fail if that scoping is removed.

const DRAFT_URL = '/v1/me/provider/onboarding/draft';
const PATCH_URL = /\/v1\/me\/provider\/onboarding\/steps\/([A-Z_]+)$/;

let mock: MockAdapter;
let qc: QueryClient;

const DRAFT = (
  draftId: string | null,
  version: number,
  displayName: string,
): ProviderOnboardingDraftView =>
  ({
    state: 'DRAFT',
    currentStep: 'IDENTITY',
    steps: [],
    completedSteps: [],
    percentComplete: 0,
    nextAction: { kind: 'COMPLETE_STEP', step: 'IDENTITY' },
    complete: false,
    missing: [],
    awaitingReview: [],
    draftId,
    version,
    policyVersion: 'p',
    lastSavedAt: null,
    editable: true,
    data: { displayName },
  }) as unknown as ProviderOnboardingDraftView;

/** Provider A: a long-running application. */
const A = (version: number) => DRAFT('draft-provider-a', version, 'Provider A');
/** Provider B: a brand-new application whose version is legitimately lower. */
const B = (version: number) => DRAFT('draft-provider-b', version, 'Provider B');

beforeEach(() => {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: Infinity } },
  });
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
  vi.useRealTimers();
});

type Handle = {
  save: (patch: Record<string, unknown>) => void;
  flushAll: () => Promise<{ ok: boolean; reason?: string }>;
};

function Probe({ onReady }: { onReady: (h: Handle) => void }) {
  const draft = useOnboardingDraft();
  const a = useOnboardingStepAutosave('IDENTITY');
  const ref = useRef(a);
  useEffect(() => {
    ref.current = a;
  });
  useEffect(() => {
    onReady({ save: (p) => ref.current.save(p), flushAll: () => ref.current.flushAll() });
  }, [onReady]);
  return (
    <>
      <span data-testid="name">{draft.data?.data?.displayName ?? '-'}</span>
      <span data-testid="version">{draft.data?.version ?? '-'}</span>
      <span data-testid="draftId">{draft.data?.draftId ?? '-'}</span>
    </>
  );
}

function mount() {
  let handle: Handle | null = null;
  render(
    <QueryClientProvider client={qc}>
      <ProviderOnboardingAutosaveProvider>
        <Probe
          onReady={(h) => {
            handle = h;
          }}
        />
      </ProviderOnboardingAutosaveProvider>
    </QueryClientProvider>,
  );
  return () => handle as Handle;
}

const cached = () =>
  qc.getQueryData<ProviderOnboardingDraftView>(providerQueryKeys.onboarding.draft());

/** Exactly what `purgeNonAuthQueries` in auth-provider does on sign-out and on
 *  session-expired: drop every cached query that is not under `auth`. */
function purgeNonAuthQueries(client: QueryClient): void {
  client
    .getQueryCache()
    .getAll()
    .filter((q) => q.queryKey[0] !== 'auth')
    .forEach((q) => client.removeQueries({ queryKey: q.queryKey as readonly unknown[] }));
}

describe('Phase 4 — the monotonic guard is scoped to a draft identity', () => {
  it("provider B's lower version is NOT rejected as stale just because A's was higher", async () => {
    // A's application is left in the slot at a high version — the state a
    // sign-out is supposed to clear, and the state this guard must survive
    // even when it has not been.
    qc.setQueryData(providerQueryKeys.onboarding.draft(), A(50));

    // B signs in. Their draft is new, so its version is legitimately lower.
    mock.onGet(DRAFT_URL).reply(200, B(3));

    mount();

    await waitFor(() => {
      expect(screen.getByTestId('draftId')).toHaveTextContent('draft-provider-b');
    });
    // The decisive assertions: B sees B.
    expect(screen.getByTestId('name')).toHaveTextContent('Provider B');
    expect(screen.getByTestId('version')).toHaveTextContent('3');
    expect(cached()?.data?.displayName).toBe('Provider B');
    expect(cached()?.draftId).toBe('draft-provider-b');
  });

  it("provider A's version is never presented on a write for provider B", async () => {
    qc.setQueryData(providerQueryKeys.onboarding.draft(), A(50));
    mock.onGet(DRAFT_URL).reply(200, B(3));

    const versionsSent: number[] = [];
    mock.onPatch(PATCH_URL).reply((config) => {
      const body = JSON.parse(String(config.data)) as { version: number };
      versionsSent.push(body.version);
      return [200, B(4)];
    });

    const h = mount();
    await waitFor(() => expect(h()).not.toBeNull());
    await waitFor(() => expect(cached()?.draftId).toBe('draft-provider-b'));

    await act(async () => {
      h().save({ displayName: 'B edits' });
      await h().flushAll();
    });

    // 3, not 50. Presenting A's token would either 409 or — far worse on a
    // server that only checked the integer — write B's edit against A's
    // optimistic lock.
    expect(versionsSent).toEqual([3]);
  });

  it('a recreated draft for the SAME provider is accepted even though its version restarts', async () => {
    // Same provider, new draft row: the id changes and the version goes back
    // to 0. This is a legitimately newer document, not a stale read.
    qc.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT('draft-gen-1', 40, 'Pat'));
    mock.onGet(DRAFT_URL).reply(200, DRAFT('draft-gen-2', 0, 'Pat'));

    mount();

    await waitFor(() => expect(screen.getByTestId('draftId')).toHaveTextContent('draft-gen-2'));
    expect(screen.getByTestId('version')).toHaveTextContent('0');
  });

  it('within ONE draft the stale-read guard still holds', async () => {
    // The Phase 4 hydration-race repair must survive the identity scoping.
    qc.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT('draft-same', 6, 'newer'));
    mock.onGet(DRAFT_URL).reply(200, DRAFT('draft-same', 5, 'older'));

    mount();

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('newer'));
    expect(cached()?.version).toBe(6);
  });

  it('sign-out removes every private onboarding query, and login rehydrates from the API', async () => {
    qc.setQueryData(providerQueryKeys.onboarding.draft(), A(50));
    qc.setQueryData(providerQueryKeys.onboarding.hub(), { tasks: [], status: 'DRAFT' });
    qc.setQueryData(providerQueryKeys.onboarding.review('en'), { canSubmit: true });
    qc.setQueryData(['auth', 'me'], { id: 'user-a' });

    purgeNonAuthQueries(qc);

    // Nothing of the provider's survives...
    expect(qc.getQueryData(providerQueryKeys.onboarding.draft())).toBeUndefined();
    expect(qc.getQueryData(providerQueryKeys.onboarding.hub())).toBeUndefined();
    expect(qc.getQueryData(providerQueryKeys.onboarding.review('en'))).toBeUndefined();
    // ...and the auth observer does, or the UI cannot render "signed out".
    expect(qc.getQueryData(['auth', 'me'])).toEqual({ id: 'user-a' });

    // B signs in: with the slot empty there is nothing to compare against, and
    // hydration is authoritative by construction.
    mock.onGet(DRAFT_URL).reply(200, B(3));
    mount();

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Provider B'));
    expect(cached()?.draftId).toBe('draft-provider-b');
  });
});
