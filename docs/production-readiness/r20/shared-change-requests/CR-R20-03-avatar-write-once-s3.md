# CR-R20-03 — Make S3 avatar uploads write-once (web header first, then server signature)

**Paths:** `apps/web/src/lib/provider/provider-avatar-api.ts` (web, outside
R20) and `apps/api/src/infrastructure/storage/s3-storage.adapter.ts` (R20).

**Reason.** Request attachments and portfolio staging presign
`If-None-Match: *` (a signed header), so a replayed PUT inside the 5-minute
window cannot replace bytes after finalize. Avatars do not: the web client
sends only `Content-Type`, and signing the precondition server-side today would
break every avatar upload (signature mismatch). The real-storage test
`DOCUMENTED GAP (CR-R20-03)` shows a replay replacing finalized avatar bytes.

**Sequenced patch.**

1. Web (deploy first): `xhr.setRequestHeader('If-None-Match', '*');` beside the
   existing `Content-Type` header. Harmless against the current server.
2. API (after the web bundle is live): in `presignUpload`, apply
   `IfNoneMatch: '*'` to every public key (all keys embed a fresh UUID), not
   only portfolio staging and request attachments.

**Tests.** Flip the documented-gap test to expect `412` on replay; web unit test
asserting the header. CORS in the plan already allows `if-none-match`.

**Rollback.** Revert step 2 first, then step 1.
