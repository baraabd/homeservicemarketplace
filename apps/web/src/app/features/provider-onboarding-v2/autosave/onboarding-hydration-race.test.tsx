import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
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

// Sprint 09B.29 Phase 4 — the hydration/version race.
//
// WHAT THIS PINS
//
// The coordinator takes its optimistic-lock token from ONE place:
//
//     qc.getQueryData(providerQueryKeys.onboarding.draft()).version
//
// and a successful PATCH seeds that slot with the server's new view. That is
// correct as far as it goes, but the same cache slot is ALSO owned by a
// `useQuery`, and a query's own fetch result always overwrites the slot when
// it resolves — React Query has no idea a newer value was written by hand
// while the request was open.
//
// So a GET that STARTED BEFORE a PATCH can land AFTER it and put the
// pre-PATCH version back. The next edit then presents a version the server has
// already moved past, the server answers 409, and the coordinator DROPS the
// payload by design (re-sending would overwrite whoever else wrote). The
// provider's typing is discarded and the chip tells them to reload.
//
// This is reachable in ordinary use, not just in theory:
//
//   * the draft query has `staleTime` from the global default and refetches on
//     mount, so opening a task fires a GET while the form is already usable;
//   * `useAcceptTerms` and `useSubmitApplication` invalidate
//     `onboarding.root`, which matches `draft()` by prefix — but the review
//     screen never observes `draft()`, so nothing refetches it there and the
//     slot stays stale until the next task mount fires exactly this GET.
//
// Both tests below fail before the repair.

const DRAFT_URL = '/v1/me/provider/onboarding/draft';
const PATCH_URL = /\/v1\/me\/provider\/onboarding\/steps\/([A-Z_]+)$/;

let mock: MockAdapter;
let qc: QueryClient;

const DRAFT = (version: number, displayName = 'Pat'): ProviderOnboardingDraftView =>
  ({
    // One provider, one draft generation: the identity the monotonic guard
    // scopes itself to. Without it the guard correctly declines to compare,
    // because two versions with no identity are not comparable.
    draftId: 'draft-under-test',
    state: 'DRAFT',
    currentStep: 'IDENTITY',
    steps: [],
    completedSteps: [],
    percentComplete: 0,
    nextAction: { kind: 'COMPLETE_STEP', step: 'IDENTITY' },
    complete: false,
    missing: [],
    version,
    policyVersion: 'p',
    lastSavedAt: null,
    editable: true,
    data: { displayName },
  }) as unknown as ProviderOnboardingDraftView;

/** A promise whose resolution this test controls, so ordering is decided here
 *  rather than by a timer. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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

/** Mounts the real draft query — the observer whose refetch owns the cache
 *  slot — beside the coordinator, which is the whole point of the race. */
function Probe({ onReady }: { onReady: (h: Handle) => void }) {
  const draft = useOnboardingDraft();
  const a = useOnboardingStepAutosave('IDENTITY');
  const ref = useRef(a);
  useEffect(() => {
    ref.current = a;
  });
  useEffect(() => {
    onReady({
      save: (p) => ref.current.save(p),
      flushAll: () => ref.current.flushAll(),
    });
  }, [onReady]);
  return <span data-testid="v">{draft.data?.version ?? '-'}</span>;
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

const cachedVersion = () =>
  qc.getQueryData<ProviderOnboardingDraftView>(providerQueryKeys.onboarding.draft())?.version;

describe('Phase 4 — a late GET must not regress the draft the coordinator writes against', () => {
  it('a GET that started before a successful PATCH cannot put the old version back', async () => {
    // The GET is held open for the whole test, and answers with the PRE-patch
    // snapshot when it is finally allowed to.
    const get = deferred<ProviderOnboardingDraftView>();
    mock.onGet(DRAFT_URL).reply(async () => [200, await get.promise]);

    // The PATCH advances the server 5 -> 6.
    mock.onPatch(PATCH_URL).reply(200, DRAFT(6, 'Patricia'));

    // Prime the slot so the coordinator has a token to present, exactly as a
    // previous screen or a prefetch would have left it.
    qc.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT(5));

    const h = mount();
    await waitFor(() => expect(h()).not.toBeNull());

    // The provider types and the edit is flushed. The PATCH resolves while the
    // GET is still open.
    await act(async () => {
      h().save({ displayName: 'Patricia' });
      await h().flushAll();
    });
    expect(cachedVersion()).toBe(6);

    // NOW the slow GET lands, carrying the world as it was before the write.
    await act(async () => {
      get.resolve(DRAFT(5));
      await Promise.resolve();
    });

    await waitFor(() => {
      // The acknowledged version must not go backwards. A stale read is not a
      // reason to forget a write the server already committed.
      expect(cachedVersion()).toBe(6);
    });
  });

  it('the next edit presents the acknowledged version, so it is not 409ed into the bin', async () => {
    const get = deferred<ProviderOnboardingDraftView>();
    mock.onGet(DRAFT_URL).reply(async () => [200, await get.promise]);

    const versionsSent: number[] = [];
    mock.onPatch(PATCH_URL).reply((config) => {
      const body = JSON.parse(String(config.data)) as { version: number };
      versionsSent.push(body.version);
      // The server is at 5 to begin with and moves to 6. A second write that
      // still presents 5 is stale and the real server answers 409.
      if (body.version !== 5 + versionsSent.length - 1) {
        return [409, { details: { expectedVersion: 6 } }];
      }
      return [200, DRAFT(5 + versionsSent.length, 'x')];
    });

    qc.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT(5));

    const h = mount();
    await waitFor(() => expect(h()).not.toBeNull());

    await act(async () => {
      h().save({ displayName: 'first' });
      await h().flushAll();
    });

    // The stale read lands between the two edits.
    await act(async () => {
      get.resolve(DRAFT(5));
      await Promise.resolve();
    });

    let second: { ok: boolean; reason?: string } = { ok: false };
    await act(async () => {
      h().save({ displayName: 'second' });
      second = await h().flushAll();
    });

    expect(versionsSent).toEqual([5, 6]);
    // The provider typed something valid twice. Neither write may be lost to a
    // conflict manufactured by our own cache.
    expect(second.ok).toBe(true);
  });

  // The cache guard above only runs on a QUERY RESULT. `setQueryData` does not
  // go through `structuralSharing`, and `useSubmitOnboarding` and
  // `useWithdrawOnboarding` both write this slot that way — so a slow response
  // from either can still put an older view back, with nothing in the query
  // layer to stop it.
  //
  // This is the case the coordinator's own acknowledged-version ref exists
  // for, and it is pinned separately because disabling that ref leaves every
  // other test in this file passing.
  it('a direct setQueryData with an older view cannot un-acknowledge a committed write', async () => {
    mock.onGet(DRAFT_URL).reply(200, DRAFT(5));

    const versionsSent: number[] = [];
    mock.onPatch(PATCH_URL).reply((config) => {
      const body = JSON.parse(String(config.data)) as { version: number };
      versionsSent.push(body.version);
      return [200, DRAFT(body.version + 1, 'x')];
    });

    qc.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT(5));

    const h = mount();
    await waitFor(() => expect(h()).not.toBeNull());

    await act(async () => {
      h().save({ displayName: 'first' });
      await h().flushAll();
    });
    expect(versionsSent).toEqual([5]);

    // Exactly what a late `useWithdrawOnboarding`/`useSubmitOnboarding`
    // response does: a hand-written seed carrying a pre-write view.
    await act(async () => {
      qc.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT(5));
      await Promise.resolve();
    });

    await act(async () => {
      h().save({ displayName: 'second' });
      await h().flushAll();
    });

    // 6, not 5. The server acknowledged 6 and no client-side write may talk it
    // back down into a conflict the provider did nothing to cause.
    expect(versionsSent).toEqual([5, 6]);
  });
});
