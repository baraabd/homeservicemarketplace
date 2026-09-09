import { describe, it, expect } from 'vitest';
import type { RoleName } from '@homeservicemarketplace/contracts';

import {
  MAX_STALE_ROLE_ATTEMPTS,
  classifyRecovery,
  isRetryable,
  shouldAttemptRecovery,
  type RecoveryState,
} from './stale-role-recovery';

// Sprint 9B.29 — the stale-role recovery policy.
//
// These assert the two properties the rule names explicitly: a 403 is never
// globally retried, and the post-upgrade transition gets AT MOST ONE recovery
// attempt. Both are loop guards, so each is tested from the state that would
// produce the loop rather than only from the happy path.

describe('shouldAttemptRecovery', () => {
  it('does nothing when the surface is not forbidden', () => {
    // Rotating the session of a healthy page is a request storm with extra
    // steps, and it would log every provider out of nothing.
    expect(shouldAttemptRecovery({ forbidden: false, attempts: 0, state: 'idle' })).toBe(false);
  });

  it('attempts once on a fresh 403', () => {
    expect(shouldAttemptRecovery({ forbidden: true, attempts: 0, state: 'idle' })).toBe(true);
  });

  it('refuses a second attempt — this is the loop guard', () => {
    expect(
      shouldAttemptRecovery({ forbidden: true, attempts: MAX_STALE_ROLE_ATTEMPTS, state: 'idle' }),
    ).toBe(false);
  });

  it('does not start a parallel rotation while one is in flight', () => {
    // Two rotations racing to set the same cookie is how the second one lands
    // an older token than the first.
    expect(shouldAttemptRecovery({ forbidden: true, attempts: 0, state: 'recovering' })).toBe(
      false,
    );
  });

  it.each(['recovered', 'failed', 'exhausted'] as const)(
    'treats %s as terminal for this mount',
    (state) => {
      expect(shouldAttemptRecovery({ forbidden: true, attempts: 0, state })).toBe(false);
    },
  );

  it('caps the budget at exactly one', () => {
    // Pinned deliberately. Raising this constant re-introduces the retry loop
    // the rule forbids, so the number itself is the assertion.
    expect(MAX_STALE_ROLE_ATTEMPTS).toBe(1);
  });
});

describe('classifyRecovery', () => {
  it('recovers when the authoritative session now carries the provider role', () => {
    const roles: RoleName[] = ['seeker', 'provider'];
    expect(classifyRecovery(roles)).toEqual({ kind: 'recovered' });
  });

  it('reports role-missing when the rotation worked but the role did not arrive', () => {
    // The distinction that matters: the refresh succeeded, so retrying it will
    // succeed again and still not grant the role. This is a real refusal.
    const roles: RoleName[] = ['seeker'];
    expect(classifyRecovery(roles)).toEqual({ kind: 'failed', reason: 'role-missing' });
  });

  it('reports refresh-failed when the session could not be read at all', () => {
    // We did not learn that the role is absent — only that we could not ask.
    // Those are different facts and get different copy.
    expect(classifyRecovery(null)).toEqual({ kind: 'failed', reason: 'refresh-failed' });
  });

  it('never claims recovery from an empty role set', () => {
    expect(classifyRecovery([])).toEqual({ kind: 'failed', reason: 'role-missing' });
  });
});

describe('isRetryable', () => {
  it('offers a retry only for a failed refresh', () => {
    expect(isRetryable({ kind: 'failed', reason: 'refresh-failed' })).toBe(true);
  });

  it('does not offer a retry for a genuine refusal', () => {
    // A button that re-asks a question the server has already answered is a
    // lie about what is happening.
    expect(isRetryable({ kind: 'failed', reason: 'role-missing' })).toBe(false);
  });

  it.each<RecoveryState>([
    { kind: 'idle' },
    { kind: 'recovering' },
    { kind: 'recovered' },
    { kind: 'exhausted' },
  ])('does not offer a retry from $kind', (state) => {
    expect(isRetryable(state)).toBe(false);
  });
});
