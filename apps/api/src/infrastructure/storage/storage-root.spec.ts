import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppConfigService } from '../../config/app-config.service';
import { LocalDiskRestrictedStorageAdapter } from './local-disk-restricted-storage.adapter';
import { LocalDiskStorageAdapter, signToken, validateKey } from './local-disk-storage.adapter';
import { RestrictedObjectIntegrityError } from './restricted-object-storage.port';
import {
  STORAGE_ROOT_MARKER_KEY,
  StorageRootMismatchError,
  ensureLocalRootMarker,
  parseStorageRootMarker,
  readLocalRootMarker,
  resolveLocalRoot,
} from './storage-root';

// R20 — storage root identity. See storage-root.ts for the defect: a worker
// resolving a different root used to certify erasure of evidence it could not
// see.

function config(values: Record<string, unknown>): AppConfigService {
  return { get: (key: string) => values[key] } as unknown as AppConfigService;
}

describe('storage root identity (R20)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hsm-r20-root-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resolves a configured root verbatim and labels the cwd default as fragile', () => {
    expect(resolveLocalRoot(root, '.x')).toEqual({ path: root, source: 'configured' });
    expect(resolveLocalRoot(undefined, '.x')).toEqual({
      path: join(process.cwd(), '.x'),
      source: 'cwd-default',
    });
  });

  it('parses strictly — garbage is a mismatch, never "absent"', () => {
    expect(() => parseStorageRootMarker('not json')).toThrow(StorageRootMismatchError);
    expect(() =>
      parseStorageRootMarker(JSON.stringify({ schema: 'hsm.storage-root/v1', namespace: 'x' })),
    ).toThrow(StorageRootMismatchError);
  });

  it('creates one marker under concurrency: every racer agrees on the same root id', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => ensureLocalRootMarker(root, 'restricted')),
    );
    expect(new Set(results.map((m) => m.rootId)).size).toBe(1);
    expect((await readLocalRootMarker(root))?.rootId).toBe(results[0].rootId);
  });

  it('refuses a root already marked for another namespace', async () => {
    await ensureLocalRootMarker(root, 'public');
    await expect(ensureLocalRootMarker(root, 'restricted')).rejects.toThrow(
      StorageRootMismatchError,
    );
  });

  it('makes the marker unaddressable as an object key', () => {
    expect(() => validateKey(STORAGE_ROOT_MARKER_KEY)).toThrow('invalid-key');
    expect(() => validateKey('verification/.evidence-stage-abc/complete.bin')).toThrow(
      'invalid-key',
    );
    expect(() => validateKey('requests/ref/0c1e.jpg')).not.toThrow();
  });

  describe('local restricted adapter', () => {
    const KEY = 'verification/case-r20/asset-r20.pdf';
    const BYTES = Buffer.from('%PDF-1.4 r20');

    async function put(adapter: LocalDiskRestrictedStorageAdapter): Promise<void> {
      const src = join(root, '..', `r20-src-${Date.now()}-${Math.random()}`);
      await writeFile(src, BYTES);
      await adapter.putObjectFromFile({
        key: KEY,
        sourcePath: src,
        contentType: 'application/pdf',
        sizeBytes: BYTES.length,
      });
    }

    it('REFUSES to certify erasure under a root that never held evidence', async () => {
      // The false-receipt defect: an empty or wrong root says "not here" about
      // everything. It must not become a verifiedAbsent receipt.
      const wrongRoot = join(root, 'wrong');
      const worker = new LocalDiskRestrictedStorageAdapter(
        config({ RESTRICTED_STORAGE_DIR: wrongRoot }),
      );
      await expect(worker.eraseObject(KEY)).rejects.toThrow('restricted-erasure-unconfirmed');
    });

    it('erases under an EXISTING empty root without provisioning it (disposable roots)', async () => {
      // The shape test/integration/evidence-retention uses: mkdtemp, then erase
      // before any write. An erase must neither refuse that nor write a marker.
      const worker = new LocalDiskRestrictedStorageAdapter(
        config({ RESTRICTED_STORAGE_DIR: root }),
      );
      await expect(worker.eraseObject(KEY)).resolves.toMatchObject({ verifiedAbsent: true });
      expect(await readLocalRootMarker(root)).toBeNull();
    });

    it('refuses erasure under a root marked for another namespace', async () => {
      await ensureLocalRootMarker(root, 'public');
      const worker = new LocalDiskRestrictedStorageAdapter(
        config({ RESTRICTED_STORAGE_DIR: root }),
      );
      await expect(worker.eraseObject(KEY)).rejects.toThrow('restricted-erasure-unconfirmed');
    });

    it('certifies erasure in the root the evidence was written to, from a second instance', async () => {
      const api = new LocalDiskRestrictedStorageAdapter(config({ RESTRICTED_STORAGE_DIR: root }));
      const worker = new LocalDiskRestrictedStorageAdapter(
        config({ RESTRICTED_STORAGE_DIR: root }),
      );
      await put(api);
      expect((await api.describeRoot()).rootId).toBe((await worker.describeRoot()).rootId);
      await expect(worker.eraseObject(KEY)).resolves.toEqual({
        scope: 'PRIMARY_OBJECT_AND_VERSIONS',
        verifiedAbsent: true,
      });
      expect(await api.head(KEY)).toBeNull();
    });

    it('adopts a pre-R20 root that holds evidence but no marker', async () => {
      await mkdir(join(root, 'verification', 'case-r20'), { recursive: true });
      await writeFile(join(root, KEY), BYTES);
      const worker = new LocalDiskRestrictedStorageAdapter(
        config({ RESTRICTED_STORAGE_DIR: root }),
      );
      await expect(worker.eraseObject(KEY)).resolves.toMatchObject({ verifiedAbsent: true });
      expect((await readLocalRootMarker(root))?.namespace).toBe('restricted');
    });

    it('refuses to write evidence into a root marked public', async () => {
      await ensureLocalRootMarker(root, 'public');
      const api = new LocalDiskRestrictedStorageAdapter(config({ RESTRICTED_STORAGE_DIR: root }));
      await expect(put(api)).rejects.toThrow(StorageRootMismatchError);
    });

    it('refuses a modified object instead of streaming it', async () => {
      const api = new LocalDiskRestrictedStorageAdapter(config({ RESTRICTED_STORAGE_DIR: root }));
      await put(api);
      await expect(api.openReadStream(KEY, { sizeBytes: BYTES.length + 1 })).rejects.toThrow(
        RestrictedObjectIntegrityError,
      );
      const stream = await api.openReadStream(KEY, { sizeBytes: BYTES.length });
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(Buffer.from(c));
      expect(Buffer.concat(chunks)).toEqual(BYTES);
    });

    it('answers a missing object with an opaque error that names no path', async () => {
      const api = new LocalDiskRestrictedStorageAdapter(config({ RESTRICTED_STORAGE_DIR: root }));
      const error = await api.openReadStream(KEY).then(
        () => null,
        (e: Error) => e,
      );
      expect(error?.message).toBe('restricted-storage-unavailable');
      expect(JSON.stringify(error)).not.toContain(root);
    });
  });

  describe('local public adapter', () => {
    const secret = 'r20-test-signing-secret-value-0123456789';
    function adapter(): LocalDiskStorageAdapter {
      return new LocalDiskStorageAdapter(
        config({ LOCAL_STORAGE_DIR: root, MEDIA_SIGNING_SECRET: secret, PORT: 4000 }),
      );
    }
    function signed(key: string, body: Buffer) {
      const exp = Math.floor(Date.now() / 1000) + 60;
      const sig = signToken({ secret, key, exp, contentType: 'image/png', sizeBytes: body.length });
      return {
        key,
        sig,
        exp,
        contentType: 'image/png',
        sizeBytes: body.length,
        body,
        actualContentType: 'image/png',
      };
    }

    it('makes avatars write-once: a replayed signed PUT cannot swap finalized bytes', async () => {
      const first = Buffer.from('first-avatar');
      const second = Buffer.from('other-bytes!');
      const key = 'avatars/ref/2f6c.png';
      await adapter().acceptUpload(signed(key, first));
      await expect(adapter().acceptUpload(signed(key, second))).rejects.toMatchObject({
        code: 'EEXIST',
      });
      expect(await readFile(join(root, key))).toEqual(first);
    });

    it('refuses to accept public uploads into a root marked restricted', async () => {
      await ensureLocalRootMarker(root, 'restricted');
      await expect(
        adapter().acceptUpload(signed('requests/ref/1.png', Buffer.from('x'))),
      ).rejects.toThrow(StorageRootMismatchError);
    });

    it('never serves the marker through the public file path', async () => {
      await ensureLocalRootMarker(root, 'public');
      expect(await adapter().fileExists(STORAGE_ROOT_MARKER_KEY)).toBe(false);
    });
  });
});
