import { api } from '../../../../lib/api';

// Sprint 9B.12 — opening a restricted identity document.
//
// docs/sprint-09b12/ADMIN_VERIFICATION_UX.md
//
// The bytes come from GET /v1/verification/documents/:id/content, which is the
// ONLY route that serves restricted evidence (docs/adr/0009 §3). It streams
// through the API rather than redirecting to a signed object-store URL, and
// every read is authorized per request and written to the access audit.
//
// Two consequences shape this module:
//
//   1. The request must carry the session, so it goes through `api`
//      (withCredentials) rather than a bare <a href>. A plain link would also
//      work today, but it would break the moment the API moves to a different
//      origin with stricter SameSite, and it puts the document URL into browser
//      history where the next person at the machine finds it.
//
//   2. The response is `Content-Disposition: attachment` with `no-store`. It is
//      NOT rendered inline: a document is inspected in the reviewer's own
//      viewer, not in a tab inside our origin where an active-content payload
//      would run with our cookies. So this hands the browser a blob and lets it
//      save the file — it deliberately does not build a preview surface.
//
// The object URL is revoked once the click has been dispatched. Holding one
// open keeps the decrypted bytes alive in the page for as long as the tab
// lives, which is exactly the lifetime the streaming design was chosen to avoid.

/** Pull the filename the server chose out of Content-Disposition.
 *
 *  Server-side it was already sanitised on the way IN (directory components
 *  stripped, double extensions defused, bidi overrides removed) and re-escaped
 *  on the way out. This is a LABEL for the download, never a path: the browser
 *  sanitises `download` again, and a miss simply falls back to the document id. */
export function filenameFromDisposition(header: string | undefined): string | null {
  if (!header) return null;
  // RFC 5987 form first — it is the one that survives non-ASCII names.
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      const decoded = decodeURIComponent(encoded[1]).trim();
      if (decoded) return decoded;
    } catch {
      // A malformed escape is not worth failing a download over.
    }
  }
  const plain = /filename="([^"]*)"/i.exec(header);
  const value = plain?.[1]?.trim();
  return value ? value : null;
}

/**
 * Fetch one restricted document and hand it to the browser to save.
 *
 * Rejects with the axios error so the caller can tell a 403 (this reviewer may
 * not open evidence — a narrower permission than "is an admin") from a 404
 * (which the server also returns for a denial, on purpose, so it leaks nothing
 * about whether the document exists).
 */
export async function downloadEvidenceDocument(documentId: string): Promise<void> {
  const res = await api.get<Blob>(
    `/v1/verification/documents/${encodeURIComponent(documentId)}/content`,
    { responseType: 'blob' },
  );

  const disposition = (res.headers as Record<string, unknown>)?.['content-disposition'];
  const filename =
    filenameFromDisposition(typeof disposition === 'string' ? disposition : undefined) ??
    documentId;

  const url = URL.createObjectURL(res.data);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoked on the next task, not inline: a synchronous revoke can cancel a
    // download that the browser has not finished handing off. One task later
    // the bytes are still released long before the reviewer looks at them.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
