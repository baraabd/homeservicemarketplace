import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ADMIN_PROVIDER_REVIEW_TASK_IDS } from '@homeservicemarketplace/contracts';
import type {
  AdminProviderReviewTaskId,
  ApproveAdminProviderReviewRequest,
  RequestAdminProviderReviewChangesRequest,
} from '@homeservicemarketplace/contracts';

class ProviderReviewCommandDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  submissionId!: string;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedRevision!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(120)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class ApproveProviderReviewDto
  extends ProviderReviewCommandDto
  implements ApproveAdminProviderReviewRequest
{
  @IsIn(['DOCUMENTS_COMPLETE_AND_LEGIBLE', 'OTHER'])
  reasonCode!: ApproveAdminProviderReviewRequest['reasonCode'];
}

class ProviderReviewFeedbackDto {
  @IsIn(ADMIN_PROVIDER_REVIEW_TASK_IDS)
  taskId!: AdminProviderReviewTaskId;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  field?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  itemId?: string;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{0,79}$/)
  reasonCode!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  providerMessage!: string;
}

export class RequestProviderReviewChangesDto
  extends ProviderReviewCommandDto
  implements RequestAdminProviderReviewChangesRequest
{
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ProviderReviewFeedbackDto)
  feedback!: ProviderReviewFeedbackDto[];
}
