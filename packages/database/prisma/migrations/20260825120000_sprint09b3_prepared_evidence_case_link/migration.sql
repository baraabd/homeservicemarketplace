-- Sprint 9B.3 — link a PREPARED upload to its case, and give it an explicit
-- expiry.
--
-- docs/adr/0009-restricted-identity-media.md
--
-- Both columns are additive and nullable, so an older API build ignores them
-- and every existing row stays valid.
--
-- verificationCaseId is load-bearing for AUTHORIZATION, not convenience.
-- Ownership of restricted evidence is derived through
-- case.providerProfile.userId; between prepare and finalize there is no
-- VerificationDocument yet to carry that link. The alternative — parsing the
-- case id back out of the storage key — would make a string the authorization
-- boundary, which is precisely what ADR 0009 refuses.
--
-- ON DELETE SET NULL rather than CASCADE: deleting a case must not delete the
-- record of bytes that may still exist in the bucket. Retention (ADR 0012)
-- owns when evidence disappears, and a row that silently vanished would take
-- the deletion audit trail with it.
ALTER TABLE "MediaAsset" ADD COLUMN "uploadExpiresAt" TIMESTAMP(3),
                         ADD COLUMN "verificationCaseId" TEXT;

-- The cleanup sweep reads exactly this pair: prepared uploads for a case that
-- never completed.
CREATE INDEX "MediaAsset_verificationCaseId_uploadCompletedAt_idx"
  ON "MediaAsset"("verificationCaseId", "uploadCompletedAt");

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_verificationCaseId_fkey"
  FOREIGN KEY ("verificationCaseId") REFERENCES "VerificationCase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
