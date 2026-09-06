import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import {
  ProviderOnboardingAutosaveProvider,
  useOnboardingStepAutosave,
} from './ProviderOnboardingAutosaveProvider';

// Sprint 9B.28 — the persistence regression gate.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// Every case here failed on 4e2bde3 for a DIFFERENT reason, and each reason is
// named on the test. They are collected in one file on purpose: they are one
// defect wearing six faces — "the coordinator does not exist, so nothing owns
// the draft" — and splitting them across the screens that expose them is how
// the sprint before this one concluded the screens were fine.
//
// The rule for this file: nothing here asserts a LABEL. A "Saved" chip is what
// the bug produced. These assert what reached the wire, in what order, with
// which version.

const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/([A-Z_]+)$/;

let mock: MockAdapter;

const DRAFT = (version: number) => ({
  state: 'DRAFT',
  currentStep: 'PROVIDER_TYPE',
  steps: [],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP', step: 'PROVIDER_TYPE' },
  complete: false,
  missing: [],
  version,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
  data: { providerType: null, displayName: 'Pat Provider' },
});

/** Requests the API actually received, in the order it received them. */
interface Sent {
  step: string;
  version: number;
  body: Record<string, unknown>;
}
let sent: Sent[];

/** Resolves the next PATCH by hand, so "in flight" is a state the test
 *  controls rather than a race it hopes for. */
let gate: { release: () => void; opened: Promise<void> } | null = null;

function newGate() {
  let release!: () => void;
  const opened = new Promise<void>((r) => {
    release = r;
  });
  return { release, opened };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 5 * 60 * 1000 },
      mutations: { retry: false },
    },
  });
}

let qc: QueryClient;

beforeEach(() => {
  sent = [];
  gate = null;
  qc = makeClient();
  mock = new MockAdapter(api);

  let version = 3;
  mock.onPatch(PATCH).reply(async (config) => {
    const step = /steps\/([A-Z_]+)$/.exec(config.url ?? '')?.[1] ?? '?';
    const body = JSON.parse(config.data as string) as Record<string, unknown> & {
      version: number;
    };
    sent.push({ step, version: body.version, body });
    if (gate) await gate.opened;
    // The server's own optimistic-lock rule, reproduced: a write that does not
    // present the CURRENT version is refused. This is what turns the
    // two-instances-one-version defect into a visible 409 rather than a
    // silently lost edit.
    if (body.version !== version) {
      return [409, { code: 'CONFLICT', details: { expectedVersion: version } }];
    }
    version += 1;
    return [200, DRAFT(version)];
  });

  mock.onGet(/\/v1\/me\/provider\/onboarding\/hub$/).reply(200, {
    tasks: [],
    progress: { complete: 0, total: 6 },
    nextAction: { kind: 'NONE' },
    status: 'DRAFT',
  });
  mock.onGet(/\/v1\/me\/provider\/onboarding\/review/).reply(200, {
    sections: [],
    blockers: [],
    canSubmit: false,
    version: 3,
  });
});

afterEach(() => {
  mock.restore();
  vi.useRealTimers();
});

function Harness({
  onReady,
}: {
  onReady: (h: {
    save: (step: 'SPECIALTIES' | 'EXPERIENCE' | 'IDENTITY', patch: Record<string, unknown>) => void;
    flushAll: () => Promise<unknown>;
  }) => void;
}) {
  const specialties = useOnboardingStepAutosave('SPECIALTIES');
  const experience = useOnboardingStepAutosave('EXPERIENCE');
  const identity = useOnboardingStepAutosave('IDENTITY');
  const ref = useRef({ specialties, experience, identity });
  // In an effect, not during render: the linter is right that a ref written
  // mid-render is a tear waiting to happen, and the harness only needs the
  // latest value by the time a test calls through it.
  useEffect(() => {
    ref.current = { specialties, experience, identity };
  });

  useEffect(() => {
    onReady({
      save: (step, patch) => {
        if (step === 'SPECIALTIES') ref.current.specialties.save(patch);
        else if (step === 'EXPERIENCE') ref.current.experience.save(patch);
        else ref.current.identity.save(patch);
      },
      flushAll: () => ref.current.specialties.flushAll(),
    });
  }, [onReady]);

  return (
    <div>
      <span data-testid="specialties-status">{specialties.status.kind}</span>
      <span data-testid="experience-status">{experience.status.kind}</span>
    </div>
  );
}

function mountHarness() {
  let handle: {
    save: (step: 'SPECIALTIES' | 'EXPERIENCE' | 'IDENTITY', patch: Record<string, unknown>) => void;
    flushAll: () => Promise<unknown>;
  } | null = null;

  qc.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT(3));

  render(
    <QueryClientProvider client={qc}>
      <ProviderOnboardingAutosaveProvider>
        <Harness
          onReady={(h) => {
            handle = h;
          }}
        />
      </ProviderOnboardingAutosaveProvider>
    </QueryClientProvider>,
  );

  return () => {
    if (!handle) throw new Error('harness never became ready');
    return handle;
  };
}

describe('Sprint 9B.28 — onboarding draft coordinator', () => {
  it('BUG 1: an edit queued and flushed inside the debounce still reaches the API', async () => {
    // BEFORE: `saveNow()` cleared the timer and called `flush()`, but `flush()`
    // returned early on `inFlight`, and nothing on any screen ever called it —
    // Close navigated synchronously. The payload died in the debounce.
    const h = mountHarness();

    await act(async () => {
      h().save('IDENTITY', { displayName: 'Typed then left' });
      await h().flushAll();
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].body.displayName).toBe('Typed then left');
  });

  it('BUG 2: "saved" does not survive a newer edit', async () => {
    // BEFORE: `save()` set `isDirty` but left `status` at `{kind:'saved'}`.
    // There was no `dirty` state in the machine at all, so the chip kept
    // claiming the newest keystroke was written.
    const h = mountHarness();

    await act(async () => {
      h().save('SPECIALTIES', { primaryServiceCategoryId: 'a' });
      await h().flushAll();
    });
    expect(screen.getByTestId('specialties-status').textContent).toBe('saved');

    act(() => {
      h().save('SPECIALTIES', { primaryServiceCategoryId: 'b' });
    });
    expect(screen.getByTestId('specialties-status').textContent).not.toBe('saved');
    expect(screen.getByTestId('specialties-status').textContent).toBe('dirty');
  });

  it('BUG 3: flushAll drains an edit queued while another write is in flight', async () => {
    // BEFORE: `flush()` opened with `if (inFlight.current) return;`, so the
    // promise `saveNow()` awaited resolved IMMEDIATELY while a request was
    // outstanding. Navigation gated on it left with the second edit unwritten.
    const h = mountHarness();
    gate = newGate();

    act(() => {
      h().save('IDENTITY', { displayName: 'first' });
    });
    const first = act(async () => {
      await h().flushAll();
    });

    await waitFor(() => expect(sent).toHaveLength(1));

    // Queued while the first is still open.
    act(() => {
      h().save('IDENTITY', { displayName: 'second' });
    });
    gate.release();
    gate = null;
    await first;

    await act(async () => {
      await h().flushAll();
    });

    expect(sent.map((s) => s.body.displayName)).toEqual(['first', 'second']);
  });

  it('BUG 4: two steps saved together serialize as [N, N+1], never [N, N]', async () => {
    // BEFORE: SPECIALTIES and EXPERIENCE were two independent hook instances
    // with two independent `inFlight` refs, both reading the version from the
    // same cache slot. They raced, both presented version N, and the loser
    // 409'd on work the provider never saw fail.
    const h = mountHarness();

    await act(async () => {
      h().save('SPECIALTIES', { primaryServiceCategoryId: 'plumbing' });
      h().save('EXPERIENCE', { yearsOfExperience: 7 });
      await h().flushAll();
    });

    expect(sent).toHaveLength(2);
    expect(sent.map((s) => s.version)).toEqual([3, 4]);
    expect(sent.every((s) => s.step !== undefined)).toBe(true);
    // Neither write may have been refused.
    expect(screen.getByTestId('specialties-status').textContent).toBe('saved');
    expect(screen.getByTestId('experience-status').textContent).toBe('saved');
  });

  it('BUG 5: a successful patch marks hub and both review locales stale', async () => {
    // BEFORE: `flush()` seeded the draft slot and stopped. Hub inherited the
    // global five-minute staleTime, so returning to the hub after an edit
    // showed a projection built before it.
    const h = mountHarness();

    await qc.prefetchQuery({
      queryKey: providerQueryKeys.onboarding.hub(),
      queryFn: async () => ({ tasks: [], progress: { complete: 0, total: 6 } }),
    });
    await qc.prefetchQuery({
      queryKey: providerQueryKeys.onboarding.review('en'),
      queryFn: async () => ({ sections: [] }),
    });
    await qc.prefetchQuery({
      queryKey: providerQueryKeys.onboarding.review('ar'),
      queryFn: async () => ({ sections: [] }),
    });

    await act(async () => {
      h().save('IDENTITY', { displayName: 'Invalidates' });
      await h().flushAll();
    });

    expect(qc.getQueryState(providerQueryKeys.onboarding.hub())?.isInvalidated).toBe(true);
    expect(qc.getQueryState(providerQueryKeys.onboarding.review('en'))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(providerQueryKeys.onboarding.review('ar'))?.isInvalidated).toBe(true);
  });

  it('BUG 6: the draft cache carries the server version after the write', async () => {
    const h = mountHarness();

    await act(async () => {
      h().save('IDENTITY', { displayName: 'Versioned' });
      await h().flushAll();
    });

    expect(
      qc.getQueryData<{ version: number }>(providerQueryKeys.onboarding.draft())?.version,
    ).toBe(4);
  });

  it('BUG 7: flushAll reports a terminal failure instead of resolving clean', async () => {
    // Navigation must be able to STAY on the task. A flush that always
    // resolved void gave the caller nothing to branch on.
    mock.onPatch(PATCH).reply(500, { code: 'INTERNAL_ERROR' });
    const h = mountHarness();

    let result: unknown;
    await act(async () => {
      h().save('IDENTITY', { displayName: 'fails' });
      result = await h().flushAll();
    });

    expect(result).toMatchObject({ ok: false, reason: 'error' });
  });
});
