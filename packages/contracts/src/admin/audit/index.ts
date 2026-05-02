// Admin audit log read (Sprint 6.6).
//
//   GET /v1/admin/audit?type&userId&limit&cursor — cursor-paginated
//                                                   read of AuditEvent
//
// Read-only — no write paths here. Mutations are written by the
// service layer of the admin sprints (6.1, 6.2, 6.3, 6.5).
export interface ListAuditEventsQuery {
  type?: string;
  userId?: string;
  limit?: number;
  cursor?: string;
}

export interface AdminAuditEvent {
  id: string;
  userId: string | null;
  type: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface ListAuditEventsResponse {
  items: AdminAuditEvent[];
  nextCursor: string | null;
}
