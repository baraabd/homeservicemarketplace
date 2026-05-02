import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../provider/query-keys';
import { seekerQueryKeys } from '../seeker/query-keys';
import {
  closeRealtimeSocket,
  openRealtimeSocket,
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
}

export function useRealtimeSocket({ enabled, getToken }: UseRealtimeSocketOptions): void {
  const qc = useQueryClient();
  // Stash the latest dispatcher so we don't tear down the socket
  // every render cycle just because the closure identity changed.
  const dispatchRef = useRef<(event: RealtimeEvent) => void>(() => {});
  dispatchRef.current = (event) => dispatchInvalidations(qc, event);

  useEffect(() => {
    if (!enabled) {
      closeRealtimeSocket();
      return undefined;
    }
    openRealtimeSocket({
      getToken,
      onEvent: (event) => dispatchRef.current(event),
    });
    return () => {
      closeRealtimeSocket();
    };
    // getToken is expected to be a stable reference (a function that
    // reads from a closure, not one allocated per render). The hook
    // otherwise restarts the socket on every render which would lose
    // every event between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

// Pure function exported for the unit test — given an event, fire
// the right invalidations against a given QueryClient. Tests can
// drive this directly instead of standing up a real socket.
export function dispatchInvalidations(qc: QueryClient, event: RealtimeEvent): void {
  switch (event.type) {
    case 'notification.created':
      qc.invalidateQueries({ queryKey: seekerQueryKeys.notifications.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.notifications.root });
      break;
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
      break;
    case 'booking.status_changed':
      qc.invalidateQueries({ queryKey: seekerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.wallet.root });
      break;
    case 'provider.status_changed':
      qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      break;
    default: {
      // Forward-compat: an unknown event MUST NOT crash the bridge.
      // Drop it on the floor — polling will still close the gap.
      const _exhaustive: string = event.type;
      void _exhaustive;
    }
  }
}
