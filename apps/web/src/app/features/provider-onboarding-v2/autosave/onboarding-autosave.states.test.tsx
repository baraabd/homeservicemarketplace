import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { api } from '../../../../lib/api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import {
  AUTOSAVE_DEBOUNCE_MS,
  ProviderOnboardingAutosaveProvider,
  useOnboardingStepAutosave,
} from './ProviderOnboardingAutosaveProvider';
import { mergeAutosaveStatus, mergeAllAutosaveStatuses } from '../autosave-status';
import { AUTOSAVE_COPY } from '../copy/autosave-copy';
import { EXIT_COPY } from '../copy/exit-copy';

// Sprint 9B.28 — the autosave STATE MACHINE, one case per transition.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// Separate from the regression file next door on purpose: that one pins the
// six defects and would lose its meaning padded out with coverage. This one is
// the ordinary contract — every status, every HTTP code, both languages.

const PATCH = /\/v1\/me\/provider\/onboarding\/steps\/([A-Z_]+)$/;

let mock: MockAdapter;
let qc: QueryClient;
let sent: number;

const DRAFT = (version: number) => ({
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
  data: { displayName: 'Pat' },
});

beforeEach(() => {
  sent = 0;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Handle = {
  save: (patch: Record<string, unknown>) => void;
  flushAll: () => Promise<{ ok: boolean; reason?: string }>;
};

function Probe({ onReady }: { onReady: (h: Handle) => void }) {
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
  return (
    <>
      <span data-testid="kind">{a.status.kind}</span>
      <span data-testid="dirty">{String(a.isDirty)}</span>
      <span data-testid="stale">
        {a.status.kind === 'saved' ? String(a.status.projectionStale ?? false) : '-'}
      </span>
    </>
  );
}

function mount() {
  let handle: Handle | null = null;
  qc.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT(1));
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
  return () => handle!;
}

const kind = () => screen.getByTestId('kind').textContent;

describe('the state machine', () => {
  beforeEach(() => {
    mock.onPatch(PATCH).reply(() => {
      sent += 1;
      return [200, DRAFT(1 + sent)];
    });
  });

  it('idle → dirty on the first change, before anything is sent', () => {
    const h = mount();
    expect(kind()).toBe('idle');
    act(() => h().save({ displayName: 'a' }));
    expect(kind()).toBe('dirty');
    expect(sent).toBe(0);
  });

  it('dirty → saving → saved across one flush', async () => {
    const h = mount();
    act(() => h().save({ displayName: 'a' }));
    await act(async () => {
      await h().flushAll();
    });
    expect(kind()).toBe('saved');
    expect(screen.getByTestId('dirty').textContent).toBe('false');
  });

  it('fires on its own once the debounce expires — no flush call needed', async () => {
    vi.useFakeTimers();
    const h = mount();
    act(() => h().save({ displayName: 'a' }));
    expect(sent).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
      await vi.runAllTimersAsync();
    });
    expect(sent).toBe(1);
  });

  it('coalesces a burst of edits into ONE write', async () => {
    const h = mount();
    act(() => {
      h().save({ displayName: 'a' });
      h().save({ displayName: 'ab' });
      h().save({ displayName: 'abc' });
    });
    await act(async () => {
      await h().flushAll();
    });
    expect(sent).toBe(1);
  });

  it('flushAll on a clean draft resolves ok without sending anything', async () => {
    const h = mount();
    let r: { ok: boolean } | undefined;
    await act(async () => {
      r = await h().flushAll();
    });
    expect(r).toEqual({ ok: true });
    expect(sent).toBe(0);
  });
});

describe('failures, one per status code', () => {
  const cases = [
    { code: 400, reason: 'error', kind: 'error' },
    { code: 401, reason: 'error', kind: 'error' },
    { code: 403, reason: 'error', kind: 'error' },
    { code: 422, reason: 'error', kind: 'error' },
    { code: 500, reason: 'error', kind: 'error' },
  ] as const;

  for (const c of cases) {
    it(`${c.code} leaves the step in '${c.kind}' and reports '${c.reason}'`, async () => {
      mock.onPatch(PATCH).reply(c.code, { code: 'X' });
      const h = mount();
      let r: { ok: boolean; reason?: string } | undefined;
      await act(async () => {
        h().save({ displayName: 'x' });
        r = await h().flushAll();
      });
      expect(kind()).toBe(c.kind);
      expect(r?.ok).toBe(false);
      expect(r?.reason).toBe(c.reason);
    });
  }

  it('409 is a CONFLICT, not an error, and does not re-queue the edit', async () => {
    mock.onPatch(PATCH).reply(409, { code: 'CONFLICT', details: { expectedVersion: 9 } });
    const h = mount();
    let r: { ok: boolean; reason?: string } | undefined;
    await act(async () => {
      h().save({ displayName: 'x' });
      r = await h().flushAll();
    });
    expect(kind()).toBe('conflict');
    expect(r?.reason).toBe('conflict');

    // A second flush must NOT resend it — retrying a 409 would overwrite what
    // the other writer put there.
    const before = mock.history.patch.length;
    await act(async () => {
      await h().flushAll();
    });
    expect(mock.history.patch.length).toBe(before);
  });

  it('does not trap the provider on the task after a conflict', async () => {
    // The conflict DROPS its patch, so the queue empties. A later flush must
    // therefore answer "yes, you may leave" — it has nothing to lose. It used
    // to replay the stale conflict from `lastResult` and refuse every exit
    // forever, so the only way off the screen was a reload.
    mock.onPatch(PATCH).reply(409, { code: 'CONFLICT', details: { expectedVersion: 9 } });
    const h = mount();

    let first;
    await act(async () => {
      h().save({ displayName: 'x' });
      first = await h().flushAll();
    });
    expect(first).toMatchObject({ ok: false, reason: 'conflict' });

    // Reported once. The chip still says conflict; navigation is not vetoed.
    let second;
    await act(async () => {
      second = await h().flushAll();
    });
    expect(second).toEqual({ ok: true });
    expect(kind()).toBe('conflict');
  });

  it('a network failure is retryable and the retry actually resends', async () => {
    mock.onPatch(PATCH).networkErrorOnce();
    mock.onPatch(PATCH).reply(200, DRAFT(2));
    const h = mount();

    await act(async () => {
      h().save({ displayName: 'x' });
      await h().flushAll();
    });
    expect(kind()).toBe('error');

    // The payload was put BACK, so a retry has something to send.
    await act(async () => {
      await h().flushAll();
    });
    expect(kind()).toBe('saved');
  });

  it('does not hot-loop the network after a failure', async () => {
    mock.onPatch(PATCH).reply(500);
    const h = mount();
    await act(async () => {
      h().save({ displayName: 'x' });
      await h().flushAll();
    });
    const attempts = mock.history.patch.length;
    // Give any stray re-drain a chance to fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mock.history.patch.length).toBe(attempts);
  });
});

describe('offline', () => {
  it('HOLDS the edit rather than failing it, and says so', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, onLine: false });
    mock.onPatch(PATCH).reply(200, DRAFT(2));
    const h = mount();

    let r: { ok: boolean; reason?: string } | undefined;
    await act(async () => {
      h().save({ displayName: 'held' });
      r = await h().flushAll();
    });

    expect(kind()).toBe('offline');
    expect(r?.reason).toBe('offline');
    // Nothing was sent, and nothing was dropped.
    expect(mock.history.patch.length).toBe(0);
  });

  it('drains the held edit when the connection returns', async () => {
    vi.stubGlobal('navigator', { ...window.navigator, onLine: false });
    mock.onPatch(PATCH).reply(200, DRAFT(2));
    const h = mount();

    await act(async () => {
      h().save({ displayName: 'held' });
      await h().flushAll();
    });
    expect(kind()).toBe('offline');

    vi.stubGlobal('navigator', { ...window.navigator, onLine: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 20));
    });

    await waitFor(() => expect(kind()).toBe('saved'));
    expect(mock.history.patch[0].data).toContain('held');
  });
});

describe('read models', () => {
  it('says "Saved — refreshing status" when the projection refresh fails', async () => {
    mock.onPatch(PATCH).reply(200, DRAFT(2));
    // The hub refetch is what fails. The WRITE succeeded, so the chip must not
    // claim otherwise.
    mock.onGet(/\/onboarding\/hub$/).reply(500);
    mock.onGet(/\/onboarding\/review/).reply(500);

    qc.setQueryData(providerQueryKeys.onboarding.hub(), { tasks: [] });
    await qc.prefetchQuery({
      queryKey: providerQueryKeys.onboarding.hub(),
      queryFn: async () => {
        throw new Error('hub down');
      },
    });

    const h = mount();
    await act(async () => {
      h().save({ displayName: 'x' });
      await h().flushAll();
    });

    expect(kind()).toBe('saved');
  });
});

describe('unmount', () => {
  it('a response that lands after the task closed still updates the cache', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mock.onPatch(PATCH).reply(async () => {
      await gate;
      return [200, DRAFT(7)];
    });

    // The coordinator is mounted ABOVE the task, so unmounting the task must
    // not abandon the write. This is the defect the old
    // `if (!mounted.current) return;` guard produced: the server wrote and the
    // client threw the answer away.
    let handle: Handle | null = null;
    qc.setQueryData(providerQueryKeys.onboarding.draft(), DRAFT(1));

    function Task() {
      const a = useOnboardingStepAutosave('IDENTITY');
      const ref = useRef(a);
      useEffect(() => {
        ref.current = a;
      });
      useEffect(() => {
        handle = { save: (p) => ref.current.save(p), flushAll: () => ref.current.flushAll() };
      }, []);
      return null;
    }

    function Host({ showTask }: { showTask: boolean }) {
      return (
        <QueryClientProvider client={qc}>
          <ProviderOnboardingAutosaveProvider>
            {showTask ? <Task /> : null}
          </ProviderOnboardingAutosaveProvider>
        </QueryClientProvider>
      );
    }

    const { rerender } = render(<Host showTask />);
    let flushed: Promise<unknown> | null = null;
    act(() => {
      handle!.save({ displayName: 'survives' });
      flushed = handle!.flushAll();
    });

    // Close the task while the write is open.
    rerender(<Host showTask={false} />);
    await act(async () => {
      release();
      await flushed;
    });

    expect(
      qc.getQueryData<{ version: number }>(providerQueryKeys.onboarding.draft())?.version,
    ).toBe(7);
  });
});

describe('status precedence across two steps on one screen', () => {
  const saved = { kind: 'saved', at: 1 } as const;
  const dirty = { kind: 'dirty' } as const;
  const saving = { kind: 'saving' } as const;
  const offline = { kind: 'offline' } as const;
  const conflict = { kind: 'conflict', serverVersion: 2 } as const;
  const error = { kind: 'error', message: '500', retry: () => {} } as const;

  it('never reports "Saved" while the other step is dirty', () => {
    expect(mergeAutosaveStatus(saved, dirty).kind).toBe('dirty');
    expect(mergeAutosaveStatus(dirty, saved).kind).toBe('dirty');
  });

  it('never reports "Saved" while the other step is saving, offline or failed', () => {
    expect(mergeAutosaveStatus(saved, saving).kind).toBe('saving');
    expect(mergeAutosaveStatus(saved, offline).kind).toBe('offline');
    expect(mergeAutosaveStatus(saved, error).kind).toBe('error');
    expect(mergeAutosaveStatus(saved, conflict).kind).toBe('conflict');
  });

  it('reports Saved only when nothing else is outstanding', () => {
    expect(mergeAutosaveStatus(saved, { kind: 'idle' }).kind).toBe('saved');
    expect(mergeAllAutosaveStatuses([saved, saved]).kind).toBe('saved');
  });

  it('conflict outranks everything', () => {
    for (const other of [saved, dirty, saving, offline, error]) {
      expect(mergeAutosaveStatus(conflict, other).kind).toBe('conflict');
      expect(mergeAutosaveStatus(other, conflict).kind).toBe('conflict');
    }
  });
});

describe('bilingual copy', () => {
  it('has exact key parity for autosave and exit copy', () => {
    expect(Object.keys(AUTOSAVE_COPY.en).sort()).toEqual(Object.keys(AUTOSAVE_COPY.ar).sort());
    expect(Object.keys(EXIT_COPY.en).sort()).toEqual(Object.keys(EXIT_COPY.ar).sort());
  });

  it('carries a real Arabic string for every new key, not the English one', () => {
    for (const key of ['dirty', 'savedProjectionStale'] as const) {
      expect(AUTOSAVE_COPY.ar[key]).not.toBe(AUTOSAVE_COPY.en[key]);
      expect(AUTOSAVE_COPY.ar[key].trim().length).toBeGreaterThan(0);
      // Arabic block — proves it was translated rather than transliterated.
      expect(/[؀-ۿ]/.test(AUTOSAVE_COPY.ar[key])).toBe(true);
    }
    for (const key of Object.keys(EXIT_COPY.en) as (keyof typeof EXIT_COPY.en)[]) {
      expect(/[؀-ۿ]/.test(EXIT_COPY.ar[key])).toBe(true);
    }
  });
});
