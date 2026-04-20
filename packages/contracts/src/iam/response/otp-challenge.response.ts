// Response shape for endpoints that issue an OTP challenge instead of a
// session. Covers both /v1/auth/register and /v1/auth/login when MFA-style
// OTP is enforced (currently: all accounts). `challengeId` is opaque and
// the client MUST echo it back on /v1/auth/verify-otp and /v1/auth/resend-otp.
//
// `expiresInSeconds` is a hint for UI countdown — the authoritative expiry
// is enforced server-side. `codeLength` lets the frontend render the right
// number of input boxes without hard-coding it.
export interface OtpChallengeResponse {
  otpRequired: true;
  challengeId: string;
  expiresInSeconds: number;
  codeLength: number;
}
