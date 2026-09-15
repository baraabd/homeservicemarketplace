# Protected identity inspection

The identity section of `/admin/providers/:providerProfileId` now opens a focus-contained
inspection dialog. The same section retains an explicit secure download action.
The dialog supports JPEG/PNG images and PDF pages, zoom, fit, rotation, keyboard
scrolling, Arabic/English and the existing Admin light/dark tokens.

## Read boundary and lifetime

- Opening a dialog starts a new authenticated request through the existing Axios client
  to `GET /v1/verification/documents/:id/content`. There is no preload or cached read.
- The existing server resolves current `verification:evidence:view` permission and
  ownership, enforces clean/live evidence, and persists the access audit before
  disclosing bytes. Its attachment, no-store, nosniff and non-enumerating denial headers
  remain unchanged. The viewer creates no signed URLs or public-media URLs.
- The preview hook keeps bytes only in mounted component state, outside query caches
  and browser storage. Closing, route unmount, loss of evidence access in refreshed
  metadata, and session-expiry events abort requests and release object URLs/PDF workers.
  A late response after closing cannot create a new object URL.
- A preview expires after five minutes. Reopening is an explicit new authorized read.
  This bounds retained bytes; it does not promise retroactive revocation of bytes that
  were already disclosed. The server rechecks access on every subsequent request.
- Unsupported/active MIME types are refused. Failures deliberately do not distinguish
  missing, deleted, quarantined or unauthorized documents.

## PDF rendering

`pdfjs-dist` 5.4.624 is pinned with its matching bundled worker. This is the newest
5.x version whose published Node engine supports the repository's Node 20.18 baseline
(`>=20.16.0 || >=22.3.0`). Mozilla's
[tagged build configuration](https://github.com/mozilla/pdf.js/blob/v5.4.624/gulpfile.mjs)
and registry metadata were checked. The known eval vulnerability was fixed in 4.2.67;
this adapter also sets `isEvalSupported: false`, as described in the
[maintainer advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq).

The application passes authenticated bytes to PDF.js and renders one canvas page at a
time. It does not instantiate a PDF viewer, links, annotations, interactive forms,
scripting, XFA, iframes, object elements or embed elements. External document/resource
URLs and request credentials are not passed to PDF.js; worker fetching and WASM are
disabled. Fonts render as paths without injecting a font face. The application's
existing `frame-src 'none'`, `object-src 'none'` and no-eval script policy remain intact.

Preview limits are 20 MiB, 100 PDF pages, 16 million pixels per PDF canvas/embedded image
and device-pixel ratio at most two. Only the current page has a visible canvas; old
renders are cancelled and cleared. Password-protected, malformed, resource-dependent
or oversized documents can fail preview while retaining the separately authorized
download option. Rendering a page does not extract or expose document text in DOM;
the page has a localized accessible label and controls, and download remains available.

## Verification scope

`ReviewIdentity.test.tsx` checks explicit reads, credentialed endpoint use, cache
exclusion, denial after reopening, active MIME refusal, permission changes, session
expiry, preview expiry, focus return, abort/late-response handling and object URL
release. `identity-pdf.test.ts` checks the byte-only parser configuration, cancellation
and page cap. Unit PDF tests use a parser mock; a real browser PDF render and the real
audited API path are separate acceptance checks and must be reported independently.
