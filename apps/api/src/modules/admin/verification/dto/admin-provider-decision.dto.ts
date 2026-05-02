import { IsOptional, IsString, Length } from 'class-validator';
import type {
  AdminProviderApproveRequest,
  AdminProviderRejectRequest,
  AdminProviderSuspendRequest,
} from '@homeservicemarketplace/contracts';

export class AdminProviderApproveDto implements AdminProviderApproveRequest {
  @IsOptional()
  @IsString()
  @Length(0, 1024)
  note?: string | null;
}

export class AdminProviderRejectDto implements AdminProviderRejectRequest {
  @IsString()
  @Length(1, 1024)
  reason!: string;
}

export class AdminProviderSuspendDto implements AdminProviderSuspendRequest {
  @IsString()
  @Length(1, 1024)
  reason!: string;
}
