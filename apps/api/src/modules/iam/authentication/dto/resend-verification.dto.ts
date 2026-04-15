import { IsEmail, MaxLength } from 'class-validator';
import type { ResendVerificationRequest } from '@homeservicemarketplace/contracts';

export class ResendVerificationDto implements ResendVerificationRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
