# R20 — rollback

R20 changes no schema, migration, env key, contract, route, CI or image. Every
change is in the storage adapters, new read-only tooling, plan documents and
tests, so rollback is a code revert. No data migration is needed either way.

## Revert

`git revert <R20 source commit>` (see `ACCEPTANCE.md`) restores the base
adapters. Effects of reverting:

| Behaviour                                       | After revert                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3 presign signs `content-type`                 | No longer signed (F1 hole returns).                                                                                                                                                         |
| Local public writes write-once for every key    | Avatars overwritable again on the local driver.                                                                                                                                             |
| Root markers                                    | Adapters stop reading/creating them. Marker objects/files already written are inert (dot-leading keys are unaddressable by every route) and may be left in place or removed by an operator. |
| Fault classification / key fingerprints in logs | Raw key/bucket fields return to some log lines.                                                                                                                                             |
| Restricted integrity option                     | Ignored (no caller passes it yet, CR-R20-01).                                                                                                                                               |
| Local erasure fences, Windows ENOENT fix        | Gone.                                                                                                                                                                                       |

## Forward-repair options instead of a full revert

- If a deployed client is found that PUTs with a different `Content-Type` than
  it presigned (none exists today), fix the client; do not unsign the header.
- If a bucket marker blocks a legitimate deployment (namespace mismatch),
  correct the bucket env var or the marker. Never delete the marker to force
  traffic through, and never make a bucket public to repair a 404.
- If the local erasure fence refuses (`restricted-root-unprovisioned`), the
  worker resolved a root that does not exist: set `RESTRICTED_STORAGE_DIR` to
  the API's root; confirm with `storage-doctor.cjs`.

## Infrastructure plan

Nothing was applied to any account. If an authorized operator applies the plan
and must roll back: lifecycle and CORS configurations can be deleted per
bucket; versioning can only be suspended, not disabled; Object Lock, if
enabled, cannot be disabled — which is why it is an owner decision.
