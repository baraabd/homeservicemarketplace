// Outbound storage boundary. The media controller depends on this port,
// not on a concrete adapter, so the same controller works against the
// local-disk dev backend and the production S3 backend without code
// change. Adapter selection is env-driven by StorageModule (mirrors the
// MailPort pattern in apps/api/src/infrastructure/mail/mail.port.ts).
//
// Object keys are server-generated. Callers MUST NOT supply or trust
// caller-provided keys — that's a path-traversal vector. The presign
// endpoint composes a key like `requests/<uuid>.<ext>` from the
// validated content-type, never from a filename the user typed.

import { ContentType } from './content-type';

/** What the controller asks for: a single file's metadata. */
export interface PresignUploadInput {
  /** Server-generated object key, e.g. `requests/abc123.jpg`. Must NOT
   *  contain `..`, leading `/`, or null bytes — the controller is
   *  responsible for synthesising it. */
  key: string;
  /** Whitelisted content type from `ContentType` (image/* | video/*). */
  contentType: ContentType;
  /** Cap-checked at the controller (≤ 10 MB). The PUT side enforces
   *  this — for S3 it's part of the signed payload, for the local
   *  adapter the upload route refuses bodies larger than this. */
  sizeBytes: number;
}

/** What the adapter returns to the controller, which forwards it
 *  verbatim to the frontend. */
export interface PresignedUpload {
  /** PUT-able URL the browser will upload the binary to. Time-bounded
   *  + tamper-resistant for both backends. */
  uploadUrl: string;
  /** Final canonical URL the seeker will write into
   *  ServiceRequest.mediaUrls[]. Stable for the lifetime of the
   *  uploaded object — adapters are responsible for guaranteeing
   *  read-after-write availability. */
  fileUrl: string;
  /** ISO timestamp at which the uploadUrl stops working. The frontend
   *  uses this to decide whether to retry the presign step. */
  expiresAt: string;
}

export interface StoredObjectHead {
  /** Byte length as STORED, counted by the backend rather than declared by
   *  anyone. */
  sizeBytes: number;
  /** The leading bytes, for signature detection. Short by design: nothing
   *  here needs the body, and streaming a 10 MB avatar into the API to look at
   *  twelve bytes would be a self-inflicted bandwidth bill. */
  head: Uint8Array;
}

export abstract class StoragePort {
  abstract presignUpload(input: PresignUploadInput): Promise<PresignedUpload>;

  /**
   * Read back an object's size and leading bytes, or null when it is not there.
   *
   * Sprint 9B.17. With a browser-direct upload the API never sees the body: the
   * PUT goes to S3, and the only thing that reached us was a claim about what
   * would be sent. This is the hook that lets a FINALIZE step check what
   * actually landed — the size the backend counted and the bytes themselves —
   * before anything links the object as a provider's avatar.
   *
   * Null rather than throwing for a missing key: "the client says it uploaded
   * something and there is nothing there" is an ordinary outcome of a dropped
   * PUT, not an exceptional one.
   */
  abstract readObjectHead(key: string, byteCount: number): Promise<StoredObjectHead | null>;

  /**
   * The canonical public read URL for a key.
   *
   * Sprint 9B.17. Presign already returns this alongside the upload URL, but a
   * finalize step must not take the client's word for what the URL was: that
   * would let a caller upload to their own key and then ask us to store a
   * pointer at somebody else's object. Recomputing from the key — which HAS
   * been checked for ownership — keeps the stored reference derived from the
   * thing we validated.
   */
  abstract publicUrlForKey(key: string): string;
}

/** DI token. Symbol so two unrelated modules can't accidentally bind
 *  the same string identifier. */
export const STORAGE_PORT = Symbol.for('HSM_STORAGE_PORT');
