import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RealtimeEvent } from '@homeservicemarketplace/contracts';

import { __resetSideEffectsForTests, dispatchRealtimeSideEffects } from './side-effects';
import { __resetRealtimeI18nForTests, setRealtimeLang } from './realtime-i18n';
import { __resetNotificationUXForTests } from './notification-ux';

// Sprint 7.5.1 — side-effects bridge tests.
// Sprint 7.6 — anti-echo gate via envelope.actorUserId.
//
// We mock `sonner` so the toast surface is observable, and the
// `notification-ux` module so we can verify the dispatcher calls it
// without exercising Web Audio in jsdom. Each test resets the module-
// level dedupe map + cooldown timestamps + i18n lang so the tests are
// order-independent.

const toastSuccess = vi.fn();
const toastDefault = vi.fn();
vi.mock('sonner', () => {
  const fn = Object.assign((...args: unknown[]) => toastDefault(...args), {
    success: (...args: unknown[]) => toastSuccess(...args),
  });
  return { toast: fn };
});

const triggerSpy = vi.fn();
vi.mock('./notification-ux', async () => {
  const actual = await vi.importActual<typeof import('./notification-ux')>('./notification-ux');
  return {
    ...actual,
    triggerNotificationUX: (...args: unknown[]) => triggerSpy(...args),
  };
});

// Helper to build a realtime envelope. `actorUserId` is intentionally
// placed at the envelope level — Sprint 7.6's contract puts the field
// on the wire envelope (the payload may also carry it, but the
// envelope wins per the side-effects bridge's lookup order).
function event<T>(
  type: RealtimeEvent['type'],
  payload: T = {} as T,
  envelopeOver: Partial<Pick<RealtimeEvent, 'userId' | 'actorUserId'>> = {},
): RealtimeEvent<T> {
  return {
    v: 1,
    type,
    userId: envelopeOver.userId ?? 'u-recipient',
    actorUserId: envelopeOver.actorUserId ?? null,
    occurredAt: '2026-05-30T10:00:00Z',
    payload,
  };
}

beforeEach(() => {
  toastSuccess.mockClear();
  toastDefault.mockClear();
  triggerSpy.mockClear();
  __resetSideEffectsForTests();
  __resetRealtimeI18nForTests();
  __resetNotificationUXForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('dispatchRealtimeSideEffects', () => {
  it('booking.status_changed → success toast + triggers notification UX (non-actor recipient)', () => {
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-1',
          requestId: 'req-1',
          bidId: 'bid-1',
          from: 'SCHEDULED',
          to: 'IN_PROGRESS',
          actorUserId: 'user-prov-1',
          actorRole: 'PROVIDER',
        },
        { actorUserId: 'user-prov-1' },
      ),
      // Seeker is viewing; provider triggered the start.
      { currentUserId: 'user-seeker-1' },
    );
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Booking started');
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('localises the toast to Arabic when the lang bridge is set to ar', () => {
    setRealtimeLang('ar');
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-1',
          requestId: 'req-1',
          bidId: 'bid-1',
          from: 'IN_PROGRESS',
          to: 'COMPLETED',
          actorUserId: 'user-prov-1',
          actorRole: 'PROVIDER',
        },
        { actorUserId: 'user-prov-1' },
      ),
      { currentUserId: 'user-seeker-1' },
    );
    expect(toastSuccess).toHaveBeenCalledWith('تم إنجاز الحجز');
  });

  it('falls back to the generic "Booking status updated" copy for unrecognised target status', () => {
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-1',
          requestId: 'req-1',
          bidId: 'bid-1',
          from: 'SCHEDULED',
          // Cast through unknown so the test can exercise the default
          // branch without the contract widening.
          to: 'EXOTIC_STATE' as unknown as 'SCHEDULED',
          actorUserId: 'user-prov-1',
          actorRole: 'PROVIDER',
        },
        { actorUserId: 'user-prov-1' },
      ),
      { currentUserId: 'user-seeker-1' },
    );
    expect(toastSuccess).toHaveBeenCalledWith('Booking status updated');
  });

  // ─── Sprint 7.6 — anti-echo gate ────────────────────────────────

  it('SILENCES toast + UX when envelope.actorUserId === currentUserId', () => {
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-self',
          requestId: 'req-self',
          bidId: 'bid-self',
          from: 'SCHEDULED',
          to: 'IN_PROGRESS',
          actorUserId: 'user-prov-1',
          actorRole: 'PROVIDER',
        },
        { actorUserId: 'user-prov-1' },
      ),
      // Provider is viewing their OWN action's echo.
      { currentUserId: 'user-prov-1' },
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastDefault).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('SILENCES notification.created when envelope.actorUserId === currentUserId', () => {
    // Anti-echo for the "BID_ACCEPTED → seeker self-notification"
    // shape that Sprint 7.6 removed at the BACKEND. This test pins
    // the FRONTEND gate as defence in depth — if any path ever
    // emits a self-notification, the bridge still suppresses the
    // toast.
    dispatchRealtimeSideEffects(
      event(
        'notification.created',
        { id: 'notif-self', resourceType: 'BID', resourceId: 'bid-1' },
        { actorUserId: 'user-1' },
      ),
      { currentUserId: 'user-1' },
    );
    expect(toastDefault).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('FIRES UX when actor !== current (non-actor recipient gets feedback)', () => {
    dispatchRealtimeSideEffects(
      event(
        'notification.created',
        { id: 'notif-other', resourceType: 'BID', resourceId: 'bid-9' },
        { actorUserId: 'user-actor' },
      ),
      { currentUserId: 'user-recipient' },
    );
    expect(toastDefault).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('PROVIDER receives UX for SEEKER-generated events (provider != seeker actor)', () => {
    // The provider's socket receives `booking.created` after the
    // seeker accepts a bid. Anti-echo MUST NOT suppress this — the
    // provider is the non-actor recipient.
    dispatchRealtimeSideEffects(
      event(
        'notification.created',
        {
          id: 'notif-prov',
          resourceType: 'BOOKING',
          resourceId: 'bk-1',
          metadata: { to: '' },
        },
        { actorUserId: 'user-seeker' },
      ),
      { currentUserId: 'user-provider' },
    );
    expect(toastDefault).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to payload.actorUserId when envelope.actorUserId is absent (backward compat)', () => {
    // Older publishers may not set the envelope-level field yet;
    // the bridge inspects the payload as a fallback before deciding
    // anti-echo. Pin the lookup-order contract.
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-fb',
          requestId: 'req-fb',
          bidId: 'bid-fb',
          from: 'SCHEDULED',
          to: 'IN_PROGRESS',
          actorUserId: 'user-prov-1', // payload-level only
          actorRole: 'PROVIDER',
        },
        // Envelope omits actorUserId — null.
        { actorUserId: null },
      ),
      { currentUserId: 'user-prov-1' },
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  // Critical dedupe guarantee. The backend writes a Notification +
  // publishes booking.status_changed for the same booking transition
  // (e.g. complete) inside the same mutation; the two events arrive
  // back-to-back. We MUST only beep + toast once.
  it('does NOT trigger duplicate UX when notification.created and booking.status_changed land for the same booking transition', () => {
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-1',
          requestId: 'req-1',
          bidId: 'bid-1',
          from: 'IN_PROGRESS',
          to: 'COMPLETED',
          actorUserId: 'user-prov-1',
          actorRole: 'PROVIDER',
        },
        { actorUserId: 'user-prov-1' },
      ),
      { currentUserId: 'user-seeker-1' },
    );
    dispatchRealtimeSideEffects(
      event(
        'notification.created',
        {
          id: 'notif-1',
          resourceType: 'BOOKING',
          resourceId: 'bk-1',
          metadata: { to: 'COMPLETED' },
        },
        { actorUserId: 'user-prov-1' },
      ),
      { currentUserId: 'user-seeker-1' },
    );
    // Exactly ONE toast call total (the booking one); the paired
    // notification.created collapses under the dedupe key.
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastDefault).not.toHaveBeenCalled();
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('treats two DIFFERENT booking transitions on the same booking as distinct events', () => {
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-1',
          requestId: 'req-1',
          bidId: 'bid-1',
          from: 'SCHEDULED',
          to: 'IN_PROGRESS',
          actorUserId: 'user-prov-1',
          actorRole: 'PROVIDER',
        },
        { actorUserId: 'user-prov-1' },
      ),
      { currentUserId: 'user-seeker-1' },
    );
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-1',
          requestId: 'req-1',
          bidId: 'bid-1',
          from: 'IN_PROGRESS',
          to: 'COMPLETED',
          actorUserId: 'user-prov-1',
          actorRole: 'PROVIDER',
        },
        { actorUserId: 'user-prov-1' },
      ),
      { currentUserId: 'user-seeker-1' },
    );
    // Both surface — the dedupe key includes `to`, so a start AND a
    // complete on the same booking is two distinct UX events.
    expect(toastSuccess).toHaveBeenCalledTimes(2);
    expect(triggerSpy).toHaveBeenCalledTimes(2);
  });

  it('treats the same transition from TWO different actors as distinct events (actor in dedupe key)', () => {
    // Edge case: a single user has TWO devices, one of which is the
    // provider tab (would be silenced by anti-echo if it were the
    // actor). Different actors → different dedupe keys → both
    // surface.
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-shared',
          requestId: 'r',
          bidId: 'b',
          from: 'SCHEDULED',
          to: 'IN_PROGRESS',
          actorUserId: 'actor-A',
          actorRole: 'PROVIDER',
        },
        { actorUserId: 'actor-A' },
      ),
      { currentUserId: 'observer' },
    );
    dispatchRealtimeSideEffects(
      event(
        'booking.status_changed',
        {
          bookingId: 'bk-shared',
          requestId: 'r',
          bidId: 'b',
          from: 'SCHEDULED',
          to: 'IN_PROGRESS',
          actorUserId: 'actor-B',
          actorRole: 'PROVIDER',
        },
        { actorUserId: 'actor-B' },
      ),
      { currentUserId: 'observer' },
    );
    expect(toastSuccess).toHaveBeenCalledTimes(2);
  });

  it('notification.created without a booking resource falls back to a generic toast', () => {
    dispatchRealtimeSideEffects(
      event(
        'notification.created',
        { id: 'notif-bare', resourceType: null, resourceId: null },
        { actorUserId: 'someone-else' },
      ),
      { currentUserId: 'user-1' },
    );
    expect(toastDefault).toHaveBeenCalledTimes(1);
    expect(toastDefault).toHaveBeenCalledWith('New notification');
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('non-toastable event types (e.g. provider.status_changed) do not call toast or UX', () => {
    dispatchRealtimeSideEffects(event('provider.status_changed', { providerProfileId: 'pp-1' }), {
      currentUserId: 'user-1',
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastDefault).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('treats system-originated events (actorUserId null) as non-actor for every recipient', () => {
    dispatchRealtimeSideEffects(
      event(
        'notification.created',
        { id: 'notif-sys', resourceType: null, resourceId: null },
        { actorUserId: null },
      ),
      { currentUserId: 'user-1' },
    );
    expect(toastDefault).toHaveBeenCalledTimes(1);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });
});
