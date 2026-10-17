# R28 — Operator-managed hosted platform inputs

Status: **CONFIGURATION_ONLY — HOSTED_ENVIRONMENT_BLOCKED**.

This module prepares checked release inputs for the existing architecture in
[`../STAGING.md`](../STAGING.md). It provisions nothing and provides no deployment
command. The inspected G1 source is
`40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`; this is `frozenBaseSha`, not an instruction
to deploy that historical source. A later `release.sourceSha` identifies the exact
accepted source selected by the release owner.

`staging.cjs` remains the only application rollout authority. R28 does not replace
its manifest, networkless built-API preflight, independent origin allowlisting,
immutable image checks, migration sequence, protected secret-file validation,
force-recreation, deployment lock, or `DEPLOYED_NOT_ACCEPTED` result. No changes to
CI, Docker/Compose, the API entrypoint or environment schema are made by this module.

## Files and offline checks

| File                                                     | Contract                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `topology.json`                                          | Unselected operator target and explicit security/recovery proposals                                      |
| `inputs.schema.json`                                     | Closed JSON Schema draft 2020-12 subset; platform input at the root, edge policy at `#/$defs/edgePolicy` |
| `../edge/edge-policy.json`                               | Same-origin HTTPS reference policy; no edge product is installed or configured                           |
| `../../../scripts/production/platform/validate-plan.cjs` | Offline schema and cross-field checks; no Docker, HTTP, secret-file reads or apply operation             |

From the repository root:

```sh
node scripts/production/platform/validate-plan.cjs --check
node --test scripts/production/platform/validate-plan.test.cjs
node scripts/production/storage/storage-plan.cjs --check
```

To require all target declarations, use:

```sh
node scripts/production/platform/validate-plan.cjs --check --require-target
```

The checked-in unselected template intentionally returns exit **2** for
`--require-target`. Ordinary `--check` can return exit **0** for a valid prepared
plan with blockers. Invalid configuration returns exit **1**. None of those exit
codes certifies target access, owner approval, a deployment, or hosted acceptance.
See `docs/production-readiness/r28/ACCEPTANCE.md` for commands actually executed.

For a separately reviewed target, the optional first path selects an external JSON
plan. `--edge-policy /secure/reviewed-edge.json` selects external edge metadata;
there is no option to replace the checked-in schema. The checker never opens paths
listed under `release.secretFiles`. The independently reviewed `--api-origin` and
`--web-origin` must both be supplied for complete target declaration checks. Do not
derive these independent inputs automatically from an unreviewed file.

`--expected-plan-sha` binds a previously reviewed SHA-256 fingerprint. The fingerprint
covers the plan, edge policy and checked-in schema: changing any of them invalidates
the old fingerprint. It binds configuration bytes semantically; it is not a digital
signature or proof of the person who approved them. Even complete metadata reports
`authorizationVerified: false`, `deploymentStarted: false` and
`status: CONFIGURATION_ONLY`. Evidence references are opaque, non-secret identifiers;
the checker does not retrieve or verify their contents.

## Target selection and existing topology

The following owner-controlled choices remain **null**, rather than invented:
provider, account, region, Docker host, DNS zone, registry host and exact repositories,
secret store, operator approval, spending approval and monthly cost ceiling/currency.
The release manifest also remains null. A repository name or approval-looking string
does not grant account access or authorize a charge.

| Component   | Prepared boundary                                                      | Evidence still required                                                     |
| ----------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| HTTPS edge  | One approved same-origin edge; TLS 1.2 or newer; one trusted proxy hop | Account/host, DNS, certificates, actual applied edge rules                  |
| API and web | Existing distinct digest-pinned images; loopback host bindings         | Accepted source, three image digests, exact build/provenance evidence       |
| Migrator    | Existing one-shot image and separate non-root/DB identity              | Actual schema-scoped DDL grants and same physical DB target                 |
| PostgreSQL  | Major 16 reference; TLS with strict certificate checking               | Selected service/version, role inspection, backup configuration             |
| Redis       | Major 7 reference; dedicated instance; TLS and password                | Selected service, restrictive effective ACL, certificate and network checks |
| Storage     | Three separate R20 namespaces                                          | Bucket identities, root markers, effective IAM/bucket/KMS/CDN policies      |
| Mail        | Port 587 with required STARTTLS, or 465 with implicit TLS              | Selected sender, verified domain, real independent inbox delivery           |
| ClamAV      | Private network service, port 3310 by default                          | Selected version, fresh definitions, real scanner verdict tests             |
| Mongo       | Disabled                                                               | A new explicitly reviewed requirement before enabling                       |

PostgreSQL 16 and Redis 7 are the frozen reference families, not a new vendor or a
claim that an arbitrary patch version is supported. Record the selected versions
and images in target evidence; do not change package/image pins to satisfy this plan.
The existing Dockerfile uses `nginx:alpine`; final application-image digests and
provenance still need explicit review.

`network.externalNetwork` names the existing private runtime network consumed by
`release.externalNetwork`. A network name alone does not prove isolation. The
operator must inspect its peers/routes and the host/provider firewall. Internet
clients must reach only the approved HTTPS listener, never raw API/web, DB, Redis,
ClamAV, Docker management, worker health or monitoring endpoints. Internal health and
metrics scrapes use their existing application guards and approved private paths.

## PostgreSQL privilege declarations and actual evidence

The JSON `apiPrivileges` and `migratorPrivileges` objects are requested policies.
They do not grant privileges and do not prove that a provider applied them.
Different usernames are necessary but insufficient: inherited membership, `SET ROLE`,
object ownership and `PUBLIC` grants can all defeat the separation.

The API policy forbids superuser, database/role creation, replication, bypass-RLS,
schema/relation ownership, schema creation, migrator membership, writes to migration
history and `TRUNCATE`. Grant only the application reads/writes needed by the frozen
code. Preserve immutable ledger/history enforcement; do not grant broad privileges
just to make a smoke pass. The migrator also has no superuser/database/role creation,
replication or bypass-RLS authority. Its DDL is confined to the application schema;
provider extension installation or wider DBA work remains a separate operator action.

After read access to the exact target is authorized, use separate sessions with the
actual API and migrator credentials. The following PostgreSQL 16/psql inspection is
read-only; select the reviewed application schema in the first line. Keep raw
connection details out of evidence.

```sql
\set application_schema public
BEGIN READ ONLY;

SELECT current_database() AS database_name, current_user AS effective_role,
       session_user AS login_role, current_setting('server_version_num') AS version;
SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid();

SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname = current_user;

SELECT rolname,
       pg_has_role(current_user, oid, 'MEMBER') AS member,
       pg_has_role(current_user, oid, 'USAGE') AS inherited_privileges,
       pg_has_role(current_user, oid, 'SET') AS may_assume_role
FROM pg_roles
WHERE rolname <> current_user
  AND (pg_has_role(current_user, oid, 'MEMBER')
       OR pg_has_role(current_user, oid, 'USAGE')
       OR pg_has_role(current_user, oid, 'SET'));

SELECT nspname,
       pg_get_userbyid(nspowner) AS schema_owner,
       has_schema_privilege(current_user, oid, 'USAGE') AS can_use,
       has_schema_privilege(current_user, oid, 'CREATE') AS can_create,
       pg_has_role(current_user, nspowner, 'USAGE') AS inherits_owner,
       pg_has_role(current_user, nspowner, 'SET') AS may_assume_owner
FROM pg_namespace WHERE nspname = :'application_schema';

SELECT n.nspname, c.relname, pg_get_userbyid(c.relowner) AS relation_owner,
       pg_has_role(current_user, c.relowner, 'USAGE') AS inherits_owner,
       pg_has_role(current_user, c.relowner, 'SET') AS may_assume_owner,
       has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
       CASE WHEN c.relname = '_prisma_migrations'
            THEN has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE')
            ELSE NULL END AS can_write_migration_history
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :'application_schema' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

SELECT n.nspname, a.privilege_type, a.is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
WHERE n.nspname = :'application_schema' AND a.grantee = 0;

ROLLBACK;
```

Bind the sanitized outcome to the actual resource ID, source/image revision, schema,
role pair, timestamp and reviewer. Confirm that the two connections reach the same
physical database through provider identity/network evidence; matching logical names
alone do not prove that. Inspect grants/default privileges after migrations as well.
The SQL TLS row does not prove client hostname/CA verification. The current Prisma
connection contract is exactly `sslmode=require&sslaccept=strict`; certificate-negative
checks still need the selected client/provider.

A read-only transaction refusing DDL would not test the role's permissions. Actual
negative DDL/migration-history/TRUNCATE tests belong on an approved disposable target
with representative grants; assert permission-denied results there. This README
contains no SQL grant, secret, schema mutation, or production write probe.

## Worker placement and graceful shutdown

The frozen code runs outbox delivery/cleanup, evidence scan, verification expiry and
public cleanup within API replicas. There is no independent outbox or scan executable.
Retention and dispute maintenance have the two entrypoints named in `workerPlacement`;
listing them does not start them. Their modes remain `off`, pending their existing
policy and infrastructure gates. See [`../workers/OUTBOX_PLAYBOOKS.md`](../workers/OUTBOX_PLAYBOOKS.md).

This reference is one API replica. Do not interpret `apiReplicas: 1` as permission to
set `REALTIME_ALLOW_SINGLE_INSTANCE=true` or to weaken Redis failure behavior. Scaling
needs accepted R25 integration, including SSE fan-out and Socket.IO polling affinity.

The plan proposes a 30-second container stop grace and the current 20,000 ms outbox
shutdown grace. The checker requires the former to strictly exceed the latter.
The existing Compose overlay has no explicit stop grace and therefore needs a
coordinator-authored change before target acceptance. Compare against the **actual**
protected API configuration: `OUTBOX_SHUTDOWN_GRACE_MS` can be configured up to
120,000 ms. A green declaration check does not install the proposed grace period.

## Redis, secrets and registry provenance

Redis clients at this base accept a password but no named ACL username. The plan's
`password-default-user` mode records that compatibility limit; it does not authorize
an unrestricted Redis default account. The selected dedicated instance must deny
unused administrative commands and unauthorized channel/key access while permitting
the actual session/rate-limit and Socket.IO commands. Verify that with the selected
provider. `REDIS_DB` numbers do not isolate Pub/Sub, and the current Socket.IO prefix
is fixed at `socketio:hsm`; staging, production and restore must use distinct instances.
Custom CA or username integration needs a reviewed coordinator change if required.

Populate API and migration secrets from the selected store into separate canonical,
immutable release-specific files outside the checkout. Record version identifiers,
never bytes. Protect every parent directory and host ACL; only the intended image
identity may read its mount. Compose file secrets are bind mounts, not encryption or
proof of a secret-manager integration. Migration secrets contain only `DATABASE_URL`.

Rotation must be serialized with rollout for the same project and snapshot set:
prepare a new immutable version, obtain the existing deployment/rotation coordination
lock, validate it, roll out through `staging.cjs`, verify the replacement process, and
retire the old version only after reviewed rollback/expiry criteria. Never rewrite
active snapshot files. The current launcher does not implement a cross-system
secret-manager lock: `rotationLockEvidenceRef` stays null until the actual process is
selected and tested. Do not auto-expire a crashed deployment lock.

All three image references must match both the selected registry host and the exact
repository before `@sha256`, not just a shared host prefix. A digest prevents tag
drift; an OCI revision label alone is not trusted build provenance. Verify each image's
source revision and trusted builder/attestation, retain its reference and check the
live HTTPS source identity through the existing launcher. Registry access and image
publication are separately authorized external actions.

## Recovery and representative hosted testing

These are explicit proposals for owner acceptance, not achieved service commitments:

| Setting                | Proposal                                                       | State                               |
| ---------------------- | -------------------------------------------------------------- | ----------------------------------- |
| PostgreSQL backup/PITR | Base backups plus uninterrupted WAL archive                    | Not configured                      |
| PostgreSQL retention   | 7 days                                                         | Owner acceptance pending            |
| Database RPO           | 300 seconds / 5 minutes                                        | Unmeasured                          |
| Database RTO           | 14,400 seconds / 4 hours                                       | Unmeasured                          |
| Object versioning      | Enabled for all three R20 buckets                              | Target evidence pending             |
| Object retention       | Preserve the exact R20 namespace lifecycle/retention authority | No new expiry or Object Lock choice |

`pg_dump` is a logical backup and cannot by itself establish this PITR proposal.
R36 must restore to a separately approved resource set: distinct DB, Redis, buckets
and network, with outbound email, notifications and live payment actions disabled.
A copy of production data keeps its privacy requirements; it is not demo data.
Restore evidence must measure elapsed recovery time and recovered data age, verify
schema/domain integrity and restricted storage permissions, and record the isolated
target IDs. Backups enabled and object versions present are not restores verified.

`isolation.hostedTests` reserves an approved representative target for R35/R37. It
must reproduce selected HTTPS/cookie/edge/TLS/worker/storage behavior on accepted
images while remaining isolated from production. Filling the reference does not
execute the journeys or load tests. Production comparison identifiers remain null
until verified; unknown resources cannot prove staging/production separation.

## Initialization, acceptance and rollback

Retain R18's no-demo-provider production seed behavior and existing last-active-admin
floor. No grant, verification/work-access change, dispute/retention activation or
live money rail is performed by this plan. `preserve` means preserve the owning
policy decision; it does not mean that an unapproved production flag value is accepted.
See `docs/production-readiness/r18/PRODUCTION_INITIALIZATION.md` and `OWNER_DECISIONS.md`.

Target acceptance additionally needs real role/TLS/network-denial evidence, a verified
external mail message, correct public/private storage behavior, real scanner verdicts,
worker delivery, authenticated browser cookies/CORS and the relevant isolated restore
and R35/R37 evidence. Local schema tests cannot close those items.

Configuration-only rollback is removal/reversion of this prepared module in review.
No resource cleanup, database rollback or secret deletion is needed because R28 has
not applied anything. A later authorized rollout retains the existing R18/staging
rollback procedure and separately reviewed immutable image/secret versions.

## Primary documentation checked 2026-10-17

- [PostgreSQL 16 role attributes](https://www.postgresql.org/docs/16/role-attributes.html)
  and [privilege inquiry functions](https://www.postgresql.org/docs/16/functions-info.html)
  define the role/catalog checks; effective privileges matter beyond role names.
- [PostgreSQL 16 continuous archiving/PITR](https://www.postgresql.org/docs/16/continuous-archiving.html)
  documents base-backup/WAL recovery and the distinction from logical dumps.
- [Docker Compose service stop grace](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
  documents the 10-second default and configurable stop interval.
- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
  documents per-service file mounts; it does not establish the host's protection.
- [Redis Pub/Sub database scoping](https://redis.io/docs/latest/develop/pubsub/#database--scoping)
  explains why separate DB numbers cannot isolate the frozen channel prefix.
- [S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html)
  is the existing R20 reference; provider-specific behavior still needs target tests.
