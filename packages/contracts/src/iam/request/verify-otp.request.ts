// Payload for POST /v1/auth/verify-otp. The backend derives the challenge
// purpose (REGISTRATION_OTP vs LOGIN_OTP) from the stored challenge row —
// the client never controls the purpose, only references an opaque handle.
export interface VerifyOtpRequest {
  challengeId: string;
  code: string; // 6 numeric digits
}
