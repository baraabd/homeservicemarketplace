import type { AdminProviderSummary } from './admin-provider-summary';

export interface ListAdminProvidersResponse {
  items: AdminProviderSummary[];
  nextCursor: string | null;
}
