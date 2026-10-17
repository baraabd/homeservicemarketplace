-- G2 / R27: additive read index for completed, non-deleted financial bookings.
-- Default-planner PostgreSQL 16 comparisons selected this full index for both
-- generic and parameter-bound status queries. The earlier deletedAt-prefix
-- candidate retained Seq Scan + Sort; the partial alternative was not usable
-- for the generic status parameter. Runtime predicates and ordering are unchanged.
--
-- This ordinary index build takes a write lock. Hosted application requires
-- the existing separately approved migration/deployment window. Rollback is a
-- reviewed forward migration dropping only this index, never financial rows.
CREATE INDEX "Booking_status_updatedAt_id_deletedAt_idx"
  ON "Booking" ("status", "updatedAt" DESC, "id" DESC, "deletedAt");
