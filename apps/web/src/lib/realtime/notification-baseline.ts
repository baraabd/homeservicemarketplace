// Sprint 7.13 — cross-session notification baseline.
//
// The in-memory watermark (notification-arrival-watcher) resets on every
// page load, so on each fresh login it treats the whole backlog as the
// baseline and could announce the TOTAL historical unread count as
// "N new notifications". That's misleading: 50 old unread rows are not
// 50 *new* rows.
//
// This module persists a minimal, per-(experience,user) cursor —
// `lastSeenCreatedAt` — to localStorage so a subsequent login can count
// only notifications created AFTER the previous visit as genuinely new.
//
// Privacy / safety:
//   - stores ONLY an ISO timestamp cursor; never a body/title/content,
//     token, cookie, or any personal data.
//   - keyed by experience + userId so one user's cursor can never leak
//     into another's session.
//   - every access is wrapped in try/catch so a disabled/full/throwing
//     localStorage (private mode, quota) degrades to "no baseline"
//     rather than breaking notification UX.
//
// Limitation: localStorage is per-device, so the new-count is not
// synchronised across devices. A backend "lastNotificationSeenAt"
// cursor would be required for cross-device parity; that is a larger
// change deferred until the product needs it.

import type { NotificationExperience } from './notification-target';
import { authRequestScope, isLocallySignedOut } from '../auth-session-boundary';

const STORAGE_PREFIX = 'hsm:notif-baseline:v1';

interface PersistedBaseline {
  lastSeenCreatedAt: string | null;
}

function storageKey(experience: NotificationExperience, userId: string): string {
  return `${STORAGE_PREFIX}:${experience}:${userId}`;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the persisted baseline for this (experience, user). Returns
 * `null` when no baseline has ever been written on this device — the
 * caller treats that as "first login, don't claim a new-count".
 */
export function readNotificationBaseline(
  experience: NotificationExperience,
  userId: string,
): PersistedBaseline | null {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(storageKey(experience, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedBaseline> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const v = parsed.lastSeenCreatedAt;
    return {
      lastSeenCreatedAt: typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null,
    };
  } catch {
    return null;
  }
}

/**
 * Advance (never rewind) the persisted baseline to `createdAt`. A null
 * or older value is ignored so a late-arriving historical row can't
 * move the cursor backwards.
 */
export function writeNotificationBaseline(
  experience: NotificationExperience,
  userId: string,
  createdAt: string | null,
): void {
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) return;
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    const existing = readNotificationBaseline(experience, userId);
    if (existing?.lastSeenCreatedAt && existing.lastSeenCreatedAt >= createdAt) {
      return; // never rewind
    }
    const payload: PersistedBaseline = { lastSeenCreatedAt: createdAt };
    ls.setItem(storageKey(experience, userId), JSON.stringify(payload));
  } catch {
    // Quota / disabled storage — non-fatal; new-count just falls back
    // to the generic copy next time.
  }
}

/** Remove the persisted baseline (test isolation / explicit reset). */
export function clearNotificationBaseline(
  experience: NotificationExperience,
  userId: string,
): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    ls.removeItem(storageKey(experience, userId));
  } catch {
    // ignore
  }
}

/** Test-only: wipe every persisted baseline so suites start clean. */
export function __clearAllNotificationBaselinesForTests(): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    for (const k of keys) ls.removeItem(k);
  } catch {
    // ignore
  }
}

// R25 — presentation coordination only. REST remains the inbox/read-state
// authority. A short, bounded set of opaque fingerprints is not a duplicate
// notification history: it contains no ids, bodies, titles, URLs or tokens.
const PRESENTATION_PREFIX = 'hsm:notif-presentation:v1:';
export const PRESENTATION_WINDOW_MS = 5 * 60_000;
export const PRESENTATION_CAPACITY = 200;
const MAX_PENDING_PRESENTATIONS = 32;
let pendingPresentations = 0;

// Two independent 32-bit accumulators keep storage/channel keys opaque and
// compact. This is a dedupe fingerprint, never an authorization mechanism.
export function notificationFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let i = 0; i < value.length; i += 1) {
    first = Math.imul(first ^ value.charCodeAt(i), 0x01000193);
    second = Math.imul(second ^ value.charCodeAt(i), 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

interface PresentationClaim {
  key: string;
  at: number;
  identity?: string;
}

export interface CoordinatedPresentation {
  userId: string;
  keys: readonly string[];
  // A source may omit identity present in its counterpart. Keep one opaque
  // unmatched marker and consume it when the other source arrives. A match
  // must not become a permanent wildcard for distinct identified events.
  pairedSource?: { claimKey: string; counterpartKey: string; identityKey?: string };
  // An aggregate may announce the still-unclaimed subset. For one event,
  // any matching alias (durable id or paired transition) suppresses it.
  aggregate?: boolean;
  isCurrent?: () => boolean;
  present: (unclaimedCount: number) => void;
}

/** Atomic across same-origin tabs. Unsupported/denied coordination is quiet. */
export function presentNotificationOnce(options: CoordinatedPresentation): Promise<void> {
  if (
    !options.userId ||
    options.keys.length === 0 ||
    pendingPresentations >= MAX_PENDING_PRESENTATIONS
  ) {
    return Promise.resolve();
  }
  const storage = safeLocalStorage();
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!storage || !locks) return Promise.resolve();
  const scope = authRequestScope();
  const isCurrent = () =>
    document.visibilityState !== 'hidden' &&
    !isLocallySignedOut() &&
    authRequestScope() === scope &&
    (options.isCurrent?.() ?? true);
  const key = `${PRESENTATION_PREFIX}${notificationFingerprint(options.userId)}`;
  const fingerprints = [
    ...new Set(options.keys.slice(0, PRESENTATION_CAPACITY).map(notificationFingerprint)),
  ];
  const pair = options.pairedSource
    ? {
        claim: notificationFingerprint(options.pairedSource.claimKey),
        counterpart: notificationFingerprint(options.pairedSource.counterpartKey),
        identity: options.pairedSource.identityKey
          ? notificationFingerprint(options.pairedSource.identityKey)
          : null,
      }
    : null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 2_000);
  pendingPresentations += 1;
  let operation: Promise<void>;
  try {
    operation = locks.request(key, { mode: 'exclusive', signal: abort.signal }, () => {
      // A background tab must not consume the foreground tab's opportunity
      // to present an alert. Its REST-backed unread state still converges.
      if (!isCurrent()) return;
      const now = Date.now();
      let claims: PresentationClaim[] = [];
      try {
        const raw: unknown = JSON.parse(storage.getItem(key) ?? '[]');
        if (Array.isArray(raw)) {
          claims = raw
            .slice(-PRESENTATION_CAPACITY)
            .filter(
              (value): value is PresentationClaim =>
                !!value &&
                typeof value === 'object' &&
                typeof value.key === 'string' &&
                /^[a-f0-9]{16}$/.test(value.key) &&
                typeof value.at === 'number' &&
                Number.isFinite(value.at) &&
                value.at <= now &&
                now - value.at < PRESENTATION_WINDOW_MS,
            )
            .map((value) => ({
              key: value.key,
              at: value.at,
              ...(typeof value.identity === 'string' && /^[a-f0-9]{16}$/.test(value.identity)
                ? { identity: value.identity }
                : {}),
            }));
        }
        const seen = new Set(claims.map((claim) => claim.key));
        const unseen = fingerprints.filter((fingerprint) => !seen.has(fingerprint));
        const duplicate = unseen.length !== fingerprints.length;
        const counterpart = pair ? claims.find((claim) => claim.key === pair.counterpart) : null;
        const paired =
          !options.aggregate &&
          counterpart &&
          (!duplicate || (pair?.identity && counterpart.identity === pair.identity));
        if (!options.aggregate && pair) {
          if (paired) {
            claims = claims.filter((claim) => claim.key !== pair.counterpart);
          } else if (!duplicate && !seen.has(pair.claim)) {
            claims.push({
              key: pair.claim,
              at: now,
              ...(pair.identity ? { identity: pair.identity } : {}),
            });
          }
        }
        // Record new aliases even if another alias already claimed this event.
        // A later REST notification can then match the socket's durable id.
        // A duplicate only retires the marker with the SAME durable identity.
        // Old replays cannot consume a newer unmatched event or recreate one.
        claims.push(...unseen.map((fingerprint) => ({ key: fingerprint, at: now })));
        storage.setItem(key, JSON.stringify(claims.slice(-PRESENTATION_CAPACITY)));
        if (!isCurrent() || unseen.length === 0) return;
        if (!options.aggregate && (duplicate || paired)) return;
        options.present(unseen.length);
      } catch {
        // Without the atomic ledger the app still updates its server-backed
        // inbox/badge. It must not emit duplicates from competing tabs.
      }
    });
  } catch {
    clearTimeout(timer);
    pendingPresentations -= 1;
    return Promise.resolve();
  }
  return operation
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(timer);
      pendingPresentations -= 1;
    });
}

export function __clearPresentationClaimsForTests(): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  for (const key of Object.keys(storage)) {
    if (key.startsWith(PRESENTATION_PREFIX)) storage.removeItem(key);
  }
}
