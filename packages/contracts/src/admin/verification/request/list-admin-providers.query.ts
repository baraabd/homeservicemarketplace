import type { ProviderProfileStatus } from '../../../provider/profile/enums/provider-profile-status';

export interface ListAdminProvidersQuery {
  status?: ProviderProfileStatus;
  limit?: number;
  cursor?: string;
}
