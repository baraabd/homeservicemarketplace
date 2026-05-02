import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateAdminSettingsRequest } from '@homeservicemarketplace/contracts';

import { getAdminSettings, updateAdminSettings } from '../../../lib/admin/admin-settings-api';

const REFETCH_MS = 60_000;

export const adminSettingsQueryKeys = {
  root: ['admin', 'settings'] as const,
  bulk: () => ['admin', 'settings', 'bulk'] as const,
};

export function useAdminSettings() {
  return useQuery({
    queryKey: adminSettingsQueryKeys.bulk(),
    queryFn: getAdminSettings,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useUpdateAdminSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateAdminSettingsRequest) => updateAdminSettings(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminSettingsQueryKeys.root });
    },
  });
}
