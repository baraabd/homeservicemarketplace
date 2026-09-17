-- Sprint 12A: one active dispute per booking, including legacy Admin creates.
-- Do not silently merge or delete real cases to make a migration pass.
DO $$
BEGIN
  IF EXISTS (
    SELECT "bookingId" FROM "Dispute"
    WHERE "deletedAt" IS NULL AND "status" IN ('OPEN', 'IN_REVIEW')
    GROUP BY "bookingId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Active dispute duplicates require authorized review before this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "Dispute_one_active_per_booking"
  ON "Dispute" ("bookingId")
  WHERE "deletedAt" IS NULL AND "status" IN ('OPEN', 'IN_REVIEW');
