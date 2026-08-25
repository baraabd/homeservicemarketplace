# Sprint 9B.3 — Restricted evidence upload lifecycle

How a provider's identity document gets into this system, who can read it back,
and what happens to it when nobody ever comes back for it.

Related: `docs/adr/0009-restricted-identity-media.md` (restricted media),
`docs/adr/0010-policy-versioned-verification.md` (policy versioning),
`docs/adr/0012-evidence-retention-and-deletion.md` (retention).

---

## 1. Why this is not the media pipeline

The platform already had an upload path: presign a URL, PUT the bytes, GET them
back. It is the right design for a job photo and the wrong one for a passport,
for one reason — it produces a **URL**. A URL is a bearer token that travels: it
lands in browser history, in a referrer header, in a screenshot, in a support
ticket. For a photo of a leaking tap that is acceptable. For a government ID it
is not.

So restricted evidence gets its own port whose API makes the unsafe thing
impossible to express rather than merely discouraged.

---

## 2. Storage architecture

### The port

`src/infrastructure/storage/restricted-object-storage.port.ts`

```
putObjectFromFile(key, path, contentType)   // stage then promote
openReadStream(key)                         // bytes, server-side only
head(key)                                   // existence + size, no body
deleteObject(key)                           // idempotent
```

Injected by `RESTRICTED_OBJECT_STORAGE`.

**There is deliberately no method that returns a URL.** This is the whole point
of a second port rather than extra methods on `StoragePort`: `StoragePort`
exists to mint browser-reachable URLs, and any method added there would
eventually be called for evidence. A port that cannot express a URL cannot leak
one, and a future contributor cannot add one by accident — they would have to
add the method, and the architecture test would ask why.

### Two backends, one contract

|                          | Local (`STORAGE_DRIVER=local`)                 | S3 (`STORAGE_DRIVER=s3`)      |
| ------------------------ | ---------------------------------------------- | ----------------------------- |
| root                     | `.restricted-uploads`                          | `S3_RESTRICTED_BUCKET`        |
| relation to public media | **sibling of** `.media-uploads`, never a child | separate bucket, not a prefix |
| errors                   | mapped to `restricted-storage-unavailable`     | same                          |

Both are exercised by the **same** contract suite, which is how the S3 adapter's
two real defects were caught before it ever ran in anger: `head()` swallowing an
invalid-key error, and raw AWS errors carrying the bucket name and an
`AKIA…` credential fragment into the log.

The separate root matters. A child directory is one misconfigured static-file
mapping away from being served; a sibling is not.

### The 9A defect this replaces

`evidence-read.controller` used to inject `LocalDiskStorageAdapter` directly and
call `absolutePathForKey()`. That is a production defect, not a style problem:
under `STORAGE_DRIVER=s3` there is no local path and the read route fails. It is
fixed, and an **architecture test fails the build** if any file under
`modules/provider/verification` imports the local adapter again.

---

## 3. The upload sequence

```
POST /v1/me/provider/verification/evidence/prepare
        -> { assetId, uploadExpiresAt }         MediaAsset row, scanState=PENDING
PUT  /v1/me/provider/verification/evidence/:id/content
        -> streams bytes, validates, promotes into restricted storage
POST /v1/me/provider/verification/evidence/:id/finalize
        -> VerificationDocument row; asset uploadCompletedAt set
```

Three calls rather than one because each answers a different question, and
collapsing them would mean deciding whether a document is allowed _after_
its bytes are already on disk.

### prepare

Checks ownership, the case state, and the requirement rules from the case's
**policy snapshot** — the kind must be required, `CATEGORY_LICENSE` must carry a
category the requirements name, and a category on a kind that does not use one is
refused. A declared size over the ceiling is refused here, before a single byte
moves.

Idempotent: a retried request with the same idempotency key returns the same
preparation. Two concurrent prepares produce exactly one, enforced in the
database by `media_asset_one_open_preparation_per_slot_uniq`, not by a check
that races.

### content

`express.json()` only parses JSON, so a binary body arrives as an unconsumed
stream — this is a **real** stream, not a buffer with extra steps.

- A `Transform` meter counts bytes and aborts the moment the cap is exceeded, so
  a caller cannot spend the server's memory by lying in `Content-Length`.
- Bytes land in a `mkdtemp` staging file, so peak memory is O(chunk), never
  O(file). A maximum-sized upload never sits in the heap.
- **Magic bytes decide the type, not the caller.** An `.exe` renamed to `.pdf`
  and declared as one is refused; SVG is refused even when the bytes are valid
  SVG, because SVG is a script container.
- The **counted** size is recorded, not the declared one.
- Filenames are sanitised for traversal, double extensions, and the
  right-to-left override (U+202E) that reverses the tail of a name so that
  an executable renders as though it ended in `.png`. The character is not
  reproduced here on purpose: a literal bidi control in a source file is the
  very trick being described.

Only after all of that is the staged file promoted into restricted storage.
**If validation rejects the bytes, no object is left behind.**

### finalize

Ordered checks, and the order is the design:

```
deleted -> already finalized -> inconsistent -> expired -> object missing
```

"Already finalized" must be answered before "expired", or a replayed finalize
arriving a second late would report the wrong reason for a request that actually
succeeded.

Idempotent; two concurrent finalizes create exactly one document. A new document
in the same slot **supersedes** its predecessor rather than deleting it —
retention owns deletion, not the upload path.

---

## 4. Scan state

A newly uploaded object is **`PENDING`**, never `QUARANTINED`.

`QUARANTINED` means "failed scanning" and carries the longest retention as
attack evidence. Stamping it on an unscanned file fabricates a verdict and holds
an innocent provider's passport under the malware policy. `PENDING` already
delivers the guarantee, because the read policy admits **only** `CLEAN`.

Sprint 9B.4 owns the scanner and the `PENDING -> CLEAN | QUARANTINED |
SCAN_FAILED` transition. This sprint owns everything on either side of it.

---

## 5. Authorization and the read route

`GET /v1/verification/documents/:id/content`

Allowed only when **all** hold:

1. `scanState === 'CLEAN'` — compared against CLEAN, not against a list of bad
   states, so a state added later fails closed by default;
2. the caller is the owning provider, **or** holds `verification:evidence:view`;
3. the document is not deleted.

`verification:evidence:view` is deliberately narrower than "is an admin". Every
admin being able to open every passport makes the access audit meaningless.
Permission is resolved **per request**, so a revocation takes effect on the next
call rather than at the next restart.

Responses carry `no-store` and `nosniff`, never a public cache header, and serve
the **detected** content type rather than the declared one.

### Non-enumeration

Every denial that could reveal existence returns **404**:

| situation                                            | status |
| ---------------------------------------------------- | ------ |
| document does not exist                              | 404    |
| exists, belongs to another provider                  | 404    |
| exists, caller lacks the permission                  | 404    |
| exists, is `PENDING` / `QUARANTINED` / `SCAN_FAILED` | 404    |
| no credentials at all                                | 403    |

A 403 for "exists but forbidden" and a 404 for "no such document" would turn the
route into an oracle: a caller could enumerate which document ids are real. The
unauthenticated case is 403 because it reveals nothing — it is refused before
any lookup happens.

---

## 6. Temporary objects, cleanup, and compensation

Two halves, because one cannot cover the other.

**In-request compensation.** If the object lands and the row write then fails,
the object is deleted before the error surfaces. Nothing is left orphaned by a
failure the request itself can observe.

**The periodic sweep** (`EvidenceCleanupService`) handles what no request can:
the client that simply never came back.

- Only expired, never-finalized, not-deleted preparations, and only after
  `CLEANUP_GRACE_SECONDS = 300`. A finalize that passed the expiry check
  microseconds before it lapsed is still doing a `head()` and a database write;
  sweeping at the instant of expiry would delete the object underneath it.
- **The object is deleted first, then the row is marked.** Marking first
  produces rows claiming a deletion that never happened — and those rows are
  what a data-protection answer would later be built from. The cost of this
  order is an object that may be deleted twice (harmless, `deleteObject` is
  idempotent) rather than a row that lies.
- The row claim is conditional (`updateMany` on `deletedAt: null,
uploadCompletedAt: null`), so two concurrent sweeps delete once and report
  once.
- Bounded batches (default 100, max 500). A storage failure leaves the row alone
  for the next run rather than marking it deleted.
- **No HTTP route.** A route that deletes evidence in bulk is a weapon; it is
  invoked by an operator process or scheduler.

Refusals are explicit: finalized documents, already-deleted rows, rows with no
recorded expiry, `PUBLIC` assets, and assets belonging to another case are all
left untouched.

---

## 7. Audit and PII

Access is recorded for **both** allowed and denied reads — a denial is the more
interesting half of an access log.

What audit rows and logs must **never** contain, all asserted by tests:

- storage keys, bucket names, absolute paths
- original filenames
- content hashes
- document bytes
- full IP addresses or raw user agents
- signed URLs, credentials, bearer tokens, JWTs, `AKIA…` identifiers, PEM blocks

The log gate is separate from the audit gate on purpose: audit rows are a sink
this system writes **on purpose**, logs are the sink it writes **by accident**.
Logs also travel further — stdout, a shipper, an index searchable by far more
people than could ever call the read route.

The sweep logs counts only. It exists to show it is alive, not to become a
record of whose identity document was destroyed.

---

## 8. Threat model — before and after

| #   | Threat                                      | Before 9B.3                                 | After                                                       |
| --- | ------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| T1  | Evidence reachable by URL                   | public media pipeline mints URLs            | port cannot express a URL                                   |
| T2  | Read path broken under S3                   | `LocalDiskStorageAdapter` injected directly | port + two adapters; architecture test forbids regression   |
| T3  | Unscanned malware served                    | no upload path existed                      | only `CLEAN` is readable                                    |
| T4  | Cross-provider read (IDOR)                  | —                                           | server-side ownership check, 404                            |
| T5  | Document-id enumeration                     | —                                           | every existence-revealing denial is 404                     |
| T6  | Executable disguised as a document          | —                                           | magic-byte validation; SVG refused outright                 |
| T7  | Memory exhaustion via large upload          | —                                           | streaming + `Transform` cap + staging file                  |
| T8  | Lying `Content-Length`                      | —                                           | counted size wins over the declaration                      |
| T9  | Filename traversal / RTL-override spoofing  | —                                           | sanitised, key unaffected                                   |
| T10 | Orphaned identity bytes                     | —                                           | in-request compensation + bounded sweep                     |
| T11 | Rows claiming deletions that never happened | —                                           | delete object first, then mark                              |
| T12 | PII in logs                                 | —                                           | log-hygiene gate over success **and** failure paths         |
| T13 | Credential leak via raw storage errors      | S3 errors carried bucket + `AKIA…`          | mapped to `restricted-storage-unavailable`, `err.name` only |
| T14 | Every admin can read every passport         | —                                           | narrow `verification:evidence:view`, resolved per request   |

---

## 9. Tests mapped to threats

| Suite                                        | Tests | Covers                           |
| -------------------------------------------- | ----- | -------------------------------- |
| `evidence-upload.integration.spec.ts`        | 40    | T4, T5, T6, T7, T8, T9, T10      |
| `evidence-read-boundary.integration.spec.ts` | 17    | T3, T4, T5, T14                  |
| `evidence-cleanup.integration.spec.ts`       | 14    | T10, T11                         |
| `evidence-log-hygiene.integration.spec.ts`   | 7     | T12, T13                         |
| storage contract suite (both backends)       | 25    | T1, T2, T13                      |
| `evidence-upload-policy.spec.ts`             | 31    | scan-state and finalize ordering |
| architecture test                            | 1     | T2 regression guard              |

The log-hygiene suite carries a **tripwire**: it plants a known string through
the same logger and requires the scan to find it. Without that, every assertion
in it would pass equally well if the capture were silently broken — a hygiene
gate that cannot fail is worse than none, because it gets believed.

---

## 10. Sprint 9B.4 — what the scanner owns

Explicitly **not** implemented here:

- the scanner itself and its engine
- the `PENDING -> CLEAN | QUARANTINED | SCAN_FAILED` transition
- quarantine retention and the operator surface for it
- any notification about a scan verdict

This sprint provides the boundary the scanner plugs into: a stable
`scanState`, storage it can read through the port, and a read route that
already refuses everything it has not blessed.

---

## 11. Rollback

Ordered so no step depends on a later one:

1. **Routes.** Remove the three upload routes and the read route. No other
   feature calls them; provider verification degrades to "no evidence
   uploadable", which is the pre-9B.3 state.
2. **Sweep.** Stop invoking `sweepExpiredPreparations`. It has no HTTP surface,
   so this is a scheduler change; abandoned objects accumulate rather than
   anything breaking.
3. **Data.** Leave it. `MediaAsset` rows with `visibility=RESTRICTED` and the
   `VerificationDocument` rows are inert once the routes are gone.
4. **Migrations.** The four migrations are **forward-only and additive**
   (columns plus three partial unique indexes). Rolling the code back does not
   require rolling the schema back, and it should not be: dropping
   `verification_case_one_active_per_provider_uniq` would silently re-admit the
   duplicate-active-case state it exists to prevent.

The one irreversible action in the whole feature is the sweep's object deletion,
which is why it refuses whenever it is unsure.
