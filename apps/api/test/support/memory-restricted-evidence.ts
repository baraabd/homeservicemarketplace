import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';

import {
  RestrictedObjectAlreadyExistsError,
  RestrictedObjectStoragePort,
} from '../../src/infrastructure/storage/restricted-object-storage.port';

/** A complete, decodable 1x1 PNG, rather than a header padded to the declared size. */
export const RESTRICTED_IDENTITY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOo6FkAAAMkAaWqdVhVAAAAAElFTkSuQmCC',
  'base64',
);

/** Deterministic bucket boundary for database suites. Availability is derived
 * from independently stored bytes, never from a MediaAsset query or stubbed
 * approval proof. Tests may delete an object while leaving its row untouched. */
export class MemoryRestrictedEvidenceStorage extends RestrictedObjectStoragePort {
  readonly objects = new Map<string, Buffer>();
  readonly headCalls: string[] = [];
  readonly readCalls: string[] = [];

  seed(key: string, bytes = RESTRICTED_IDENTITY_PNG): { sizeBytes: number; sha256: string } {
    this.objects.set(key, Buffer.from(bytes));
    return { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  reset(): void {
    this.objects.clear();
    this.headCalls.length = 0;
    this.readCalls.length = 0;
  }

  async putObjectFromFile(input: { key: string; sourcePath: string }): Promise<void> {
    const bytes = await readFile(input.sourcePath);
    if (this.objects.has(input.key)) throw new RestrictedObjectAlreadyExistsError();
    this.objects.set(input.key, bytes);
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    this.headCalls.push(key);
    const bytes = this.objects.get(key);
    return bytes ? { sizeBytes: bytes.length } : null;
  }

  async openReadStream(key: string): Promise<Readable> {
    this.readCalls.push(key);
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error('Restricted evidence object is absent');
    return Readable.from(bytes);
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
