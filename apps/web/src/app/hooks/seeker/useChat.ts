import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConversationListResponse,
  CreateConversationResponse,
  MarkConversationReadResponse,
  MessageListResponse,
  SendMessageResponse,
} from '@homeservicemarketplace/contracts';

import {
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from '../../../lib/seeker/chat-api';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';

// React Query hook for the conversations list. 30s stale matches the
// requests / bookings feeds — the messages tab is inspected often
// enough that we want sub-minute freshness, but not so often that we
// poll on every render.
export function useConversations() {
  return useQuery<ConversationListResponse>({
    queryKey: seekerQueryKeys.conversations.list(),
    queryFn: () => listConversations(),
    staleTime: 30 * 1000,
  });
}

// R12 — while the conversation is on screen (`live`), it is read again every
// 4 s, the cadence the provider thread already uses, so a reply appears
// without reopening the chat. It stops when the chat is closed or hidden, when
// the conversation is gone, and after an error such as lost access (the read
// is then not repeated until the person reopens it). No socket is involved.
const LIVE_MESSAGES_REFETCH_MS = 4_000;

export function useMessages(
  conversationId: string | null | undefined,
  options: { live?: boolean } = {},
) {
  return useQuery<MessageListResponse>({
    refetchInterval: (query) =>
      options.live && query.state.status !== 'error' ? LIVE_MESSAGES_REFETCH_MS : false,
    refetchIntervalInBackground: false,
    queryKey: conversationId
      ? seekerQueryKeys.conversations.messages(conversationId)
      : seekerQueryKeys.conversations.root,
    queryFn: () => listMessages(conversationId as string),
    enabled: typeof conversationId === 'string' && conversationId.length > 0,
    // Shorter stale time on messages so re-opening a conversation
    // picks up anything sent since last view.
    staleTime: 10 * 1000,
  });
}

// get-or-create. Idempotent server-side, so this is safe to call on
// every "open chat with this provider" tap.
export function useGetOrCreateConversation() {
  const qc = useQueryClient();
  return useMutation<CreateConversationResponse, Error, { bookingId: string }>({
    mutationFn: (input) => getOrCreateConversation(input),
    onSuccess: () => {
      // The new conversation joins the list; invalidate the list root
      // so the messages tab picks it up.
      qc.invalidateQueries({ queryKey: seekerQueryKeys.conversations.list() });
    },
  });
}

// Send a message. On success, invalidate the messages list (so the
// chat scrollback re-renders with the persisted message) AND the
// conversations list (so the conversation moves to the top with the
// new lastMessage preview).
//
// We rely on the server-issued message id + createdAt for the final
// row; the optimistic-pending state in the ChatScreen is reconciled
// against the response.
export function useSendMessage(conversationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<SendMessageResponse, Error, { body: string; idempotencyKey: string }>({
    mutationFn: (input) => {
      if (!conversationId)
        throw new Error('useSendMessage: conversationId is required to send a message.');
      return sendMessage(conversationId, input);
    },
    onSuccess: (data) => {
      if (!conversationId) return;
      // R12 — the acknowledged message is the server's row; put it in place by
      // its id (a replayed send returns the row already there).
      qc.setQueryData<MessageListResponse>(
        seekerQueryKeys.conversations.messages(conversationId),
        (current) =>
          current && !current.items.some((m) => m.id === data.message.id)
            ? { ...current, items: [...current.items, data.message] }
            : current,
      );
      qc.invalidateQueries({ queryKey: seekerQueryKeys.conversations.messages(conversationId) });
      qc.invalidateQueries({ queryKey: seekerQueryKeys.conversations.list() });
    },
  });
}

// Mark-read. On success, invalidate the conversations list so the
// unread badge clears.
export function useMarkConversationRead(conversationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<MarkConversationReadResponse, Error, string>({
    mutationFn: (upToMessageId) => {
      if (!conversationId) throw new Error('useMarkConversationRead: conversationId is required.');
      return markConversationRead(conversationId, upToMessageId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: seekerQueryKeys.conversations.list() });
    },
  });
}
