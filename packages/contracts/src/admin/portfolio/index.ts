import type { ProviderPortfolioItem } from '../../provider/portfolio';

/** Authenticated reviewer projection; never contains object keys or owner IDs. */
export interface AdminPortfolioItem extends ProviderPortfolioItem {
  revision: number;
  updatedAt: string;
  moderatedAt: string | null;
  reviewBlockedReason: 'MEDIA_MIGRATION_REQUIRED' | 'PUBLICATION_ACK_REQUIRED' | null;
  availableActions: Array<'APPROVE' | 'REJECT'>;
  /** Most recent 200 events across this gallery; no reviewer PII or storage keys. */
  history: Array<{
    id: string;
    action: 'APPROVED' | 'REJECTED' | 'CONTENT_UPDATED';
    at: string;
    revision: number | null;
    reason: string | null;
  }>;
}

export interface AdminPortfolioListResponse {
  items: AdminPortfolioItem[];
}

export interface ReviewAdminPortfolioItemRequest {
  action: 'APPROVE' | 'REJECT';
  /** Revision displayed to the reviewer. A stale tab must reload before deciding. */
  expectedRevision: number;
  /** Required for rejection, visible to the provider. */
  reason?: string;
}
