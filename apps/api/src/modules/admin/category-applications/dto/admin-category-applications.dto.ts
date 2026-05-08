import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type {
  ListPendingCategoriesQuery,
  ReviewCategoryApplicationRequest,
} from '@homeservicemarketplace/contracts';

const APPLICATION_STATUS = ['PENDING', 'APPROVED', 'REJECTED'] as const;
const REVIEW_ACTIONS = ['APPROVE', 'REJECT'] as const;

// GET /v1/admin/category-applications
//
// Defaults to PENDING in the service layer when status is omitted —
// that's the queue surface. APPROVED / REJECTED are admitted so the
// audit views can reuse the same endpoint.
export class ListPendingCategoriesQueryDto implements ListPendingCategoriesQuery {
  @IsOptional()
  @IsIn(APPLICATION_STATUS)
  status?: ListPendingCategoriesQuery['status'];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  cursor?: string;
}

// PATCH /v1/admin/category-applications/:applicationId/review
//
// `notes` are admin-facing only — they DO NOT reach the provider. The
// provider's surface receives the action result through a notification
// (out of scope for this slice). Length-capped at 4 000 to mirror the
// review-notes pattern used elsewhere in the admin surface.
export class ReviewCategoryApplicationDto implements ReviewCategoryApplicationRequest {
  @IsIn(REVIEW_ACTIONS)
  action!: ReviewCategoryApplicationRequest['action'];

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  notes?: string | null;
}
