import { IsEnum, IsOptional } from 'class-validator';
import type { ListBidsQuery } from '@homeservicemarketplace/contracts';
import { BidSortKey } from '@homeservicemarketplace/contracts';

// Query-string DTO for GET /v1/me/requests/:requestId/bids. Sort
// values match the BidsScreen tab keys; unknown sort values are
// rejected by class-validator with a 400 VALIDATION_ERROR.
export class ListBidsQueryDto implements ListBidsQuery {
  @IsOptional()
  @IsEnum(BidSortKey)
  sort?: BidSortKey;
}
