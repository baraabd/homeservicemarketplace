import { IsString, Length } from 'class-validator';
import type { VerifyEmailRequest } from '@homeservicemarketplace/contracts';

export class VerifyEmailDto implements VerifyEmailRequest {
  @IsString()
  @Length(16, 256)
  token!: string;
}
