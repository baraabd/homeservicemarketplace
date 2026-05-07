import type {
  ConversationListResponse,
  CreateConversationRequest,
  CreateConversationResponse,
  MarkConversationReadResponse,
  MessageListResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 5.5 — provider-side wrappers around the canonical
// /v1/provider/conversations chat endpoints. The server-side
// participant gate scopes every call to conversations the calling
// provider is in; foreign ids surface as 404.

export async function listProviderConversations(): Promise<ConversationListResponse> {
  const { data } = await api.get<ConversationListResponse>('/v1/provider/conversations');
  return data;
}

export async function getOrCreateProviderConversation(
  input: CreateConversationRequest,
): Promise<CreateConversationResponse> {
  const { data } = await api.post<CreateConversationResponse>('/v1/provider/conversations', input);
  return data;
}

export async function listProviderMessages(
  conversationId: string,
  query: { limit?: number; cursor?: string } = {},
): Promise<MessageListResponse> {
  const { data } = await api.get<MessageListResponse>(
    `/v1/provider/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      params: {
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
      },
    },
  );
  return data;
}

export async function sendProviderMessage(
  conversationId: string,
  input: SendMessageRequest,
): Promise<SendMessageResponse> {
  const { data } = await api.post<SendMessageResponse>(
    `/v1/provider/conversations/${encodeURIComponent(conversationId)}/messages`,
    input,
  );
  return data;
}

export async function markProviderConversationRead(
  conversationId: string,
): Promise<MarkConversationReadResponse> {
  const { data } = await api.post<MarkConversationReadResponse>(
    `/v1/provider/conversations/${encodeURIComponent(conversationId)}/read`,
  );
  return data;
}
