-- Additive review history. Existing submissions remain explicitly incomplete;
-- no current profile data is fabricated as a historic submitted snapshot.
ALTER TABLE "ProviderOnboardingSubmission"
  ADD COLUMN "reviewSnapshot" JSONB,
  ADD COLUMN "reviewFeedback" JSONB,
  ADD COLUMN "decisionIdempotencyKey" TEXT,
  ADD COLUMN "decisionRequestHash" TEXT,
  ADD COLUMN "reviewedRevision" TEXT;

ALTER TABLE "ProviderPortfolioItem" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_PORTFOLIO_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_PORTFOLIO_REJECTED';
ALTER TYPE "AuditEventType" ADD VALUE 'PORTFOLIO_CONTENT_UPDATED';

-- Existing installations receive the same narrow grants as a fresh seed.
INSERT INTO "Permission" ("id", "key", "description", "createdAt", "updatedAt") VALUES
  ('perm_portfolio_read', 'portfolio:read', 'Read provider portfolio submissions for review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_portfolio_review', 'portfolio:review', 'Approve or reject provider portfolio publication', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'admin' AND r."deletedAt" IS NULL
  AND p."key" IN ('portfolio:read', 'portfolio:review')
ON CONFLICT DO NOTHING;
