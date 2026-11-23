export interface LoginRequest {
  email?: string;
  phoneNumber?: string;
  /** Required for the selected email method; WhatsApp proves phone ownership with OTP. */
  password?: string;
}
