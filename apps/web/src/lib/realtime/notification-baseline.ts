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
    return { lastSeenCreatedAt: typeof v === 'string' ? v : null };
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
  if (!createdAt) return;
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
