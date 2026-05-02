import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { UpdateUserStatusRequest } from '@homeservicemarketplace/contracts';

// PATCH /v1/admin/users/:userId/status
//
// `status` is a closed set of allowed *target* values. PENDING_VERIFICATION
// and DELETED are intentionally NOT acceptable — admins shouldn't un-verify
// a user from the UI, and DELETE flows are reserved for the user themselves
// via the deactivate-my-account path. forbidNonWhitelisted: true blocks any
// attempt to inject `userId`, `roles`, `email`, etc.
const ALLOWED_STATUS_VALUES = ['ACTIVE', 'SUSPENDED', 'LOCKED'] as const;
type AllowedStatus = (typeof ALLOWED_STATUS_VALUES)[number];

export class UpdateUserStatusDto implements UpdateUserStatusRequest {
  @IsIn(ALLOWED_STATUS_VALUES as unknown as string[])
  status!: AllowedStatus;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string | null;
}
