-- Register capabilities without granting them to any live role.
-- Policy exceptions and private-prose holds require separate authorization.
INSERT INTO "Permission" ("id", "key", "description", "createdAt", "updatedAt") VALUES
  ('s12_dispute_exception', 'dispute:exception:approve', 'Authorize a policy exception in a dispute decision', NOW(), NOW()),
  ('s12_dispute_private_hold', 'dispute:privacy:hold', 'Place or release a bounded retention hold on private dispute prose', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
