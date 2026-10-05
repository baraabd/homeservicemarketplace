import type {
  ConversationListResponse,
  CreateConversationRequest,
  CreateConversationResponse,
  MarkConversationReadRequest,
  MarkConversationReadResponse,
  MessageListResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrappers around the /v1/me/conversations endpoints. All
// requests carry credentials (api.ts sets `withCredentials: true`);
// mutations pick up the X-CSRF-Token header from the request
// interceptor; the 401-refresh interceptor handles transparent
// access-token refresh.

export async function listConversations(): Promise<ConversationListResponse> {
  const { data } = await api.get<ConversationListResponse>('/v1/me/conversations');
  return data;
}

export async function getOrCreateConversation(
  input: CreateConversationRequest,
): Promise<CreateConversationResponse> {
  const { data } = await api.post<CreateConversationResponse>('/v1/me/conversations', input);
  return data;
}

export async function listMessages(
  conversationId: string,
  query: { limit?: number; cursor?: string } = {},
): Promise<MessageListResponse> {
  const { data } = await api.get<MessageListResponse>(
    `/v1/me/conversations/${conversationId}/messages`,
    {
      params: {
        ...(query.limit ? { limit: query.limit } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
      },
    },
  );
  return data;
}

export async function sendMessage(
  conversationId: string,
  input: SendMessageRequest,
): Promise<SendMessageResponse> {
  const { data } = await api.post<SendMessageResponse>(
    `/v1/me/conversations/${conversationId}/messages`,
    input,
  );
  return data;
}

// R17 — `upToMessageId` is the newest message the reader was shown; the
// server reads up to that message's stored time, never further.
export async function markConversationRead(
  conversationId: string,
  upToMessageId: string,
): Promise<MarkConversationReadResponse> {
  const body: MarkConversationReadRequest = { upToMessageId };
  const { data } = await api.post<MarkConversationReadResponse>(
    `/v1/me/conversations/${conversationId}/read`,
    body,
  );
  return data;
}
