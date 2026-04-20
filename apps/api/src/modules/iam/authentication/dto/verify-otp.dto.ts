import { IsString, Length, Matches } from 'class-validator';
import type { VerifyOtpRequest } from '@homeservicemarketplace/contracts';

// Challenge id is an opaque base64url string minted by the server. Bound
// length is generous but finite; anything outside that range is rejected
// at the DTO layer before any DB work.
//
// Code is strictly 6 numeric digits. We validate digit-only here to fail
// fast on copy/paste typos and to avoid wasting an attempt slot on
// obviously-wrong input.
export class VerifyOtpDto implements VerifyOtpRequest {
  @IsString()
  @Length(16, 256)
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}
