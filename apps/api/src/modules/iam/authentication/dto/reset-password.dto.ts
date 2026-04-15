import { IsString, Length } from 'class-validator';
import type { ResetPasswordRequest } from '@homeservicemarketplace/contracts';

export class ResetPasswordDto implements ResetPasswordRequest {
  @IsString()
  @Length(16, 256)
  token!: string;

  @IsString()
  @Length(12, 128)
  newPassword!: string;
}
