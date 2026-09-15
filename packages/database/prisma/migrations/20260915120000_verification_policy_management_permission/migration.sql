-- Additive permission provisioning. Preserve the existing administrator's policy
-- access while making it independently revocable from verification decisions.
-- No person-specific assignments and no changes to published policy history.
INSERT INTO "Permission" ("id", "key", "description", "createdAt", "updatedAt")
VALUES ('verification-policy-manage', 'verification:policy:manage',
        'Read, publish and retire verification policies', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" = 'admin' AND r."deletedAt" IS NULL
  AND p."key" = 'verification:policy:manage'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
