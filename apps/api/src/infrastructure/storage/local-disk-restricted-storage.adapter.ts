import { Injectable, Logger } from '@nestjs/common';
import { copyFile, link, mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type { Readable } from 'node:stream';

import { AppConfigService } from '../../config/app-config.service';
import {
  RestrictedObjectStoragePort,
  RestrictedObjectAlreadyExistsError,
  RestrictedObjectIntegrityError,
  type RestrictedObjectMetadata,
  type RestrictedErasureReceipt,
  type RestrictedReadExpectation,
} from './restricted-object-storage.port';
import { validateKey } from './local-disk-storage.adapter';
import { keyFingerprint, storageFaultEvent } from './storage-diagnostics';
import {
  assertMarkerNamespace,
  ensureLocalRootMarker,
  isDirectory,
  readLocalRootMarker,
  resolveLocalRoot,
  type ResolvedLocalRoot,
} from './storage-root';

// Sprint 9B.3 — restricted evidence on local disk. Development and tests.
//
// A SEPARATE ROOT from public media, not a subdirectory of it. ADR 0009 asks
// for the public/restricted split to be enforced twice — by configuration and
// by code — and a shared root would leave only the code half. If the public
// serve route ever loses its `isRestrictedKey` check, a separate root means it
// still cannot resolve a passport, because the bytes are not under the
// directory it serves from.

@Injectable()
export class LocalDiskRestrictedStorageAdapter extends RestrictedObjectStoragePort {
  private readonly log = new Logger(LocalDiskRestrictedStorageAdapter.name);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async putObjectFromFile(input: {
    key: string;
    sourcePath: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<void> {
    const target = this.absolutePathForKey(input.key);
    // R20 — claim (or confirm) this root as RESTRICTED before the first byte.
    // A root already marked public refuses: evidence must never share it.
    await ensureLocalRootMarker(this.rootDir(), 'restricted');
    await mkdir(dirname(target), { recursive: true });

    // A hard link publishes complete bytes atomically AND refuses an existing
    // key. rename() overwrites, allowing a slow concurrent PUT to replace an
    // already-finalized, scanned document. For separate filesystems, copy into
    // a private staging directory on the destination mount before linking.
    let destinationStage: string | undefined;
    try {
      try {
        await link(input.sourcePath, target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
        destinationStage = await mkdtemp(join(dirname(target), '.evidence-stage-'));
        const completeCopy = join(destinationStage, 'complete.bin');
        await copyFile(input.sourcePath, completeCopy);
        await link(completeCopy, target);
      }
      await rm(input.sourcePath, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') {
        throw new RestrictedObjectAlreadyExistsError();
      }
      throw err;
    } finally {
      if (destinationStage) await rm(destinationStage, { recursive: true, force: true });
    }

    // Size only. No key, no filename, no content.
    this.log.log({ msg: 'restricted.storage.put', bytes: input.sizeBytes });
  }

  async openReadStream(key: string, expected?: RestrictedReadExpectation): Promise<Readable> {
    const abs = this.absolutePathForKey(key);
    // Open, then fstat the DESCRIPTOR, so a missing object is an ordinary error
    // here rather than an async 'error' event the caller has already started
    // piping — and so the size checked below is the size of the bytes streamed.
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(abs, 'r');
      const stats = await handle.stat();
      if (!stats.isFile()) throw Object.assign(new Error('not-a-file'), { code: 'ENOENT' });
      if (expected && stats.size !== expected.sizeBytes) {
        this.log.error({
          msg: 'storage.integrity_mismatch',
          namespace: 'restricted',
          keyFp: keyFingerprint(key),
        });
        throw new RestrictedObjectIntegrityError();
      }
      return handle.createReadStream();
    } catch (err) {
      await handle?.close().catch(() => undefined);
      if (err instanceof RestrictedObjectIntegrityError) throw err;
      this.log.warn(storageFaultEvent({ operation: 'read', namespace: 'restricted', key, err }));
      // eslint-disable-next-line preserve-caught-error -- Privacy boundary: fs causes contain restricted object paths.
      throw new Error('restricted-storage-unavailable');
    }
  }

  async head(key: string): Promise<RestrictedObjectMetadata | null> {
    // Resolve OUTSIDE the try. An invalid or traversing key is a programming
    // error and must throw; only a genuinely absent object answers null.
    // Swallowing both made a traversal attempt indistinguishable from "not
    // found" here while the S3 adapter rejected it — exactly the divergence
    // one shared contract exists to catch.
    const abs = this.absolutePathForKey(key);
    try {
      const s = await stat(abs);
      if (!s.isFile()) throw new Error('restricted-storage-unavailable');
      return { sizeBytes: s.size };
    } catch (error) {
      // R20 — Windows reports ENOENT (not ENOTDIR) when an ancestor of the
      // path is a regular FILE. That is a damaged root, not an absent object,
      // and reading it as absence would let erasure certify bytes it never
      // looked for. Absence counts only when the nearest existing ancestor is
      // a directory.
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' &&
        (await nearestExistingAncestorIsDirectory(abs, this.rootDir()))
      )
        return null;
      // eslint-disable-next-line preserve-caught-error -- Privacy boundary: fs causes contain restricted object paths.
      throw new Error('restricted-storage-unavailable');
    }
  }

  async eraseObject(key: string): Promise<RestrictedErasureReceipt> {
    if (!key.startsWith('verification/')) throw new Error('restricted-erasure-invalid-namespace');
    try {
      // R20 — absence is only evidence of erasure in the root the evidence was
      // WRITTEN to. A worker resolving a different root (another cwd, a typo'd
      // RESTRICTED_STORAGE_DIR) would otherwise certify every object absent.
      await this.assertProvisionedRestrictedRoot();
      await this.deleteObject(key);
      if (await this.head(key)) throw new Error('restricted-erasure-incomplete');
      return { scope: 'PRIMARY_OBJECT_AND_VERSIONS', verifiedAbsent: true };
    } catch {
      throw new Error('restricted-erasure-unconfirmed');
    }
  }

  async deleteObject(key: string): Promise<void> {
    // `force: true` makes absence a success — cleanup runs on failure paths
    // where "never created" and "now removed" are the same end state.
    await rm(this.absolutePathForKey(key), { force: true });
    this.log.log({ msg: 'restricted.storage.delete' });
  }

  /** Resolve a key under the RESTRICTED root, refusing traversal. Exported
   *  behaviour is identical to the public adapter's, deliberately: one
   *  key-validation rule, not two that can drift. */
  private absolutePathForKey(key: string): string {
    validateKey(key);
    const root = this.rootDir();
    const joined = normalize(join(root, key));
    if (!joined.startsWith(root + sep) && joined !== root) {
      throw new Error('path-escape');
    }
    return joined;
  }

  /**
   * The root id this process resolves, for diagnostics: two processes that
   * report the same id are reading and erasing the same evidence. Null when
   * the root has never been written.
   */
  async describeRoot(): Promise<{ rootId: string | null; source: ResolvedLocalRoot['source'] }> {
    const resolved = this.resolvedRoot();
    const marker = await readLocalRootMarker(resolved.path);
    if (marker) assertMarkerNamespace(marker, 'restricted');
    return { rootId: marker?.rootId ?? null, source: resolved.source };
  }

  /**
   * Erasure may certify absence only under a root that really is the
   * restricted root.
   *
   * - A marker must name `restricted`; one naming another namespace refuses.
   * - A root written before R20 has evidence but no marker; it is adopted (the
   *   marker is created) because its `verification/` tree proves what it is.
   * - A root DIRECTORY THAT DOES NOT EXIST refuses. That is the realistic wrong
   *   root: a worker started from another cwd resolves a `.restricted-uploads`
   *   nobody created, and "not here" there says nothing about the object.
   * - An existing, unmarked, empty directory is an operator's explicit choice
   *   (and what a disposable test root looks like); erasure proceeds without
   *   writing a marker, because an erase must not provision anything.
   */
  private async assertProvisionedRestrictedRoot(): Promise<void> {
    const root = this.rootDir();
    const marker = await readLocalRootMarker(root);
    if (marker) {
      assertMarkerNamespace(marker, 'restricted');
      return;
    }
    if (await isDirectory(join(root, 'verification'))) {
      await ensureLocalRootMarker(root, 'restricted');
      return;
    }
    if (await isDirectory(root)) return;
    this.log.error({ msg: 'storage.root.unprovisioned', namespace: 'restricted' });
    throw new Error('restricted-root-unprovisioned');
  }

  private resolvedRoot(): ResolvedLocalRoot {
    // Default sibling of .media-uploads, NOT a child of it. Gitignored.
    return resolveLocalRoot(this.config.get('RESTRICTED_STORAGE_DIR'), '.restricted-uploads');
  }

  private rootDir(): string {
    return this.resolvedRoot().path;
  }
}

/** Walk up from `abs` (never above `root`) to the first path that exists, and
 *  report whether it is a directory. Only then is ENOENT genuine absence. */
async function nearestExistingAncestorIsDirectory(abs: string, root: string): Promise<boolean> {
  let current = dirname(abs);
  for (;;) {
    try {
      return (await stat(current)).isDirectory();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return false;
    }
    if (current === root || !current.startsWith(root + sep)) return true;
    current = dirname(current);
  }
}
