import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListAdminUsersQuery,
  UpdateUserStatusRequest,
} from '@homeservicemarketplace/contracts';

import {
  getAdminUser,
  listAdminRoles,
  listAdminUsers,
  updateAdminUserStatus,
} from '../../../lib/admin/admin-users-api';

// Admin user control hooks (Sprint 6.1).
//
// Polling is intentionally slower than provider-side surfaces — the
// admin doesn't need second-level freshness on a user list, and a
// faster cadence would burn through API rate budgets when several
// admins use the dashboard simultaneously.
const LIST_REFETCH_MS = 60_000;
const ROLES_REFETCH_MS = 5 * 60_000; // five minutes; role table is near-static

export const adminUsersQueryKeys = {
  root: ['admin', 'users'] as const,
  list: (filters: ListAdminUsersQuery) => ['admin', 'users', 'list', filters] as const,
  detail: (userId: string) => ['admin', 'users', 'detail', userId] as const,
  roles: () => ['admin', 'roles'] as const,
};

export function useAdminUsers(filters: ListAdminUsersQuery = {}) {
  return useQuery({
    queryKey: adminUsersQueryKeys.list(filters),
    queryFn: () => listAdminUsers(filters),
    refetchInterval: LIST_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useAdminUserDetail(userId: string | null | undefined) {
  return useQuery({
    queryKey: adminUsersQueryKeys.detail(userId ?? ''),
    queryFn: () => getAdminUser(userId!),
    enabled: Boolean(userId),
    staleTime: 5_000,
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: adminUsersQueryKeys.roles(),
    queryFn: listAdminRoles,
    refetchInterval: ROLES_REFETCH_MS,
    staleTime: ROLES_REFETCH_MS,
  });
}

export function useUpdateAdminUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: UpdateUserStatusRequest }) =>
      updateAdminUserStatus(userId, body),
    onSuccess: (_data, vars) => {
      // The list view + the detail drawer for THIS user both need to
      // refresh; invalidating the root catches every cached filter
      // permutation in one call.
      qc.invalidateQueries({ queryKey: adminUsersQueryKeys.root });
      qc.invalidateQueries({ queryKey: adminUsersQueryKeys.detail(vars.userId) });
    },
  });
}
