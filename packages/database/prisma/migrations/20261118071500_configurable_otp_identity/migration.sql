-- Additive identity expansion. Existing email accounts and pending email OTPs remain valid.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "phoneNumber" TEXT, ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");
ALTER TABLE "User" ADD CONSTRAINT "User_contact_identity_check" CHECK ("email" IS NOT NULL OR "phoneNumber" IS NOT NULL);
ALTER TABLE "User" ADD CONSTRAINT "User_phoneNumber_e164_check" CHECK ("phoneNumber" IS NULL OR "phoneNumber" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "VerificationToken" ADD COLUMN "deliveryChannel" TEXT, ADD COLUMN "deliveryTarget" TEXT;
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_delivery_check" CHECK (("deliveryChannel" IS NULL AND "deliveryTarget" IS NULL) OR ("deliveryChannel" IS NOT NULL AND "deliveryChannel" IN ('email', 'whatsapp') AND "deliveryTarget" IS NOT NULL AND length("deliveryTarget") > 0));
ALTER TYPE "TokenPurpose" ADD VALUE 'PASSWORD_RESET_OTP';
ALTER TYPE "TokenPurpose" ADD VALUE 'PHONE_VERIFICATION_OTP';
