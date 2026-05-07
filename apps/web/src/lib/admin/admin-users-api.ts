import type {
  AdminUserMutationResponse,
  AdminUserSummary,
  ListAdminRolesResponse,
  ListAdminUsersQuery,
  ListAdminUsersResponse,
  UpdateUserStatusRequest,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Admin user control API client (Sprint 6.1). Targets:
//   GET   /v1/admin/users
//   GET   /v1/admin/users/:userId
//   PATCH /v1/admin/users/:userId/status
//   GET   /v1/admin/roles
//
// All admin requests pass through axios with `withCredentials` so
// cookie-mode auth keeps working in the browser; the wire shape is
// the same as mobile-mode bearer auth (the backend folds CSRF).

export async function listAdminUsers(
  query: ListAdminUsersQuery = {},
): Promise<ListAdminUsersResponse> {
  const params: Record<string, string | number> = {};
  // Sprint 6.1 prefers `query` on the wire; fall back to `q` for
  // any caller still using the legacy alias.
  if (query.query) params.query = query.query;
  if (query.q && !query.query) params.q = query.q;
  if (query.status) params.status = query.status;
  if (query.role) params.role = query.role;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListAdminUsersResponse>('/v1/admin/users', { params });
  return data;
}

export async function getAdminUser(userId: string): Promise<AdminUserSummary> {
  const { data } = await api.get<AdminUserSummary>(`/v1/admin/users/${userId}`);
  return data;
}

export async function updateAdminUserStatus(
  userId: string,
  body: UpdateUserStatusRequest,
): Promise<AdminUserMutationResponse> {
  const { data } = await api.patch<AdminUserMutationResponse>(
    `/v1/admin/users/${userId}/status`,
    body,
  );
  return data;
}

export async function listAdminRoles(): Promise<ListAdminRolesResponse> {
  const { data } = await api.get<ListAdminRolesResponse>('/v1/admin/roles');
  return data;
}
