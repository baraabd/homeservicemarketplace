-- K06: record which app a support ticket was opened from, so the requester's
-- support notifications deep-link into that app. Additive and nullable: no
-- backfill, no lock-heavy rewrite, and pre-K06 rows keep NULL (the service
-- links those into the customer app). Rollback is application-only: older
-- code never reads the column.

-- CreateEnum
CREATE TYPE "SupportTicketExperience" AS ENUM ('SEEKER', 'PROVIDER');

-- AlterTable
ALTER TABLE "SupportTicket" ADD COLUMN "experience" "SupportTicketExperience";
