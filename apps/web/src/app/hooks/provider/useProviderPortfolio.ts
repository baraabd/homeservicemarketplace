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
  fetchPublicProfilePreview,
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

/** Sprint 9B.22 — a mutation changes BOTH the gallery and what a customer
 *  would see. Invalidating only the gallery leaves the preview beside it
 *  showing the previous answer, which is worse than showing none.
 *
 *  The preview key is invalidated by PREFIX so both languages refresh: a
 *  provider who switches language after publishing must not be shown a
 *  cached preview from before it. */
function invalidateGalleryAndPreview(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: portfolioQueryKey });
  void qc.invalidateQueries({ queryKey: ['provider', 'public-profile', 'preview'] });
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
    onSuccess: () => invalidateGalleryAndPreview(qc),
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
    onSuccess: () => invalidateGalleryAndPreview(qc),
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
    onSuccess: () => invalidateGalleryAndPreview(qc),
  });
}

// ─── Sprint 9B.22 ────────────────────────────────────────────────────────────

export const publicProfilePreviewKey = (lang: 'en' | 'ar') =>
  ['provider', 'public-profile', 'preview', lang] as const;

/**
 * What a customer would see.
 *
 * Keyed by language because the projection localises specialty labels — two
 * languages are two different public profiles, and sharing one cache entry
 * would show whichever was fetched first.
 *
 * Invalidated by every portfolio mutation below: publishing, editing or
 * deleting an image changes what the preview should show, and a preview that
 * disagrees with the gallery beside it is worse than no preview.
 */
export function usePublicProfilePreview(lang: 'en' | 'ar') {
  return useQuery({
    queryKey: publicProfilePreviewKey(lang),
    queryFn: () => fetchPublicProfilePreview(lang),
    staleTime: 0,
  });
}
