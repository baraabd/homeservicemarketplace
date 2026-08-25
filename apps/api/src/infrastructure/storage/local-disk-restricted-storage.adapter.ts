import { Injectable, Logger } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import type { Readable } from 'node:stream';

import { AppConfigService } from '../../config/app-config.service';
import {
  RestrictedObjectStoragePort,
  type RestrictedObjectMetadata,
} from './restricted-object-storage.port';
import { validateKey } from './local-disk-storage.adapter';

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
    await mkdir(dirname(target), { recursive: true });

    // rename() is atomic within a filesystem, so a reader can never observe a
    // half-written object: the key either does not resolve, or resolves to the
    // complete file. Falls back to copy+unlink across devices, where the
    // staging dir is on a different mount from the storage root.
    try {
      await rename(input.sourcePath, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
      await copyFile(input.sourcePath, target);
      await rm(input.sourcePath, { force: true });
    }

    // Size only. No key, no filename, no content.
    this.log.log({ msg: 'restricted.storage.put', bytes: input.sizeBytes });
  }

  async openReadStream(key: string): Promise<Readable> {
    const abs = this.absolutePathForKey(key);
    // stat first so a missing object is an ordinary error here rather than an
    // async 'error' event the caller has already started piping.
    await stat(abs);
    return createReadStream(abs);
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
      if (!s.isFile()) return null;
      return { sizeBytes: s.size };
    } catch {
      return null;
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

  private rootDir(): string {
    const configured = this.config.get('RESTRICTED_STORAGE_DIR');
    if (configured && configured.length > 0) return normalize(configured);
    // Default sibling of .media-uploads, NOT a child of it. Gitignored.
    return normalize(join(process.cwd(), '.restricted-uploads'));
  }
}
