import { IsString, Length, Matches } from 'class-validator';
import type { ResendOtpRequest } from '@homeservicemarketplace/contracts';

export class ResendOtpDto implements ResendOtpRequest {
  @IsString()
  @Length(16, 256)
  @Matches(/^[A-Za-z0-9_-]+$/u)
  challengeId!: string;
}
