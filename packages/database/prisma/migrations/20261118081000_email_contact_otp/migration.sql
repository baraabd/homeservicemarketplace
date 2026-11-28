-- Phone-only accounts can securely add a verified email before channel rollback.
ALTER TYPE "TokenPurpose" ADD VALUE 'EMAIL_CONTACT_OTP';
