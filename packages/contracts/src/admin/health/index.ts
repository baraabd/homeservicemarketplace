// GET /v1/admin/health — admin-role-gated ping. Returns the calling
// admin's id + a server-side timestamp. Useful for the runtime harness
// to confirm a) the admin module is mounted and b) the role guard
// admits the seeded admin account.
export interface AdminHealthResponse {
  ok: true;
  adminUserId: string;
  serverTime: string;
}
