import { IsIn, IsOptional } from 'class-validator';
import type {
  ListMyCategoryApplicationsQuery,
  ProviderCategoryApplicationStatus,
} from '@homeservicemarketplace/contracts';

const STATUSES: ProviderCategoryApplicationStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

// GET /v1/me/provider/categories/applications?status=
//
// Omitting `status` returns the provider's whole history. The list is scoped
// to the caller by the session, so there is deliberately no providerProfileId
// parameter here to validate — or to tamper with.
export class ListMyCategoryApplicationsQueryDto implements ListMyCategoryApplicationsQuery {
  @IsOptional()
  @IsIn(STATUSES)
  status?: ProviderCategoryApplicationStatus;
}
