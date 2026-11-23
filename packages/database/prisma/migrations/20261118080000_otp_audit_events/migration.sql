-- Distinguish verified contact ownership without recording contact values or OTPs.
ALTER TYPE "AuditEventType" ADD VALUE 'PHONE_VERIFIED';
ALTER TYPE "AuditEventType" ADD VALUE 'PHONE_VERIFICATION_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'OTP_RESENT';
