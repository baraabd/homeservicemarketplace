# CR-R20-01 — Pass the recorded size to restricted reads; set document headers only after the object opens

**Paths (outside R20):**
`apps/api/src/modules/provider/verification/media/evidence-read.controller.ts`,
`apps/api/src/modules/provider/verification/media/evidence-read.service.ts`
(grant must carry `sizeBytes`), and optionally
`apps/api/src/modules/disputes/workspace/workspace-evidence.service.ts:222`.

**Reason.** `RestrictedObjectStoragePort.openReadStream(key, expected?)` (R20)
refuses an object whose backend-counted length differs from the database row,
before any byte is streamed. The route does not pass it, so a substituted
object (operator error, bad restore, leaked credential) is served as a
passport. Separately, the controller sets `Content-Type: <detected>` and
`Content-Disposition: attachment` before opening the object, so a storage-side
404 sends a JSON error labelled as a PDF attachment.

**Minimal patch (controller):**

```ts
let stream;
try {
  stream = await this.objects.openReadStream(grant.storageKey, { sizeBytes: grant.sizeBytes });
} catch {
  this.log.error({ msg: 'evidence.read.object_unavailable', documentId });
  throw new AppError('NOT_FOUND', 'Document not found.', 404);
}
res.setHeader('Cache-Control', 'no-store, private, max-age=0, must-revalidate');
// … the remaining headers, unchanged, now AFTER the open succeeded …
stream.pipe(res);
```

Service: add `sizeBytes: asset.sizeBytes` to the read grant.

**Tests.** In `apps/api/test/integration/r20-storage/r20-mediated-read-s3.integration.spec.ts`
the tests named `DOCUMENTED GAP (CR-R20-01)` and the helper
`expectStorageSide404HeadersGap` must be inverted: a substituted object → 404
with the unknown-document body; storage-side 404 → JSON content type. Existing
`evidence-read-boundary.integration` must stay green.

**Consequences.** No schema, migration or contract change. Audit rows unchanged.
