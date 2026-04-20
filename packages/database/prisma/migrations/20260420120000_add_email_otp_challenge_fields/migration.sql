-- AlterEnum
-- Postgres 12+ supports ADDing multiple enum values in a single migration
-- (requires each ALTER … ADD VALUE statement to be committed before use —
-- Prisma's migrate-deploy handles that automatically).
ALTER TYPE "TokenPurpose" ADD VALUE 'REGISTRATION_OTP';
ALTER TYPE "TokenPurpose" ADD VALUE 'LOGIN_OTP';

-- AlterTable
ALTER TABLE "verification_tokens"
    ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "resendCount"  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "challengeId"  TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_challengeId_key"
    ON "verification_tokens"("challengeId");
