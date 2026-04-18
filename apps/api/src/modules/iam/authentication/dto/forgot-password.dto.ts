import { IsEmail, MaxLength } from 'class-validator';
import type { ForgotPasswordRequest } from '@homeservicemarketplace/contracts';

export class ForgotPasswordDto implements ForgotPasswordRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
