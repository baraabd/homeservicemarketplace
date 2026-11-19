import type { VerifyOtpRequest } from './verify-otp.request';

export interface PhoneIdentityRequest {
  phoneNumber: string;
}

export interface PhoneEnrollmentRequest extends PhoneIdentityRequest {
  password: string;
}

export interface ResetPasswordOtpRequest extends VerifyOtpRequest {
  newPassword: string;
}

export interface EmailEnrollmentRequest {
  email: string;
  password: string;
}
