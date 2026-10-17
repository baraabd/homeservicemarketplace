import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { MeResponse, RealtimeEvent } from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../provider/query-keys';
import { seekerQueryKeys } from '../seeker/query-keys';
import { authRequestScope, isLocallySignedOut } from '../auth-session-boundary';
import { dispatchRealtimeSideEffects } from './side-effects';
import { notificationFingerprint } from './notification-baseline';
import {
  closeRealtimeSocket,
  openRealtimeSocket,
  subscribeToConversation,
  type OpenRealtimeSocketOptions,
} from './socket-client';

// Sprint 7.0 (refined) — connect a Socket.IO client when authenticated
// and translate every `realtime.event` into the right React Query
// invalidation. Polling cadences (Sprint 5.5: 15s/20s/4s) stay in
// place; realtime is purely additive — when the socket is offline,
// polling alone keeps the UI converging.
//
// The hook listens for the SAME event taxonomy the gateway emits and
// invalidates BOTH seeker and provider query roots (the user can be
// either / both — invalidating an unused root is a cheap no-op).

interface UseRealtimeSocketOptions {
  // Pass `true` to connect; `false` to disconnect. Typically driven
  // by `useAuth().isAuthenticated`.
  enabled: boolean;
  // Resolves to the current access token at handshake time. The
  // socket-client re-evaluates this on every reconnect so a token
  // rotation surfaces seamlessly.
  getToken: OpenRealtimeSocketOptions['getToken'];
  // The current authenticated identity fences socket callbacks, recovery
  // flights and cross-tab hints, as well as suppressing actor feedback.
  // No connection is opened until this identity has been loaded.
  currentUserId?: string | null;
}

export function useRealtimeSocket({
  enabled,
  getToken,
  currentUserId,
}: UseRealtimeSocketOptions): void {
  const qc = useQueryClient();
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;

  useEffect(() => {
    if (!enabled || !currentUserId) {
      closeRealtimeSocket();
      return undefined;
    }
    let active = true;
    let connected = false;
    let failures = 0;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let recoveryDueAt = Infinity;
    let recoveryRequested = false;
    let recoveryFlight: Promise<boolean> | null = null;
    let lastRecoveryAt = 0;
    const replayWindow = createRealtimeEventWindow();
    let socket: ReturnType<typeof openRealtimeSocket> | null = null;
    const subscribedConversations = new Set<string>();
    let socketGeneration = 0;
    let subscribingGeneration = -1;
    const scope = authRequestScope();
    const isCurrent = () =>
      active &&
      !isLocallySignedOut() &&
      authRequestScope() === scope &&
      qc.getQueryData<MeResponse | null>(['auth', 'me'])?.id === currentUserId;

    // Both the initial handshake and every reconnect are a possible gap.
    // Classic Redis Pub/Sub does not retain missed messages. We invalidate
    // existing caches and ask the same authorized REST queries used by UI.
    const recover = (): Promise<boolean> => {
      if (recoveryFlight) return recoveryFlight;
      if (!isCurrent()) return Promise.resolve(false);
      recoveryFlight = resyncAuthoritativeState(qc, currentUserId, isCurrent)
        .then((ok) => {
          failures = ok ? 0 : Math.min(failures + 1, 3);
          lastRecoveryAt = Date.now();
          return ok;
        })
        .finally(() => {
          recoveryFlight = null;
        });
      return recoveryFlight;
    };
    const scheduleRecovery = (delay: number) => {
      if (!active) return;
      const dueAt = Date.now() + delay;
      if (recoveryTimer !== undefined && recoveryDueAt <= dueAt) return;
      clearTimeout(recoveryTimer);
      recoveryDueAt = dueAt;
      recoveryTimer = setTimeout(async () => {
        recoveryTimer = undefined;
        recoveryDueAt = Infinity;
        if (!active) return;
        const canRead = document.visibilityState !== 'hidden' && navigator.onLine !== false;
        if (canRead) {
          // A hint received during a read may describe a later commit. Keep
          // it pending until one subsequent authoritative read completes.
          if (recoveryFlight) await recoveryFlight;
          else {
            recoveryRequested = false;
            await recover();
          }
        }
        if (active)
          scheduleRecovery(
            canRead && recoveryRequested
              ? Math.max(100, 1_000 - (Date.now() - lastRecoveryAt))
              : recoveryDelayMs(connected, failures),
          );
      }, delay);
    };
    const requestRecovery = () => {
      if (!isCurrent()) return;
      recoveryRequested = true;
      // Coalesce bursts without dropping the trailing hint or indefinitely
      // postponing a queued read when more hints arrive.
      scheduleRecovery(Math.max(100, 1_000 - (Date.now() - lastRecoveryAt)));
    };
    const scheduleRetry = () => {
      if (!socket || retryTimer || !active) return;
      retryTimer = setTimeout(async () => {
        retryTimer = undefined;
        if (!active || !socket || connected) return;
        // /auth/me may refresh an expired cookie. Never reconnect a stale
        // account merely because a transport retry timer fired.
        const ok = navigator.onLine !== false && (await recover());
        if (ok && isCurrent()) socket.connect();
        else if (active) scheduleRetry();
      }, reconnectDelayMs(retryAttempt++));
    };
    const subscribeActiveConversations = async () => {
      if (!connected || !isCurrent() || subscribingGeneration === socketGeneration) return;
      const generation = socketGeneration;
      subscribingGeneration = generation;
      try {
        while (connected && isCurrent() && generation === socketGeneration) {
          const id = qc
            .getQueryCache()
            .getAll()
            .filter((query) => query.isActive())
            .map((query) => activeConversationId(query.queryKey))
            .find((candidate) => candidate && !subscribedConversations.has(candidate));
          if (!id) return;
          // The existing protocol has no leave-conversation command. Recycling
          // this read-only connection bounds retained rooms after navigation.
          if (subscribedConversations.size >= 16) {
            socket?.disconnect();
            return;
          }
          subscribedConversations.add(id);
          // Serialize acks: the gateway permits one membership check in flight.
          const ack = await subscribeToConversation(id);
          if (!ack.ok && isCurrent()) requestRecovery();
        }
      } catch {
        if (isCurrent()) requestRecovery();
      } finally {
        if (subscribingGeneration === generation) subscribingGeneration = -1;
      }
    };
    socket =
      import.meta.env.VITE_REALTIME_SOCKET_IO === 'true'
        ? openRealtimeSocket({
            getToken: () => tokenRef.current(),
            onConnect: () => {
              if (!isCurrent()) {
                closeRealtimeSocket();
                return;
              }
            },
            onReady: (ack) => {
              if (!isCurrent() || ack.userId !== currentUserId) {
                closeRealtimeSocket();
                requestRecovery();
                return;
              }
              connected = true;
              socketGeneration += 1;
              retryAttempt = 0;
              clearTimeout(retryTimer);
              retryTimer = undefined;
              subscribedConversations.clear();
              void subscribeActiveConversations();
              requestRecovery();
            },
            onDisconnect: () => {
              connected = false;
              socketGeneration += 1;
              subscribedConversations.clear();
              requestRecovery();
              scheduleRetry();
            },
            onConnectError: () => {
              connected = false;
              requestRecovery();
              scheduleRetry();
            },
            onEvent: (raw) => {
              if (!isCurrent()) return;
              const event = validateRealtimeEvent(raw, currentUserId);
              if (!event) {
                requestRecovery();
                return;
              }
              const disposition = replayWindow.observe(event);
              if (disposition === 'duplicate') return;
              dispatchInvalidations(qc, event);
              if (disposition === 'resync' || disposition === 'stale') requestRecovery();
              if (disposition !== 'stale') {
                dispatchRealtimeSideEffects(event, {
                  currentUserId,
                  coordinateTabs: true,
                  isCurrent,
                });
              }
            },
          })
        : null;

    // A hint contains no cached data, session claims or private event payload.
    // Successful mutations (including read-all/read-position) ask sibling
    // tabs to reread their own authorized resources. Refetches never echo it.
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(`hsm:realtime:v1:${notificationFingerprint(currentUserId)}`);
      }
    } catch {
      /* Polling still converges when cross-tab messaging is denied. */
    }
    if (channel)
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === 'resync' && isCurrent()) requestRecovery();
      };
    let lastHintAt = 0;
    const unsubscribe = qc.getMutationCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        isCurrent() &&
        Date.now() - lastHintAt >= 500
      ) {
        lastHintAt = Date.now();
        try {
          channel?.postMessage('resync');
        } catch {
          /* Non-authoritative hint. */
        }
      }
    });
    const unsubscribeQueries = qc.getQueryCache().subscribe((event) => {
      if (event.type === 'observerAdded') void subscribeActiveConversations();
    });
    const onResume = () => {
      if (document.visibilityState === 'hidden') return;
      requestRecovery();
      if (!connected) scheduleRetry();
    };
    globalThis.window.addEventListener('online', onResume);
    globalThis.window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    // A periodic safety read also covers undetectable Pub/Sub gaps and
    // server capability changes while the socket appears healthy.
    scheduleRecovery(recoveryDelayMs(false, 0));
    return () => {
      active = false;
      clearTimeout(retryTimer);
      clearTimeout(recoveryTimer);
      channel?.close();
      unsubscribe();
      unsubscribeQueries();
      globalThis.window.removeEventListener('online', onResume);
      globalThis.window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
      closeRealtimeSocket();
    };
  }, [enabled, currentUserId, qc]);
}

export function activeConversationId(key: readonly unknown[]): string | null {
  const id =
    key[0] === 'seeker' && key[1] === 'conversations' && key[3] === 'messages'
      ? key[2]
      : key[0] === 'provider' && key[1] === 'chat' && key[2] === 'messages'
        ? key[3]
        : null;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export function reconnectDelayMs(attempt: number, random = Math.random()): number {
  return Math.round(Math.min(2_000 * 2 ** Math.min(attempt, 5), 60_000) * (0.8 + random * 0.2));
}

export function recoveryDelayMs(connected: boolean, failures: number): number {
  return Math.min((connected ? 60_000 : 20_000) * 2 ** Math.min(failures, 2), 60_000);
}

const isPrivateQuery = (query: { queryKey: readonly unknown[] }) =>
  ['seeker', 'provider', 'admin'].includes(String(query.queryKey[0]));

export async function resyncAuthoritativeState(
  qc: QueryClient,
  userId: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (!isCurrent()) return false;
  try {
    await qc.invalidateQueries({ predicate: isPrivateQuery, refetchType: 'none' });
    await qc.refetchQueries(
      { queryKey: ['auth', 'me'], exact: true, type: 'active' },
      { cancelRefetch: false, throwOnError: true },
    );
    if (!isCurrent() || qc.getQueryData<MeResponse | null>(['auth', 'me'])?.id !== userId)
      return false;
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    // Revocation/suspension is not a network outage. Reuse the existing auth
    // boundary's purge, including cancellation of in-flight private reads.
    if (isCurrent() && (status === 401 || status === 403)) {
      globalThis.window.dispatchEvent(new Event('auth:session-expired'));
    }
    return false;
  }
  try {
    await qc.refetchQueries(
      { predicate: isPrivateQuery, type: 'active' },
      { cancelRefetch: false, throwOnError: true },
    );
    return isCurrent();
  } catch {
    if (!isCurrent()) return false;
    // A forbidden resource is not proof that the whole identity is revoked.
    // Remove denied stale resource data; the refreshed server capabilities
    // and existing route guards decide what the account can still access.
    for (const query of qc.getQueryCache().findAll({ predicate: isPrivateQuery })) {
      const status = (query.state.error as { response?: { status?: number } } | null)?.response
        ?.status;
      if (status === 401 || status === 403 || status === 404) {
        qc.removeQueries({ queryKey: query.queryKey, exact: true });
      }
    }
    return false;
  }
}

interface RecoveryEvent extends RealtimeEvent {
  eventId?: string;
  revision?: number;
}

export function validateRealtimeEvent(value: unknown, userId: string): RecoveryEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<RecoveryEvent>;
  if (
    event.v !== 1 ||
    typeof event.type !== 'string' ||
    event.type.length > 64 ||
    (event.userId !== null && event.userId !== userId) ||
    typeof event.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(event.occurredAt)) ||
    !event.payload ||
    typeof event.payload !== 'object' ||
    Array.isArray(event.payload)
  )
    return null;
  if (
    event.eventId !== undefined &&
    (typeof event.eventId !== 'string' || event.eventId.length < 1 || event.eventId.length > 256)
  )
    return null;
  if (event.revision !== undefined && (!Number.isSafeInteger(event.revision) || event.revision < 0))
    return null;
  try {
    if (JSON.stringify(event).length > 64 * 1024) return null;
  } catch {
    return null;
  }
  return event as RecoveryEvent;
}

/** Bounded cursor window; its values never patch durable client state. */
export function createRealtimeEventWindow(capacity = 200) {
  const seen = new Set<string>();
  const revisions = new Map<string, number>();
  const limit = Math.max(1, Math.min(capacity, 200));
  return {
    observe(event: RecoveryEvent): 'fresh' | 'duplicate' | 'stale' | 'resync' {
      const payload = event.payload as Record<string, unknown>;
      const immutableId =
        event.type.endsWith('.created') && typeof payload.id === 'string' ? payload.id : undefined;
      const eventId = event.eventId ?? (immutableId ? `${event.type}:${immutableId}` : undefined);
      if (eventId && seen.has(eventId)) return 'duplicate';
      let overflow = false;
      if (eventId) {
        seen.add(eventId);
        if (seen.size > limit) {
          seen.delete(seen.values().next().value!);
          overflow = true;
        }
      }
      // Each created record is distinct even at the same/older timestamp.
      // Only state transitions share a revision slot; REST owns ordering.
      const resourceId =
        payload.bookingId ?? payload.providerId ?? payload.resourceId ?? payload.id;
      if (
        event.type.endsWith('status_changed') &&
        typeof resourceId === 'string' &&
        typeof event.revision === 'number'
      ) {
        const key = `${event.type}:${resourceId}`;
        const previous = revisions.get(key);
        if (previous !== undefined && event.revision < previous) return 'stale';
        revisions.set(key, event.revision);
        if (revisions.size > limit) {
          revisions.delete(revisions.keys().next().value!);
          overflow = true;
        }
      }
      return !eventId || overflow ? 'resync' : 'fresh';
    },
    size: () => ({ events: seen.size, revisions: revisions.size }),
  };
}

// Pure function exported for the unit test — given an event, fire
// the right invalidations against a given QueryClient. Tests can
// drive this directly instead of standing up a real socket.
// Sprint 7.x — Active Leads sync. The Seeker's "Active Leads"
// carousel is backed by `seekerQueryKeys.requests.root`. Booking
// lifecycle events (start / complete / cancel / created) all need
// to invalidate that root so the lead-card status display stays in
// sync with the underlying booking — even when the parent
// ServiceRequest row keeps its `BID_ACCEPTED` status. The cost of
// one extra refetch per transition is negligible vs. the UX bug
// where the card visibly lies until the user reloads.
export function dispatchInvalidations(qc: QueryClient, event: RealtimeEvent): void {
  switch (event.type) {
    case 'notification.created': {
      // Always-on: refresh the drawer + unread badge.
      qc.invalidateQueries({ queryKey: seekerQueryKeys.notifications.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.notifications.root });
      qc.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      // R17-E — verification and account notices announce authority changes;
      // re-asking costs one GET and only runs while a workspace observes it.
      qc.invalidateQueries({ queryKey: providerQueryKeys.capabilities.get() });
      // Sprint 7.x universal domain safety net — if the backend
      // forgets to publish a paired domain event, the notification's
      // resourceType still drives the right domain invalidation so
      // Active Leads / Bookings / Bids feeds converge.
      invalidateForNotificationResource(qc, event.payload);
      break;
    }
    case 'message.created': {
      // Payload may carry a conversationId; if it does, target only
      // that conversation's messages slot. Otherwise invalidate the
      // entire chat root on both sides.
      const conversationId = (event.payload as { conversationId?: string })?.conversationId;
      if (conversationId) {
        qc.invalidateQueries({ queryKey: seekerQueryKeys.conversations.messages(conversationId) });
        qc.invalidateQueries({ queryKey: providerQueryKeys.chat.messages(conversationId) });
      }
      qc.invalidateQueries({ queryKey: seekerQueryKeys.conversations.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.chat.root });
      break;
    }
    case 'request.available':
      qc.invalidateQueries({ queryKey: providerQueryKeys.availableRequests.root });
      break;
    case 'bid.created':
    case 'bid.status_changed':
      // Seeker side: bids are nested under requests — invalidate the
      // requests root so both list and detail re-fetch.
      qc.invalidateQueries({ queryKey: seekerQueryKeys.requests.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
      break;
    case 'bid.accepted':
      qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: seekerQueryKeys.bookings.root });
      // Sprint 7.x — Active Leads sync. The accepted-bid transition
      // flips the parent request from OPEN_FOR_BIDS → BID_ACCEPTED;
      // the lead card must refresh to show "active" instead of
      // "pending".
      qc.invalidateQueries({ queryKey: seekerQueryKeys.requests.root });
      break;
    case 'booking.created':
      // Sprint 7.5 publishes booking.created alongside bid.accepted on
      // a successful accept-bid. Invalidate both sides' bookings roots
      // so the new row appears without a manual refetch.
      qc.invalidateQueries({ queryKey: seekerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      // Sprint 7.x — Active Leads sync (same reason as bid.accepted).
      qc.invalidateQueries({ queryKey: seekerQueryKeys.requests.root });
      break;
    case 'booking.status_changed':
      qc.invalidateQueries({ queryKey: seekerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.wallet.root });
      // Sprint 7.x — Active Leads sync. The parent ServiceRequest
      // intentionally stays at BID_ACCEPTED across booking
      // transitions (no auto-revert; see useBookings.ts comments),
      // but the seeker's Active Leads carousel still needs a
      // refetch so derived UI (e.g. bidsCount, lifecycle-driven
      // copy) stays current.
      qc.invalidateQueries({ queryKey: seekerQueryKeys.requests.root });
      break;
    case 'provider.status_changed':
      qc.invalidateQueries({ queryKey: ['admin', 'providers'] });
      qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      // R17-E — a status change is an authority change. The workspace renders
      // what the capability decision allows, so that is what must refetch.
      qc.invalidateQueries({ queryKey: providerQueryKeys.capabilities.get() });
      break;
    default: {
      // Forward-compat: an unknown event MUST NOT crash the bridge.
      // Drop it on the floor — polling will still close the gap.
      const _exhaustive: string = event.type;
      void _exhaustive;
    }
  }
}

// Sprint 7.x — universal safety net. Reads the
// NotificationSummary-shaped payload and invalidates the domain
// query roots that match its resourceType. This means even if the
// backend publishes ONLY `notification.created` (and forgets the
// paired domain event), the Seeker's Active Leads still refreshes
// when a relevant notification lands.
//
// Mapping:
//   REQUEST  → seeker requests root + provider available-requests root
//   BID      → seeker requests root (bids are nested under requests)
//              + provider bids root
//   BOOKING  → seeker bookings + provider bookings + seeker requests
//              (Active Leads card status follows the booking
//              lifecycle even when ServiceRequest.status doesn't
//              change)
//   CONVERSATION → conversations root on both sides
//   SYSTEM / null → notifications root only (handled by the caller)
function invalidateForNotificationResource(qc: QueryClient, payload: unknown): void {
  const p = payload as { resourceType?: string | null } | null | undefined;
  switch (p?.resourceType ?? null) {
    case 'REQUEST':
      qc.invalidateQueries({ queryKey: seekerQueryKeys.requests.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.availableRequests.root });
      break;
    case 'BID':
      qc.invalidateQueries({ queryKey: seekerQueryKeys.requests.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
      break;
    case 'BOOKING':
      qc.invalidateQueries({ queryKey: seekerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: seekerQueryKeys.requests.root });
      break;
    case 'CONVERSATION':
      qc.invalidateQueries({ queryKey: seekerQueryKeys.conversations.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.chat.root });
      break;
    default:
      // SYSTEM / null / unknown — no domain refetch needed; the
      // notifications root + unread count cover the visible state.
      break;
  }
}
