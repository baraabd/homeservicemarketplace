// Wire @testing-library/jest-dom matchers onto Vitest's `expect`.
// The `@testing-library/jest-dom/vitest` entry imports `vitest` directly,
// which isn't always visible through pnpm peer symlinks in this repo.
// Using the underlying `matchers` subpath + `expect.extend` is the
// documented vitest-agnostic way and avoids that resolution edge case.
import { afterEach, expect, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { configure } from '@testing-library/react';

expect.extend(matchers);

// Give the async utilities a budget that survives a loaded CI runner.
//
// `waitFor`, `findBy*` and friends default to 1000ms. That is ample on a
// developer machine and marginal on a 2-core GitHub runner executing 59 test
// files in parallel: a click that dispatches a React Query mutation through
// axios and back has to win a scheduling race against every other worker to
// land inside one second.
//
// When it loses, the failure reads as a wrong assertion rather than as a
// timeout — `waitFor` retries until the budget expires and then rethrows the
// LAST assertion error, so a slow POST surfaces as
// "expected +0 to be 1", which looks exactly like the endpoint never being
// called. That is what made this an expensive class of failure to diagnose:
// the symptom accuses the component, the cause is the clock.
//
// Raising the ceiling cannot make a wrong assertion pass. `waitFor` returns
// the moment its callback succeeds, so a correct test is not slowed down at
// all; only a genuinely failing one now takes longer to give up. This file
// already carried one hand-tuned `{ timeout: 5000 }` for the same reason
// (see openProfileTab in ProviderApp.test.tsx) — this makes the whole suite
// consistent instead of fixing it one call site at a time, after each one has
// cost somebody an afternoon.
configure({ asyncUtilTimeout: 5000 });

// Reset browser-persisted preferences between tests.
//
// The language choice is now persisted (Phase 12: it has to survive navigation
// and reload), and happy-dom keeps one localStorage for the whole test FILE.
// Without this, a test that switches to Arabic left every later test in the
// same file rendering Arabic — which surfaced as three unrelated provider
// tests asserting on English copy and receiving 'سباكة'.
//
// Wrapped because localStorage is designed to be able to throw (blocked site
// data), and a teardown hook must never be the thing that fails a suite.
afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // Storage unavailable in this environment — nothing to reset.
  }
});

// Sprint 7.0 — globally stub the realtime socket client. AuthProvider
// calls useRealtimeSocket whenever the user is authenticated; without
// this mock every test that mounts an authed user (the majority of
// integration suites) would try to open a live socket.io connection to
// the configured API origin and hang on connect under happy-dom.
vi.mock('./lib/realtime/socket-client', () => ({
  openRealtimeSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    connect: vi.fn(),
  })),
  closeRealtimeSocket: vi.fn(),
  getActiveSocket: vi.fn(() => null),
  subscribeToConversation: vi.fn(async () => ({ ok: false })),
}));
