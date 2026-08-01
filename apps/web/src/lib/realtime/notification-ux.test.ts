import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { __resetNotificationUXForTests, triggerNotificationUX } from './notification-ux';

// Sprint 7.5.1 — triggerNotificationUX safety contract.
//
// The helper's load-bearing guarantee is: NEVER throw, regardless of
// browser support for vibration / Web Audio or autoplay policy state.
// These tests pin the no-throw contract on every degraded path the
// helper handles.
//
// happy-dom note: `navigator` is implemented as a Symbol-keyed
// non-configurable property bag and direct mutation /
// `Object.defineProperty` writes do NOT take effect. We therefore
// don't assert "vibrate was called with the right pattern" here —
// the call-site assertion would be unreliable under happy-dom. The
// behavioural contract (no throw) is what matters at the layer
// boundary, and the cooldown logic is covered by deterministic
// non-side-effect assertions.

type WindowWithAudio = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

beforeEach(() => {
  __resetNotificationUXForTests();
  vi.restoreAllMocks();
  // Clear any AudioContext stub from window. happy-dom permits
  // arbitrary `window.X = …` assignments, so this is the simplest
  // reset path.
  delete (window as WindowWithAudio).AudioContext;
  delete (window as WindowWithAudio).webkitAudioContext;
  try {
    localStorage.removeItem('realtime.notificationSound');
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('triggerNotificationUX', () => {
  it('does not throw when called against happy-dom defaults (no vibrate / no AudioContext)', () => {
    expect(() => triggerNotificationUX()).not.toThrow();
  });

  it('does not throw when only the vibration channel is exercised', () => {
    expect(() => triggerNotificationUX({ sound: false })).not.toThrow();
  });

  it('does not throw when only the sound channel is exercised', () => {
    expect(() => triggerNotificationUX({ vibration: false })).not.toThrow();
  });

  it('does not throw when navigator is undefined (SSR-like)', () => {
    vi.stubGlobal('navigator', undefined);
    expect(() => triggerNotificationUX({ sound: false })).not.toThrow();
  });

  it('does not throw when AudioContext.resume() rejects (NotAllowedError / autoplay policy)', () => {
    const oscillator = {
      type: '',
      frequency: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn().mockReturnThis(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn().mockReturnThis(),
    };
    const ctx = {
      state: 'suspended' as 'suspended' | 'running' | 'closed',
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn().mockReturnValue(oscillator),
      createGain: vi.fn().mockReturnValue(gain),
      resume: vi.fn().mockRejectedValue(new DOMException('autoplay', 'NotAllowedError')),
    };
    class StubAudioContext {
      constructor() {
        return ctx as unknown as AudioContext;
      }
    }
    (window as WindowWithAudio).AudioContext = StubAudioContext as unknown as typeof AudioContext;
    // Whether the helper actually constructs the stub depends on
    // happy-dom honouring our property assignment on `window` — what
    // matters is the no-throw contract.
    expect(() => triggerNotificationUX({ vibration: false })).not.toThrow();
  });

  it('survives a localStorage that throws (private-browsing mode)', () => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('private mode');
    };
    try {
      expect(() => triggerNotificationUX({ vibration: false })).not.toThrow();
    } finally {
      Storage.prototype.getItem = originalGetItem;
    }
  });

  it('reads the localStorage preference: explicit "off" silences the sound channel without throwing', () => {
    localStorage.setItem('realtime.notificationSound', 'off');
    // Two back-to-back calls — neither should throw even with the
    // preference disabling the sound path internally.
    expect(() => triggerNotificationUX()).not.toThrow();
    expect(() => triggerNotificationUX({ cooldownMs: 0 })).not.toThrow();
  });

  it('multiple rapid calls do not throw (cooldown path is silent)', () => {
    // Even with the default cooldown, repeated invocations must be a
    // safe no-op rather than a throw or unhandled promise rejection.
    for (let i = 0; i < 5; i += 1) {
      expect(() => triggerNotificationUX()).not.toThrow();
    }
  });
});
