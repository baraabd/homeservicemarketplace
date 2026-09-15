import type { ProviderProfileStatus } from '../../../provider/profile/enums/provider-profile-status';
import type { AdminProviderIdentityState } from '../response/admin-provider-summary';

export interface ListAdminProvidersQuery {
  status?: ProviderProfileStatus | 'ALL';
  /** Server-side display-name/email search. */
  query?: string;
  /** Exact account-to-profile lookup, independent of search text. */
  userId?: string;
  sort?: 'SUBMITTED_OLDEST' | 'UPDATED_NEWEST';
  /** Assignment belongs to the current identity case; MINE uses the authenticated admin. */
  assignment?: 'ALL' | 'UNASSIGNED' | 'MINE';
  identityState?: AdminProviderIdentityState;
  /** Match providers with at least one non-deleted item in this moderation state. */
  portfolioState?: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** ISO alpha-2 country code, matched against serviceAreaCountryCode. */
  country?: string;
  /** Inclusive ISO timestamp, or a UTC calendar date. */
  submittedFrom?: string;
  /** Date-only values include the entire UTC day; timestamps remain exact. */
  submittedTo?: string;
  limit?: number;
  cursor?: string;
}
