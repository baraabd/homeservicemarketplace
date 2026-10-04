export type SupportTicketStatus = 'OPEN' | 'CLOSED';
export type SupportMessageAuthorRole = 'REQUESTER' | 'SUPPORT';

export interface SupportMessageView {
  id: string;
  authorRole: SupportMessageAuthorRole;
  body: string;
  createdAt: string;
}

export interface SupportTicketSummaryView {
  id: string;
  subject: string;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  lastMessageAt: string | null;
}

export interface SupportTicketDetailView extends SupportTicketSummaryView {
  messages: SupportMessageView[];
}

export interface AdminSupportTicketSummaryView extends SupportTicketSummaryView {
  requester: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

export interface AdminSupportTicketDetailView extends SupportTicketDetailView {
  requester: AdminSupportTicketSummaryView['requester'];
}

export interface CreateSupportTicketRequest {
  subject: string;
  message: string;
  idempotencyKey: string;
}

export interface CreateSupportTicketResponse {
  ticket: SupportTicketDetailView;
  replayed: boolean;
}

export interface SendSupportMessageRequest {
  body: string;
  idempotencyKey: string;
}

export interface SendSupportMessageResponse {
  message: SupportMessageView;
  replayed: boolean;
}

export interface ListSupportTicketsResponse {
  items: SupportTicketSummaryView[];
  nextCursor: string | null;
}

export interface ListAdminSupportTicketsResponse {
  items: AdminSupportTicketSummaryView[];
  nextCursor: string | null;
}
