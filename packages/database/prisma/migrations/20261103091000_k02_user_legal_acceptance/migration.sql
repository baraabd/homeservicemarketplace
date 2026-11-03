-- K02 — exact public-policy acceptance at signup.
--
-- Additive only. No existing account receives a row: absence means "no
-- recorded acceptance" and is never inferred or backfilled. acceptedAt is
-- the server time of the accepting request.

-- CreateEnum
CREATE TYPE "LegalDocumentKind" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_NOTICE');

-- CreateEnum
CREATE TYPE "LegalAcceptanceSource" AS ENUM ('SIGNUP');

-- CreateTable
CREATE TABLE "UserLegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentKind" "LegalDocumentKind" NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "source" "LegalAcceptanceSource" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLegalAcceptance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserLegalAcceptance_version_check" CHECK (length(btrim("version")) > 0),
    CONSTRAINT "UserLegalAcceptance_locale_check" CHECK ("locale" IN ('en', 'ar'))
);

-- CreateIndex
CREATE INDEX "UserLegalAcceptance_documentKind_version_idx" ON "UserLegalAcceptance"("documentKind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "UserLegalAcceptance_userId_documentKind_version_key" ON "UserLegalAcceptance"("userId", "documentKind", "version");

-- AddForeignKey
ALTER TABLE "UserLegalAcceptance" ADD CONSTRAINT "UserLegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
