import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SendMessageRequest } from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import {
  listProviderConversations,
  listProviderMessages,
  markProviderConversationRead,
  sendProviderMessage,
} from '../../../lib/provider/provider-chat-api';

// Sprint 5.5 — provider chat hooks.
//
// Cadences per the sprint spec:
//   conversations list: 20 s
//   open conversation messages: 4 s (the spec asks for 3–5 s)
//
// Send-message mutation invalidates the messages(id) slot AND the
// conversations list so the latest-message preview line updates
// in one round-trip.

const CONVERSATIONS_REFETCH_MS = 20_000;
const MESSAGES_REFETCH_MS = 4_000;

export function useProviderConversations() {
  return useQuery({
    queryKey: providerQueryKeys.chat.conversations(),
    queryFn: listProviderConversations,
    refetchInterval: CONVERSATIONS_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function useProviderMessages(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: providerQueryKeys.chat.messages(conversationId ?? ''),
    queryFn: () => listProviderMessages(conversationId!),
    enabled: Boolean(conversationId),
    refetchInterval: MESSAGES_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 1_000,
  });
}

export function useSendProviderMessage(conversationId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendMessageRequest) => sendProviderMessage(conversationId!, input),
    onSuccess: () => {
      if (!conversationId) return;
      qc.invalidateQueries({ queryKey: providerQueryKeys.chat.messages(conversationId) });
      qc.invalidateQueries({ queryKey: providerQueryKeys.chat.conversations() });
    },
  });
}

export function useMarkProviderConversationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => markProviderConversationRead(conversationId),
    onSuccess: (_data, conversationId) => {
      qc.invalidateQueries({ queryKey: providerQueryKeys.chat.conversations() });
      qc.invalidateQueries({ queryKey: providerQueryKeys.chat.messages(conversationId) });
    },
  });
}
