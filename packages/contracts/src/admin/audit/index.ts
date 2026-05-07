// Admin audit log read.
//
//   GET /v1/admin/audit?type&userId&limit&cursor      — legacy (kept callable)
//   GET /v1/admin/audit-logs?actor&action&limit&cursor — Sprint 6.6 canonical
//
// Read-only — no write paths here. Mutations are written by the
// service layer of the admin sprints (6.1, 6.2, 6.3, 6.5).
//
// Sensitive keys in `metadata.previousValue` / `metadata.newValue`
// (passwordHash, JWT_SECRET, DATABASE_URL, refreshToken, STRIPE_SECRET)
// are redacted server-side to "<redacted>" before they leave the API.

// ─── Legacy surface ─────────────────────────────────────────────

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

// ─── Sprint 6.6 canonical surface ───────────────────────────────

// Wire field names per the Sprint 6.6 spec: `actor` (admin user id)
// and `action` (audit type) instead of `userId` / `type`. The data
// is the same — just renamed for the admin lens.
export interface ListAdminAuditLogsQuery {
  actor?: string;
  action?: string;
  limit?: number;
  cursor?: string;
}

export interface AdminAuditLog {
  id: string;
  actor: string | null;
  action: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface ListAdminAuditLogsResponse {
  items: AdminAuditLog[];
  nextCursor: string | null;
}
