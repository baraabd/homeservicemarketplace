-- R21 — durable outbound email: delivery intents, provider feedback and
-- channel suppression. Additive only; no existing table or enum changes.

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'ACCEPTED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('AUTH', 'NOTIFICATION');

-- CreateEnum
CREATE TYPE "EmailSuppressionReason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "EmailFeedbackKind" AS ENUM ('DELIVERED', 'BOUNCE_PERMANENT', 'BOUNCE_TRANSIENT', 'COMPLAINT');

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "messageKey" TEXT NOT NULL,
    "category" "EmailCategory" NOT NULL,
    "template" TEXT NOT NULL,
    "userId" TEXT,
    "recipientHash" TEXT NOT NULL,
    "envelope" BYTEA,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leasedBy" TEXT,
    "lastErrorClass" TEXT,
    "lastSmtpCode" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "outcomeAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "feedbackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailFeedbackEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" "EmailFeedbackKind" NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailFeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_messageKey_key" ON "EmailDelivery"("messageKey");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_nextAttemptAt_idx" ON "EmailDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_leaseUntil_idx" ON "EmailDelivery"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "EmailDelivery_recipientHash_template_createdAt_idx" ON "EmailDelivery"("recipientHash", "template", "createdAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_createdAt_idx" ON "EmailDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_recipientHash_reason_key" ON "EmailSuppression"("recipientHash", "reason");

-- CreateIndex
CREATE INDEX "EmailFeedbackEvent_receivedAt_idx" ON "EmailFeedbackEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "EmailFeedbackEvent_deliveryId_idx" ON "EmailFeedbackEvent"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailFeedbackEvent_source_externalId_key" ON "EmailFeedbackEvent"("source", "externalId");

-- AddForeignKey
ALTER TABLE "EmailFeedbackEvent" ADD CONSTRAINT "EmailFeedbackEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "EmailDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

