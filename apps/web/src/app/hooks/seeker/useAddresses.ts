import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddressSummary,
  CreateAddressRequest,
  UpdateAddressRequest,
} from '@homeservicemarketplace/contracts';

import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} from '../../../lib/seeker/addresses-api';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';

// React Query hook for the authenticated user's saved addresses. The
// catalog itself is small and user-scoped so we keep `staleTime` short
// and rely on mutation-side invalidation to keep the list fresh.
export function useAddresses() {
  return useQuery<AddressSummary[]>({
    queryKey: seekerQueryKeys.addresses.list(),
    queryFn: listAddresses,
    staleTime: 30 * 1000,
  });
}

// All four mutations share the same invalidation: the address list is
// the only authoritative client-side cache, and after any write we want
// the next read to pick up server truth (default flag changes ripple
// across multiple rows).
function useAddressInvalidator() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: seekerQueryKeys.addresses.root });
}

export function useCreateAddress() {
  const invalidate = useAddressInvalidator();
  return useMutation<AddressSummary, Error, CreateAddressRequest>({
    mutationFn: createAddress,
    onSuccess: invalidate,
  });
}

export function useUpdateAddress() {
  const invalidate = useAddressInvalidator();
  return useMutation<AddressSummary, Error, { addressId: string; input: UpdateAddressRequest }>({
    mutationFn: ({ addressId, input }) => updateAddress(addressId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteAddress() {
  const invalidate = useAddressInvalidator();
  return useMutation<void, Error, string>({
    mutationFn: deleteAddress,
    onSuccess: invalidate,
  });
}

export function useSetDefaultAddress() {
  const invalidate = useAddressInvalidator();
  return useMutation<AddressSummary, Error, string>({
    mutationFn: setDefaultAddress,
    onSuccess: invalidate,
  });
}
