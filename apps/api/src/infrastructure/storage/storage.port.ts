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

  /**
   * Remove one object. Idempotent.
   *
   * Sprint 09B.29 Phase 4 — the public side had no way to delete anything.
   * `RestrictedObjectStorage` has had `deleteObject` since Sprint 9B, and
   * `EvidenceCleanupService` uses it; public media had no equivalent, so an
   * avatar or portfolio object that was replaced, removed, or uploaded and
   * then abandoned stayed in the bucket for ever.
   *
   * IDEMPOTENT BY CONTRACT, and that is load-bearing rather than a
   * convenience. The cleanup worker deletes the object BEFORE it records the
   * deletion, so a crash between the two leaves an object that is already gone
   * and a row that still asks for it to go. The next pass must treat that as
   * success or the row can never be retired.
   *
   * "Already absent" is therefore success. Everything else — denied, refused,
   * unreachable — is a failure, and must stay a failure: swallowing a
   * permission error would let the worker write `deletedAt` for bytes that are
   * still publicly readable, which is the exact lie this subsystem exists to
   * stop telling.
   *
   * Deliberately NOT on this port: list, and delete-by-prefix. A sweep that
   * enumerates a bucket derives ownership from a key string; ownership here
   * comes from `MediaAsset.ownerUserId`, and a prefix scan would be a second
   * answer to a question that must only have one.
   */
  abstract deleteObject(key: string): Promise<void>;
}

/** DI token. Symbol so two unrelated modules can't accidentally bind
 *  the same string identifier. */
export const STORAGE_PORT = Symbol.for('HSM_STORAGE_PORT');
