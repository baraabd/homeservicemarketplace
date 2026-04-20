import { IsString, Length } from 'class-validator';
import type { ResendOtpRequest } from '@homeservicemarketplace/contracts';

export class ResendOtpDto implements ResendOtpRequest {
  @IsString()
  @Length(16, 256)
  challengeId!: string;
}
