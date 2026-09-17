import type { ListAdminProvidersQuery } from '@homeservicemarketplace/contracts';

export const APPROVAL_OVERVIEW_QUERY = {
  status: 'PENDING_REVIEW', sort: 'SUBMITTED_OLDEST', limit: 5,
} satisfies ListAdminProvidersQuery;
