-- R07 — request creation replay safety.
-- Nullable for rolling-deploy compatibility: existing rows and old clients remain valid.
ALTER TABLE "ServiceRequest"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ServiceRequest_seekerUserId_idempotencyKey_key"
  ON "ServiceRequest"("seekerUserId", "idempotencyKey");
