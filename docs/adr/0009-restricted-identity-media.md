# ADR 0009 — Identity evidence is RESTRICTED media on a private namespace

- **Status:** Accepted
- **Date:** 2026-08-24
- **Sprint:** 09
- **Related:** [0010](0010-policy-versioned-verification.md) (what evidence is required), [0012](0012-evidence-retention-and-deletion.md) (how long it lives), `docs/sprint-09/THREAT-MODEL.md`

## Context

Sprint 9 asks providers to upload government identity documents, business
registrations and trade licences. The platform already has an upload pipeline,
and the obvious move is to reuse it. Reading it says otherwise.

`apps/api/src/modules/media/media.controller.ts` serves request media through:

```ts
@Public()
@Get('files/*')
async serveFile(...) {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  createReadStream(absPath).pipe(res);
}
```

Three properties make this correct for a photo of a broken tap and catastrophic
for a passport:

1. **`@Public()`** — no authentication, no ownership check. The object key is
   the only secret, and keys travel in `ServiceRequest.mediaUrls[]`, in
   notification payloads, and through any CDN log.
2. **`immutable, max-age=31536000`** — an intermediary is invited to keep a copy
   for a year. Deleting the origin object does not delete those copies, which
   makes the retention guarantees of [0012](0012-evidence-retention-and-deletion.md) unenforceable.
3. **No `MediaAsset` row exists.** Media is a bare string URL. A URL cannot
   carry a scan state, a hash, an owner, a retention date, or a visibility — so
   there is no place to write down that a file is restricted, and no way to ask.

There is also no file-signature validation anywhere: `local-disk-storage.adapter.ts`
verifies the HMAC, the _declared_ content type and the _declared_ size, and
never inspects a byte of the body.

## Decision

### 1. A `MediaAsset` row is the unit of media, not a URL

Every uploaded object gets a row carrying `visibility`, server-generated
`storageKey`, `detectedMimeType`, `declaredMimeType`, `sizeBytes`, `sha256`,
`scanState`, `ownerUserId`, and the retention fields from
[0012](0012-evidence-retention-and-deletion.md). "Restricted" becomes a fact the
database holds and every read path can consult, rather than a convention.

### 2. Three visibilities, and RESTRICTED is not a synonym for PRIVATE

| Visibility   | Meaning                                            | Read path                                                     |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------- |
| `PUBLIC`     | Request photos, avatars. Cacheable, key-addressed. | Existing public route. Unchanged.                             |
| `PRIVATE`    | Owner-only, not listed publicly. Portfolio drafts. | Owner-authenticated read.                                     |
| `RESTRICTED` | Identity evidence.                                 | Reviewer-permission OR owner, short-lived, audited, no cache. |

Collapsing `RESTRICTED` into `PRIVATE` would lose the distinction the entire
threat model rests on: a private file is one the owner controls, a restricted
file is one **the owner may not freely share and a reviewer may only see while
holding an open case**.

### 3. A separate private namespace, and no public route may resolve it

Restricted objects are keyed `verification/{caseId}/{assetId}` in a bucket (or
disk root) that the public serve route cannot address. This is enforced twice —
by configuration (distinct root/bucket) and by code (the public route rejects
any key whose first segment is a restricted namespace). One of those is the
control; the other is the thing that catches a misconfiguration.

Reads are **short-lived authorized reads**, minted per request, not per object:
default 120 seconds, single-use, bound to the requesting user, the asset, and
the case. `Cache-Control: private, no-store` on every response.

### 4. Validation is on bytes, not on claims

Server-side, before the asset is usable:

- **Magic-byte signature** must match the declared type. `%PDF-`, `\xFF\xD8\xFF`,
  `\x89PNG\r\n\x1a\n`. A declared `image/png` whose body starts `MZ` is rejected.
- **Allowlist**, narrower than public media: PDF, JPEG, PNG only. No HEIC, no
  video, no SVG — SVG is a script-execution vector and has no place in evidence.
- **Hard size cap** enforced on the received bytes, not the declared size.
- **Double-extension and traversal rejection** on any client-supplied filename,
  which is stored as a display label only and never used to build a key.
- **`sha256`** computed server-side, for deduplication and tamper evidence.

### 5. Scan state gates the read, and quarantine holds rather than deletes

An asset is `PENDING` until a malware-scan adapter reports. `CLEAN` is the only
state a reviewer read will serve. `QUARANTINED` is terminal-but-retained: the
file is held, unreadable, and reported. Deleting it destroys the evidence of the
attack, and a provider who uploaded an infected file needs to be told something
truthful.

The adapter is a port with a no-op development implementation, exactly like
`MailPort` and `StoragePort`. A no-op scanner that reports `PENDING` (never
`CLEAN`) in production is the safe failure: unscanned evidence is unreadable
rather than trusted.

### 6. Upload completion is idempotent

The client calls `POST .../documents/{id}/complete` after the PUT. It may retry;
the network may duplicate it. Completion is keyed on the asset id and is a
conditional state write, so N completions produce one `CLEAN` transition, one
audit row, and one outbox event.

### 7. Nothing about the content is ever logged

No document bytes, no extracted identity numbers, no filenames from the wire, no
signed URLs, no tokens, no storage credentials. Logs carry ids and outcomes:
`{ msg, assetId, caseId, actorUserId, outcome }`. This is asserted by a test that
scans emitted log lines for the fixture's secret material.

## Alternatives rejected

**Reuse the public media route with unguessable keys.** Security by URL secrecy.
Keys leak through logs, referrers, and CDN caches, and `immutable` caching means
a leak is permanent. It also leaves no place to record a scan state.

**Store evidence in the database as bytes.** Removes the object-store surface,
but puts megabytes of PII in every backup and replica, and makes the deletion
guarantee harder rather than easier.

**One `visibility` boolean (`isPublic`).** Cannot express the reviewer-gated
case, so the check would move back into scattered call sites.

**Client-side encryption with a provider-held key.** Strong, and it makes review
impossible — a reviewer must be able to read the document. Revisit only if a
regulator requires it, which changes the review model too.

## Consequences

**Good** — restricted is a database fact, not a convention; the public route
cannot serve evidence even by mistake; validation is on bytes; retention and
deletion have somewhere to attach; the scan gate fails closed.

**Costs / risks**

- **A second read path to keep correct.** Mitigated by making it the only way to
  read a `RESTRICTED` asset and testing IDOR against it directly.
- **Short-lived reads mean a reviewer's open tab expires.** Deliberate. The UI
  re-mints on demand.
- **The scanner is a port with no production implementation yet.** Fails closed
  (`PENDING` is unreadable), and the remaining decision is recorded in the sprint
  report rather than hidden behind a permissive default.
- **`sha256` deduplication can reveal that two providers uploaded the same file.**
  That is a fraud signal we want, but it is a correlation surface; it is
  reviewer-visible only, never provider-visible.

## Revisit

- Per-object encryption keys, if evidence volume or regulation warrants it.
- Moving the scan to an async worker with an outbox event, once a real scanner
  is chosen — the port is already shaped for it.
