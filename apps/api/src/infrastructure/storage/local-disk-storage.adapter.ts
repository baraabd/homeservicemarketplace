import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';

import { AppConfigService } from '../../config/app-config.service';
import { PresignUploadInput, PresignedUpload, StoragePort } from './storage.port';

// Local-disk dev backend. Used when STORAGE_DRIVER=local (the default).
// Issues a tamper-resistant presigned PUT URL pointing at the API's own
// /v1/media/uploads/:key route, which then validates the signature,
// content-type, and size before writing the binary to a gitignored
// .media-uploads/ directory under the repo root. The fileUrl points
// at /v1/media/files/:key — a public GET route the controller serves
// from the same directory.
//
// Threat model:
//   - Token tamper: HMAC-SHA256 over `<key>:<exp>:<contentType>:<sizeBytes>`,
//     timing-safe compared. Mutating any of those fields invalidates
//     the signature.
//   - Replay after expiry: `exp` is signed, the route compares it
//     against `Date.now()` and rejects stale tokens.
//   - Path traversal: the controller calls `validateKey()` (below)
//     to reject `..` segments / leading slashes / NUL / outside the
//     root.
//   - Content-type / size mismatch: the route compares the upload
//     headers + body length against the signed values.
//
// All three checks must pass before any byte hits disk.

const PRESIGN_TTL_SECONDS = 5 * 60; // 5 minutes — same window as S3

@Injectable()
export class LocalDiskStorageAdapter extends StoragePort {
  private readonly log = new Logger(LocalDiskStorageAdapter.name);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    const exp = Math.floor(Date.now() / 1000) + PRESIGN_TTL_SECONDS;
    const sig = signToken({
      secret: this.signingSecret(),
      key: input.key,
      exp,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
    const base = this.publicBaseUrl();
    const encodedKey = encodeKeyForUrl(input.key);
    const uploadUrl =
      `${base}/v1/media/uploads/${encodedKey}` +
      `?sig=${sig}` +
      `&exp=${exp}` +
      `&ct=${encodeURIComponent(input.contentType)}` +
      `&sz=${input.sizeBytes}`;
    const fileUrl = this.publicUrlForKey(input.key);
    return {
      uploadUrl,
      fileUrl,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /** The canonical public read URL. Shared with presign above so the two can
   *  never disagree about what a key resolves to. */
  publicUrlForKey(key: string): string {
    return `${this.publicBaseUrl()}/v1/media/files/${encodeKeyForUrl(key)}`;
  }

  // ─── Used by the media controller's PUT handler ────────────────────────

  /** Verify the request matches the signed token, then write the body
   *  to disk under the configured root. Resolves to the on-disk
   *  absolute path; throws AppError-wrapped failures so the
   *  controller can surface them as typed HTTP errors.
   *
   *  Returns void — the caller's job is to map exceptions to wire
   *  errors. We intentionally don't return the disk path so the
   *  controller can't accidentally leak it. */
  async acceptUpload(args: {
    key: string;
    sig: string;
    exp: number;
    contentType: string;
    sizeBytes: number;
    body: Buffer;
    actualContentType: string | null;
  }): Promise<void> {
    if (!Number.isFinite(args.exp) || args.exp * 1000 < Date.now()) {
      throw new Error('expired');
    }
    if (args.actualContentType && args.actualContentType !== args.contentType) {
      throw new Error('content-type-mismatch');
    }
    if (args.body.byteLength !== args.sizeBytes) {
      throw new Error('size-mismatch');
    }
    const expected = signToken({
      secret: this.signingSecret(),
      key: args.key,
      exp: args.exp,
      contentType: args.contentType,
      sizeBytes: args.sizeBytes,
    });
    if (!timingSafeStringEquals(expected, args.sig)) {
      throw new Error('signature-mismatch');
    }
    const abs = this.absolutePathForKey(args.key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, args.body);
    this.log.log({ msg: 'storage.local.write', key: args.key, bytes: args.body.byteLength });
  }

  /** Resolve a key to its on-disk absolute path. Validates the key
   *  (no traversal, no NUL) and ensures the resolved path stays under
   *  the configured root — defence in depth even after `validateKey`. */
  absolutePathForKey(key: string): string {
    validateKey(key);
    const root = this.rootDir();
    const joined = normalize(join(root, key));
    if (!joined.startsWith(root + sep) && joined !== root) {
      throw new Error('path-escape');
    }
    return joined;
  }

  /**
   * Sprint 9B.17 — size and leading bytes, for the avatar finalize check.
   *
   * Opens and reads only `byteCount` bytes rather than loading the file: the
   * caller wants a signature, and an avatar route that read whole files into
   * memory would be a trivially reachable memory-pressure lever.
   */
  async readObjectHead(
    key: string,
    byteCount: number,
  ): Promise<{ sizeBytes: number; head: Uint8Array } | null> {
    let abs: string;
    try {
      abs = this.absolutePathForKey(key);
    } catch {
      // An invalid or escaping key is "not there" as far as a caller is
      // concerned. Distinguishing the two would tell a prober which of their
      // guesses was structurally valid.
      return null;
    }

    let handle;
    try {
      // OPEN FIRST, then fstat the descriptor.
      //
      // The obvious order — stat(path) to check it is a file, then open(path)
      // — is a time-of-check/time-of-use race: between the two calls the path
      // can be replaced, so the thing described is not necessarily the thing
      // read. That matters here because this measurement is an authorization
      // input: finalize decides whether to publish an object based on the size
      // and leading bytes this returns, and a swapped path would let it
      // approve one file and link another.
      //
      // Opening once and asking the HANDLE removes the window entirely: the
      // stat and the read describe the same file description, whatever
      // happened to the name in between.
      handle = await open(abs, 'r');
      const stats = await handle.stat();
      // A directory opens happily on POSIX; only the fstat says what it is.
      if (!stats.isFile()) return null;

      const buffer = Buffer.alloc(Math.max(0, byteCount));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      return { sizeBytes: stats.size, head: new Uint8Array(buffer.subarray(0, bytesRead)) };
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  /** True iff the key's underlying file is readable on disk. Used by
   *  the GET /v1/media/files/:key route. */
  async fileExists(key: string): Promise<boolean> {
    try {
      const abs = this.absolutePathForKey(key);
      const s = await stat(abs);
      return s.isFile();
    } catch {
      return false;
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private signingSecret(): string {
    // Dedicated secret when configured; fall back to JWT_ACCESS_SECRET
    // so dev shells without a new env var still produce signed URLs.
    // The two contexts (JWT vs media tokens) sign different payload
    // shapes so cross-use isn't a vector even with a shared secret.
    const dedicated = this.config.get('MEDIA_SIGNING_SECRET');
    if (dedicated && dedicated.length > 0) return dedicated;
    return this.config.get('JWT_ACCESS_SECRET');
  }

  private publicBaseUrl(): string {
    const env = this.config.get('PUBLIC_API_URL');
    if (env && env.length > 0) return env.replace(/\/+$/, '');
    return `http://localhost:${this.config.get('PORT')}`;
  }

  private rootDir(): string {
    const configured = this.config.get('LOCAL_STORAGE_DIR');
    if (configured && configured.length > 0) return normalize(configured);
    // Default: <repo>/.media-uploads — gitignored, recreated on demand.
    return normalize(join(process.cwd(), '.media-uploads'));
  }
}

// ─── Pure helpers (unit-testable, no I/O) ───────────────────────────────

interface SignArgs {
  secret: string;
  key: string;
  exp: number;
  contentType: string;
  sizeBytes: number;
}

export function signToken(args: SignArgs): string {
  const payload = `${args.key}:${args.exp}:${args.contentType}:${args.sizeBytes}`;
  return createHmac('sha256', args.secret).update(payload).digest('hex');
}

/** Constant-time string comparison. `timingSafeEqual` requires equal
 *  lengths; we early-return false on mismatch to keep the contract
 *  intuitive. */
function timingSafeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Reject keys that could escape the storage root, hide their nature
 *  in null-byte truncation tricks, or are simply invalid. Throws so a
 *  bad key never silently produces a sensible-looking path. */
export function validateKey(key: string): void {
  if (!key || typeof key !== 'string') throw new Error('invalid-key');
  if (key.length > 200) throw new Error('invalid-key');
  if (key.includes('\0')) throw new Error('invalid-key');
  if (key.startsWith('/') || key.startsWith('\\')) throw new Error('invalid-key');
  // Block `..` segments anywhere in the path — also catches the
  // already-decoded `%2e%2e` that Express would have URL-decoded
  // before routing.
  const parts = key.split(/[\\/]/);
  for (const p of parts) {
    if (p === '..' || p === '.') throw new Error('invalid-key');
  }
  // Restrict charset to a portable subset: alnum, dash, underscore,
  // dot, slash. Stricter than POSIX filename rules and avoids cross-
  // platform footguns (Windows reserved chars, etc.).
  if (!/^[A-Za-z0-9._/-]+$/.test(key)) throw new Error('invalid-key');
}

function encodeKeyForUrl(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i === -1 ? '.' : p.slice(0, i);
}
