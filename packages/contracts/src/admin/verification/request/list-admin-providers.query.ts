import type { ProviderProfileStatus } from '../../../provider/profile/enums/provider-profile-status';

export interface ListAdminProvidersQuery {
  status?: ProviderProfileStatus | 'ALL';
  /** Server-side display-name/email search. */
  query?: string;
  /** Exact account-to-profile lookup, independent of search text. */
  userId?: string;
  limit?: number;
  cursor?: string;
}
