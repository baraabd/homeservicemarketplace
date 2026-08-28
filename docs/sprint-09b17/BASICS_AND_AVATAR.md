# Sprint 9B.17 — Task 1: account type, basics, and a real profile photo

Behind `VITE_PROVIDER_ONBOARDING_V2`, still **default off**. With the flag off
nothing on this page is reachable and the Sprint 8 wizard is unchanged.

---

## 1. The defect this closes

The Sprint 8 wizard asked providers to paste an image **URL** into a text box.
That asks someone to host a photo somewhere else first, which is why the field
was almost always empty — and it accepted any string, including one pointing
into the restricted identity-evidence namespace.

Task 1 replaces it with a real upload, and adds the server-side checks that a
browser-direct upload otherwise has none of.

---

## 2. The upload pipeline, and why finalize exists

```
1. POST /v1/media/presigned-url { purpose: 'avatar' }   → key + signed PUT URL
2. PUT  <uploadUrl>                                      → bytes, straight to storage
3. POST /v1/me/provider/onboarding/avatar { key, version } → verified, then linked
```

**Stage 2 succeeding does not mean the photo is set.** With S3 the browser PUTs
directly to the bucket and the API never sees the body — at that moment the
server has verified nothing except a content type it agreed to minutes earlier.
Everything the client said is a claim.

Stage 3 replaces the claims with facts. It reads the object **back** from
storage and checks:

| Check                 | Against                      | Why                                                                                                                       |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| namespace + owner ref | recomputed HMAC              | an avatar pointing at evidence would publish a passport next to a name; a guessed key would adopt another provider's file |
| object exists         | storage                      | a dropped PUT must not leave a profile pointing at a 404                                                                  |
| size                  | what the **backend** counted | the declared size was a claim; this is the measurement                                                                    |
| leading bytes         | the key's own extension      | a file declared PNG that is not a PNG is a spoof or a corruption, and this URL is served publicly with a one-year cache   |

The UI mirrors this: `uploading` is not `saved`, and nothing reports success
until finalize returns.

### New infrastructure

`StoragePort` gained `readObjectHead(key, n)` and `publicUrlForKey(key)`,
implemented for both adapters — a ranged `GetObject` on S3 (one request answers
size _and_ bytes via `Content-Range`), an `open`+partial read on local disk.
Only the leading bytes are read: an avatar route that pulled whole objects into
memory would be a reachable memory-pressure lever and, on S3, an egress bill.

The body carries a **key, never a URL**. The URL is recomputed from a key the
server minted, so a caller cannot have us store a pointer to an object they do
not own.

---

## 3. Media purposes, after an audit

Existing purposes were `request` (job photos, `requests/<userId>/…`) and
`portfolio` (public gallery, `portfolio/<opaqueRef>/…`). Neither fits:

- `request` is job-scoped and its keys carry the raw user id;
- `portfolio` is the gallery — sharing it would put avatars inside portfolio
  limits and any future portfolio cleanup sweep.

So `avatar` is a **new purpose** with its own prefix and its own
**domain-separated** opaque owner ref (`avatar-owner:` vs `portfolio-owner:`),
so learning one namespace's ref does not hand over the other. An avatar URL is
handed to every customer who sees the provider, which is exactly why the raw
user id must not be in it.

Its allowlist is **narrower** than the platform's: JPEG, PNG, WebP only. No
GIF, no HEIC/HEIF, no SVG, no video — see `image-signature.ts` for each reason.

`image-signature.ts` is deliberately separate from the evidence detector: the
allowlists differ (evidence takes PDF and refuses WebP), and every future change
to the avatar list would otherwise edit a module on the passport path.

---

## 4. Restricted media cannot be an avatar

Enforced in three independent places, because one of them is a string check and
string checks are backstops, not authorization:

1. **presign** never mints a key outside `avatars/<ownerRef>/`;
2. **finalize** refuses the evidence prefix, a foreign owner ref, traversal and
   null bytes, before it touches storage;
3. **`patchStep`** now refuses any `profileImageUrl` referencing the
   `verification/` path segment — which also closes the hole on the **legacy**
   free-text field, where a provider could previously type one in.

The public read route already refused to _serve_ a restricted key. This is the
other half: never _stored_ either. A profile row pointing at somebody's passport
is a data-protection incident whether or not the bytes are ever fetched.

---

## 5. Phone: collected, format-checked, not blocked

`isPlausibleE164` is shared between the API and the form. It refuses a number
with no country code, letters, or a sentence containing a number; it accepts one
typed with spaces, because people type spaces.

It says the number is **shaped like** a phone number. It does not claim anyone
holds it — that is `phoneVerifiedAt`, which needs an SMS challenge nothing here
issues. 9B.13 already stopped submission demanding it; this sprint does not
reintroduce that, and does not set the column either. The form says so in as
many words, in both languages.

### One shared rule, two copies, and a test that keeps them honest

The web **cannot** import runtime values from `@homeservicemarketplace/contracts`:
it emits CommonJS for Nest, and a value import fails the production Rollup build
("not exported by dist/index.js"). This is documented in
`apps/web/src/lib/request-media/constants.ts`, and this sprint hit it.

So the rule lives in contracts (the API imports it) and is **mirrored** in
`apps/web/src/lib/provider/phone-format.ts`. `phone-format.test.ts` imports
**both** and asserts they agree on a table of inputs, so drift fails a test
rather than letting the form accept what the API rejects.

---

## 6. Client-side image processing, no new dependency

Rotate, centre-crop to a square, downscale to 512px, re-encode to JPEG — with a
canvas, which is what a cropping library would use and what the compression step
needs anyway. `createImageBitmap(..., { imageOrientation: 'from-image' })`
applies the EXIF orientation tag, which is what stops portrait phone photos
arriving sideways.

**None of it is validation.** It runs in a browser, where anything can be
replaced. It exists to make a good upload small and correctly oriented; the
server re-reads the stored object regardless.

The crop is centred rather than drag-to-position: an interactive cropper is a
gesture surface of its own that this release does not ship, and rotation covers
the case the centre gets wrong.

---

## 7. Changing provider type

Confirmed, never silent — individual and business are verified against different
documents. The dialog says what changes (**the requirements**) and what does
not: **nothing already sent is deleted**, and anything already reviewed stays on
the record. That is true because the server keeps evidence and decisions
regardless of type, so no destructive operation is involved and none is
implied. The radio does not move until the change is confirmed, which is what
makes "Keep it as it is" mean something.

The business name is not cleared on switching away. The completeness policy
simply stops asking for it; discarding what someone typed would lose it if they
switched back.

---

## 8. Evidence

| Gate                                   | Result                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `api` lint / typecheck / build         | pass                                                                                                         |
| `api` test                             | **2701 passed**, 477 DB/Redis-gated skips                                                                    |
| `web` lint / typecheck                 | 0 errors (32 pre-existing warnings, none in new files)                                                       |
| `web` unit (vitest)                    | **1064 passed** / 85 files                                                                                   |
| `web` e2e (Playwright ×3 viewports)    | **499 passed**                                                                                               |
| `pnpm audit --prod --audit-level high` | no known vulnerabilities                                                                                     |
| gitleaks                               | 11 findings: 10 pre-existing test fixtures, 1 in gitignored `.claude/settings.local.json`; none in new files |
| isolated Compose smoke                 | **29/29** assertions                                                                                         |
| `prisma validate`                      | valid — **no schema change, migration ledger untouched**                                                     |
| lockfile                               | unchanged (no new dependency)                                                                                |

The browser suite runs the **real canvas pipeline** against genuine PNG bytes —
decode, crop, re-encode, XHR upload with progress, finalize — at 320px and
430px, in EN/LTR and AR/RTL.

### Residual gap

The finalize endpoint is proven by unit tests, HTTP-surface tests and a
browser-level pipeline test against a stubbed transport. It has **not** been
exercised against a live API with a real provider account and real object
storage; that needs a seeded provider with the `provider` role, which the
Compose smoke does not currently create. The Compose gate does prove the
image builds, migrates, boots, and serves the existing media round trip.
