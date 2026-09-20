-- Additive private-text lifecycle; migration itself never erases data.
ALTER TABLE "DisputeWorkspace"
  ADD COLUMN "privateTextDueAt" TIMESTAMP(3),
  ADD COLUMN "privateTextHoldUntil" TIMESTAMP(3),
  ADD COLUMN "privateTextErasedAt" TIMESTAMP(3);
ALTER TABLE "DisputePrivateDraft" ADD COLUMN "erasedAt" TIMESTAMP(3);
CREATE INDEX "DisputeWorkspace_privateTextErasedAt_privateTextDueAt_idx"
  ON "DisputeWorkspace"("privateTextErasedAt", "privateTextDueAt");
ALTER TABLE "DisputeWorkspace" ADD CONSTRAINT "dispute_private_erasure_closed"
  CHECK ("privateTextErasedAt" IS NULL OR ("state" = 'CLOSED' AND "closedAt" IS NOT NULL AND "privateTextDueAt" IS NOT NULL));
ALTER TABLE "DisputePrivateDraft" ADD CONSTRAINT "dispute_draft_erasure_scrubbed"
  CHECK ("erasedAt" IS NULL OR "contentCipher" = '');
