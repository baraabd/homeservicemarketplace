-- Sprint 1, slice 2: saved addresses for an authenticated user.
-- Always scoped to a userId on read and write — userId is set from the
-- authenticated session on the server, never trusted from client input.
--
-- Rolls back cleanly with:
--   DROP TABLE "addresses";
--   DROP TYPE "AddressType";

CREATE TYPE "AddressType" AS ENUM ('HOME', 'WORK', 'CUSTOM');

CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "AddressType" NOT NULL,
    "line1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- Ownership lookup (dominant access pattern: list-my-addresses).
CREATE INDEX "addresses_userId_deletedAt_idx" ON "addresses"("userId", "deletedAt");
-- Default-address lookup.
CREATE INDEX "addresses_userId_isDefault_idx" ON "addresses"("userId", "isDefault");
-- Generic deleted-row sweep / housekeeping.
CREATE INDEX "addresses_deletedAt_idx" ON "addresses"("deletedAt");

ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
