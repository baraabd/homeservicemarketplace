# R18 — Backup and restore evidence

Status: **NOT EXECUTED — `HOSTED_ENVIRONMENT_BLOCKED`.**

No staging or production database, object store or secret manager exists
(`ENVIRONMENT_MATRIX.md`). A backup of a disposable CI container would prove
nothing about the hosted target, so none is reported as evidence.

## What the owner must define (no business targets are invented here)

| Item                                                                                                                 | Target          | Status           |
| -------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------- |
| Database RPO                                                                                                         | owner           | UNKNOWN_DECISION |
| Database RTO                                                                                                         | owner           | UNKNOWN_DECISION |
| Database backup method and retention                                                                                 | owner           | UNKNOWN_DECISION |
| Object storage versioning and retention (restricted evidence has legal retention rules: `evidence-retention` worker) | owner           | UNKNOWN_DECISION |
| Secret recovery process                                                                                              | owner           | UNKNOWN_DECISION |
| Infrastructure configuration recovery                                                                                | owner           | UNKNOWN_DECISION |
| Application artifact retention                                                                                       | registry policy | UNKNOWN_DECISION |

## Restore drill to run once a target exists

1. Take a backup of the staging database; record its identifier and timestamp.
2. Restore it to an isolated database with no application traffic.
3. Run `prisma migrate status` against the restored copy (expect the
   migration set hash in `DATABASE_RELEASE_EVIDENCE.md`).
4. Compare row counts of `User`, `ServiceRequest`, `Bid`, `Booking`,
   `BookingReview`, `Message`, `Notification` with the source at backup time.
5. Restore a sample of object-storage versions; confirm checksums.
6. Record elapsed time (the measured RTO) and data age (the measured RPO).

Record identifiers, counts and times only; never credentials or rows.
