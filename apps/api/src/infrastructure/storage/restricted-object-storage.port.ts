import type { Readable } from 'node:stream';

// Sprint 9B.3 — the server-side object boundary for RESTRICTED evidence.
//
// docs/adr/0009-restricted-identity-media.md
//
// WHY A SECOND PORT RATHER THAN EXTENDING StoragePort
//
// StoragePort is the PUBLIC media boundary. Its whole shape is browser-direct:
// `presignUpload` returns a `uploadUrl` the browser PUTs to and a `fileUrl`
// that is served publicly, cached `immutable`. Every method on it hands a URL
// to a client.
//
// Restricted evidence must never produce a URL of any kind — not a public one,
// not a presigned one, not a short-lived one. A reviewer reads a passport by
// asking the API, which authorises the read against the database, audits it,
// and streams the bytes itself. Adding server-side read/delete to StoragePort
// would put those operations one autocomplete away from the public media
// controller, and would invite exactly the "just presign it" shortcut this
// design exists to prevent.
//
// So: a separate, narrow port with NO URL-returning method at all. That is a
// structural guarantee rather than a convention — a caller cannot leak a
// signed URL for evidence because there is no method that could produce one.
//
// THE DEFECT THIS REPLACES
//
// Sprint 9A's evidence-read.controller injected LocalDiskStorageAdapter
// directly and called `absolutePathForKey()` + `createReadStream()`. That works
// on a developer laptop and fails outright when STORAGE_DRIVER=s3, because
// there is no local path for an object that lives in a bucket. Restricted
// evidence reads were therefore broken in any production configuration. This
// port is what makes both backends work through one interface.

/** Trusted, server-observed metadata. Never client-supplied. */
export interface RestrictedObjectMetadata {
  /** Length as the BACKEND reports it, used to detect truncation. */
  sizeBytes: number;
}

/**
 * Server-side object operations for restricted evidence.
 *
 * Keys are always server-generated (see evidence-keys.ts). No method accepts a
 * client-supplied path, and no method returns one.
 */
export abstract class RestrictedObjectStoragePort {
  /**
   * Write an object from a file already staged on local disk.
   *
   * Takes a PATH rather than a Buffer deliberately: the ceiling is 10 MiB by
   * default but configurable, and buffering a whole maximum-sized upload per
   * concurrent request is an avoidable memory cliff. The caller streams the
   * request body to a staging file under a hard byte cap, then hands that file
   * here, so memory stays O(chunk) whichever backend is configured.
   */
  abstract putObjectFromFile(input: {
    key: string;
    sourcePath: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<void>;

  /**
   * Open an authorised server-side read stream.
   *
   * The CALLER has already authorised this read against the database and
   * audited it. This method does no authorisation of its own — it is the
   * transport, not the policy — which is why it is not reachable from any
   * public route.
   */
  abstract openReadStream(key: string): Promise<Readable>;

  /** Trusted metadata, or null when the object does not exist. Never throws
   *  for absence: "missing" is an ordinary answer during finalize. */
  abstract head(key: string): Promise<RestrictedObjectMetadata | null>;

  /**
   * Delete an object.
   *
   * IDEMPOTENT: deleting something already gone is a success, not an error.
   * Cleanup runs on failure paths and after partial writes, where "it was
   * never created" and "it is now removed" are the same desired end state.
   */
  abstract deleteObject(key: string): Promise<void>;
}

/** DI token. A Symbol so two unrelated modules cannot accidentally bind the
 *  same string identifier — and so this can never be confused with
 *  STORAGE_PORT, which is the public boundary. */
export const RESTRICTED_OBJECT_STORAGE = Symbol.for('HSM_RESTRICTED_OBJECT_STORAGE');
