import { IsString, Length, Matches, IsEmail, MaxLength } from 'class-validator';
import type {
  PhoneIdentityRequest,
  EmailEnrollmentRequest,
  PhoneEnrollmentRequest,
  ResetPasswordOtpRequest,
} from '@homeservicemarketplace/contracts';
import { VerifyOtpDto } from './verify-otp.dto';

export class PhoneIdentityDto implements PhoneIdentityRequest {
  @IsString()
  @Matches(/^\+[1-9][0-9]{6,14}$/)
  phoneNumber!: string;
}

export class PhoneEnrollmentDto extends PhoneIdentityDto implements PhoneEnrollmentRequest {
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class ResetPasswordOtpDto extends VerifyOtpDto implements ResetPasswordOtpRequest {
  @IsString()
  @Length(12, 128)
  newPassword!: string;
}

export class EmailEnrollmentDto implements EmailEnrollmentRequest {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(1, 128)
  password!: string;
}
