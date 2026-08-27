import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type {
  ProviderPortfolioItem,
  ProviderPortfolioListResponse,
  UpdateProviderPortfolioItemRequest,
} from '@homeservicemarketplace/contracts';

import {
  createPortfolioItem,
  deletePortfolioItem,
  listPortfolio,
  reorderPortfolio,
  updatePortfolioItem,
} from '../../../lib/provider/provider-portfolio-api';

// Sprint 9B.10 — React Query bindings for the portfolio.
//
// One query key for the whole gallery, because the server returns the whole
// gallery on every call — including after a reorder or a delete, which both
// renumber positions. A per-item cache would have to merge those renumberings
// client-side, and merging is where two sources of truth start.

export const portfolioQueryKey = ['provider', 'portfolio'] as const;

/** The refusal code the server sent, if it sent one. Pulled out here so every
 *  call site maps a CODE to localised copy rather than rendering a server
 *  sentence, which would arrive in one language whatever the UI is set to. */
export function portfolioErrorCode(err: unknown): string | undefined {
  const body = (err as AxiosError<{ error?: { details?: { reason?: string } } }> | undefined)
    ?.response?.data;
  return body?.error?.details?.reason;
}

export function useProviderPortfolio() {
  return useQuery<ProviderPortfolioListResponse, AxiosError>({
    queryKey: portfolioQueryKey,
    queryFn: listPortfolio,
  });
}

export function useCreatePortfolioItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPortfolioItem,
    // Invalidate rather than patch the cache by hand: the response carries one
    // item, but a create also changes `remainingSlots`, and reconstructing
    // that on the client is a second copy of a rule the server owns.
    onSuccess: () => qc.invalidateQueries({ queryKey: portfolioQueryKey }),
  });
}

export function useUpdatePortfolioItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      input,
    }: {
      itemId: string;
      input: UpdateProviderPortfolioItemRequest;
    }): Promise<ProviderPortfolioItem> => updatePortfolioItem(itemId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: portfolioQueryKey }),
  });
}

export function useReorderPortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) => reorderPortfolio(itemIds),
    // The reorder response IS the new gallery, so it is written straight into
    // the cache. This is the one mutation where the server's answer is the
    // complete new state, and a refetch would only ask for what we hold.
    onSuccess: (data) => qc.setQueryData(portfolioQueryKey, data),
  });
}

export function useDeletePortfolioItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => deletePortfolioItem(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: portfolioQueryKey }),
  });
}
