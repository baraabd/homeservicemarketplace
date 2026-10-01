-- R06 — authoritative service-request attachments.
--
-- Request media used to be a list of URLs the client supplied and the server
-- stored verbatim in "ServiceRequest"."mediaUrls". Nothing recorded who
-- uploaded an object, whether it existed, or whether it was already attached
-- elsewhere.
--
-- This migration is ADDITIVE. It adds the columns that let a MediaAsset row be
-- reserved for a request attachment and claimed by exactly one request.
-- Existing rows are untouched: every new column is nullable, and
-- "ServiceRequest"."mediaUrls" stays as the read projection, now written by the
-- server from claimed assets instead of from client input.
--
-- Rollback / forward-fix: the columns, constraints and index can be dropped
-- without data loss to pre-R06 behaviour, because no existing column changes
-- meaning. Claimed assets would lose their request link; the URLs already
-- projected onto "ServiceRequest"."mediaUrls" keep resolving.

CREATE TYPE "MediaAssetPurpose" AS ENUM ('REQUEST_ATTACHMENT');

ALTER TABLE "MediaAsset"
  ADD COLUMN "purpose" "MediaAssetPurpose",
  ADD COLUMN "serviceRequestId" TEXT,
  ADD COLUMN "requestClaimedAt" TIMESTAMP(3),
  ADD COLUMN "requestAttachmentPosition" INTEGER;

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_serviceRequestId_fkey"
  FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- One asset per (request, position). NULLs are distinct in a Postgres unique
-- index, so unclaimed rows never collide.
CREATE UNIQUE INDEX "MediaAsset_serviceRequestId_requestAttachmentPosition_key"
  ON "MediaAsset" ("serviceRequestId", "requestAttachmentPosition");

CREATE INDEX "MediaAsset_purpose_serviceRequestId_uploadExpiresAt_idx"
  ON "MediaAsset" ("purpose", "serviceRequestId", "uploadExpiresAt");

-- Invariants that must survive an application bug.
--
-- A row linked to a request must be a PUBLIC request-attachment reservation
-- whose upload was verified, with the claim time and position recorded. This
-- is what stops an avatar, a portfolio image or restricted evidence from ever
-- being attached to a request, whatever code path tries.
ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "media_asset_request_claim_shape_chk" CHECK (
    "serviceRequestId" IS NULL
    OR (
      -- IS NOT DISTINCT FROM, not "=": with a NULL purpose "=" yields NULL, and a
      -- CHECK passes on NULL, which would let an avatar or portfolio row through.
      "purpose" IS NOT DISTINCT FROM 'REQUEST_ATTACHMENT'::"MediaAssetPurpose"
      AND "visibility" = 'PUBLIC'
      AND "uploadCompletedAt" IS NOT NULL
      AND "requestClaimedAt" IS NOT NULL
      AND "requestAttachmentPosition" IS NOT NULL
    )
  );

-- A claim time only ever exists on a request attachment. It is deliberately
-- NOT required to have a live "serviceRequestId": deleting the request sets the
-- link to NULL and leaves the claim time, which keeps the asset unreusable.
ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "media_asset_request_claimed_purpose_chk" CHECK (
    "requestClaimedAt" IS NULL
    OR "purpose" IS NOT DISTINCT FROM 'REQUEST_ATTACHMENT'::"MediaAssetPurpose"
  );

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "media_asset_request_position_range_chk" CHECK (
    "requestAttachmentPosition" IS NULL
    OR ("requestAttachmentPosition" >= 0 AND "requestAttachmentPosition" < 32)
  );
