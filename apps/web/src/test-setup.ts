// Wire @testing-library/jest-dom matchers onto Vitest's `expect`.
// The `@testing-library/jest-dom/vitest` entry imports `vitest` directly,
// which isn't always visible through pnpm peer symlinks in this repo.
// Using the underlying `matchers` subpath + `expect.extend` is the
// documented vitest-agnostic way and avoids that resolution edge case.
import { expect, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

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
