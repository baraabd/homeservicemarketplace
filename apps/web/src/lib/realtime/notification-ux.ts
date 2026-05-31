// Sprint 7.5.1 — safe sound + vibration utility for important realtime
// events.
//
// Design goals:
//   1. Never throw. Browser feature support varies; autoplay policies
//      block audio without a user gesture. Both paths are wrapped in
//      try/catch with a swallow.
//   2. No large base64 audio in source. We synthesise a short tone
//      with the Web Audio API (~80ms gain envelope) so the bundle
//      stays lean.
//   3. Cooldown / dedupe so bursts of events don't produce a buzz-
//      saw of beeps. Default 1500ms window — enough to coalesce a
//      booking.status_changed + the paired notification.created
//      that fire in the same tick.
//   4. Honour a user preference. Persisted in localStorage under
//      `realtime.notificationSound` ('on' | 'off'); default 'on'.
//      Out of scope for this sprint to add a UI toggle; the helper
//      is the canonical read site so a future Settings switch only
//      needs to write the same key.

const COOLDOWN_MS_DEFAULT = 1500;
const VIBRATION_PATTERN: number[] = [200, 100, 200];
const PREF_KEY = 'realtime.notificationSound';

// Module-level state. Kept tiny — one timestamp per UX surface.
let lastSoundAt = 0;
let lastVibrationAt = 0;

export interface TriggerNotificationUXOptions {
  // Override the cooldown window. Tests use this to assert dedupe
  // without sleeping; production callers should accept the default.
  cooldownMs?: number;
  // Skip the sound channel (e.g. an event known to be silent).
  sound?: boolean;
  // Skip the vibration channel.
  vibration?: boolean;
}

export function triggerNotificationUX(options: TriggerNotificationUXOptions = {}): void {
  const cooldown = options.cooldownMs ?? COOLDOWN_MS_DEFAULT;
  const now = nowMs();

  // Sound — honoured only when both the user preference is 'on' AND
  // the cooldown window has elapsed. The cooldown is per-channel so
  // a silent-vibration burst can still trigger sound on the next
  // legitimate event.
  if (options.sound !== false && readSoundPreference() && now - lastSoundAt >= cooldown) {
    lastSoundAt = now;
    safePlayTone();
  }

  // Vibration — same cooldown semantics, gated on browser support.
  if (options.vibration !== false && now - lastVibrationAt >= cooldown) {
    lastVibrationAt = now;
    safeVibrate();
  }
}

// ─── helpers ────────────────────────────────────────────────────────

function nowMs(): number {
  // performance.now is monotonic and unaffected by clock adjustments;
  // Date.now is the safe fallback for older environments / SSR.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function readSoundPreference(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    const v = localStorage.getItem(PREF_KEY);
    // Default 'on' — when the key has never been written, sound is
    // enabled. The user toggles via a future Settings screen.
    return v !== 'off';
  } catch {
    // Storage can throw in private-browsing modes; treat as default 'on'.
    return true;
  }
}

function safeVibrate(): void {
  try {
    // navigator.vibrate is missing on iOS Safari, desktop Chrome on
    // macOS, and inside test environments. Guard via optional chain
    // + typeof so an SSR / jest environment without `navigator` is
    // also safe.
    if (typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
    nav.vibrate?.(VIBRATION_PATTERN);
  } catch {
    // Some platforms throw SecurityError under heavy CSP — swallow.
  }
}

// Lazily-constructed AudioContext, reused across calls so we don't
// leak one per beep. Created on first need to avoid an autoplay
// policy violation at module load (some browsers count AudioContext
// creation outside a user gesture as a violation).
let audioCtx: AudioContext | null = null;

function safePlayTone(): void {
  try {
    if (typeof window === 'undefined') return;
    // The window/Worker `AudioContext` is the canonical Web Audio
    // entry point; some older browsers expose it as
    // `webkitAudioContext`.
    const Ctor =
      (
        window as Window & {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }
      ).AudioContext ||
      (
        window as Window & {
          AudioContext?: typeof AudioContext;
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!Ctor) return;

    if (!audioCtx) {
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') {
      // resume() can reject (autoplay policy); we ignore the rejection.
      audioCtx.resume().catch(() => {
        /* swallow */
      });
    }

    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Two-note arpeggio — short, friendly, distinct from a generic
    // system beep. 880Hz → 1320Hz over ~80ms.
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    // Soft attack + decay so the tone isn't a click.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    // Catches AudioContext construction errors, NotAllowedError on
    // resume(), and any other Web Audio quirk. The UX is best-effort
    // by design — silent failure is preferred over a thrown exception
    // that would crash the React render path.
  }
}

// Test-only reset. The cooldown timestamps and audio context are
// module-level so we expose a controlled reset rather than letting
// tests reach into the internals.
export function __resetNotificationUXForTests(): void {
  lastSoundAt = 0;
  lastVibrationAt = 0;
  audioCtx = null;
}
