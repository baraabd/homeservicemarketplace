-- Sprint 9B.19 — a normalised country code beside the display name.
--
-- `serviceAreaCountry` holds prose: "Sweden", "سوريا", whatever the provider
-- typed. That is the right thing to SHOW and the wrong thing to look anything
-- up by — a timezone, a market policy or a currency resolved by matching
-- free text is one spelling away from silently resolving to nothing.
--
-- So the display value stays exactly as it is, and this column carries the
-- ISO 3166-1 alpha-2 code beside it. Nothing is rewritten and nothing is
-- backfilled: mapping arbitrary prose in many languages back to a code is
-- guesswork, and a wrong code is worse than an absent one because everything
-- downstream would trust it. Existing rows keep NULL and behave exactly as
-- they do today; the code is filled the next time a provider saves the step.
--
-- ROLLBACK / COMPATIBILITY
--
-- Dropping the column loses nothing that was not derivable: the display name
-- is untouched and is what every current reader uses. An OLD binary against a
-- NEW database ignores the column entirely.

ALTER TABLE "ProviderProfile"
  ADD COLUMN IF NOT EXISTS "serviceAreaCountryCode" TEXT;

-- Looked up by country for market policy and timezone resolution, never
-- scanned by itself.
CREATE INDEX IF NOT EXISTS "ProviderProfile_serviceAreaCountryCode_idx"
  ON "ProviderProfile" ("serviceAreaCountryCode");
