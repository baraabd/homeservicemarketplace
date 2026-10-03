-- R13 — durable help & support.
-- Additive ticket/message persistence. Static FAQ content remains static and
-- is deliberately not copied into these tables.

CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "SupportMessageAuthorRole" AS ENUM ('REQUESTER', 'SUPPORT');

ALTER TYPE "AuditEventType" ADD VALUE 'SUPPORT_TICKET_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE 'SUPPORT_MESSAGE_SENT';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_SUPPORT_REPLIED';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_SUPPORT_CLOSED';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_SUPPORT_REOPENED';

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "creationKey" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3),
  "closedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportMessage" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorUserId" TEXT,
  "authorRole" "SupportMessageAuthorRole" NOT NULL,
  "body" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportTicket_requesterUserId_creationKey_key"
  ON "SupportTicket"("requesterUserId", "creationKey");
CREATE INDEX "SupportTicket_requesterUserId_status_updatedAt_idx"
  ON "SupportTicket"("requesterUserId", "status", "updatedAt");
CREATE INDEX "SupportTicket_status_updatedAt_idx"
  ON "SupportTicket"("status", "updatedAt");

CREATE UNIQUE INDEX "SupportMessage_ticketId_authorUserId_idempotencyKey_key"
  ON "SupportMessage"("ticketId", "authorUserId", "idempotencyKey");
CREATE INDEX "SupportMessage_ticketId_createdAt_idx"
  ON "SupportMessage"("ticketId", "createdAt");

ALTER TABLE "SupportTicket"
  ADD CONSTRAINT "SupportTicket_requesterUserId_fkey"
  FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportTicket"
  ADD CONSTRAINT "SupportTicket_closedByUserId_fkey"
  FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportMessage"
  ADD CONSTRAINT "SupportMessage_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportMessage"
  ADD CONSTRAINT "SupportMessage_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportTicket" ADD CONSTRAINT "support_ticket_subject_bounded"
  CHECK (char_length("subject") BETWEEN 1 AND 160);
ALTER TABLE "SupportMessage" ADD CONSTRAINT "support_message_body_bounded"
  CHECK (char_length("body") BETWEEN 1 AND 4000);
ALTER TABLE "SupportTicket" ADD CONSTRAINT "support_ticket_close_consistent"
  CHECK (
    ("status" = 'OPEN' AND "closedAt" IS NULL AND "closedByUserId" IS NULL)
    OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL)
  );
