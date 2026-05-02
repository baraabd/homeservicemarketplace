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

// Sprint 5.1.4 made `reason` optional so the admin UI can ship a
// one-click reject / suspend without a modal. Provided values still
// flow into the audit metadata + the user-facing notification body;
// an empty body produces a generic "your account was suspended"
// notification.
export class AdminProviderRejectDto implements AdminProviderRejectRequest {
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  reason?: string;
}

export class AdminProviderSuspendDto implements AdminProviderSuspendRequest {
  @IsOptional()
  @IsString()
  @Length(1, 1024)
  reason?: string;
}
