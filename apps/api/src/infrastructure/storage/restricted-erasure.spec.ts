import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import { LocalDiskRestrictedStorageAdapter } from './local-disk-restricted-storage.adapter';
import { S3RestrictedStorageAdapter } from './s3-restricted-storage.adapter';
const key = 'verification/case/object.pdf';
const config = (values: Record<string, unknown>) => ({ get: (k: string) => values[k] }) as never;

describe('local erasure — real filesystem', () => {
  let root: string;
  let adapter: LocalDiskRestrictedStorageAdapter;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'hsm-erase-'));
    adapter = new LocalDiskRestrictedStorageAdapter(config({ RESTRICTED_STORAGE_DIR: root }));
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));
  it('physically removes an object, verifies absence and repeats safely', async () => {
    const source = join(root, 'staged.pdf');
    await writeFile(source, '%PDF synthetic only');
    await adapter.putObjectFromFile({
      key,
      sourcePath: source,
      contentType: 'application/pdf',
      sizeBytes: 19,
    });
    expect(await adapter.head(key)).not.toBeNull();
    expect(await adapter.eraseObject(key)).toMatchObject({ verifiedAbsent: true });
    expect(await adapter.head(key)).toBeNull();
    expect(await adapter.eraseObject(key)).toMatchObject({ verifiedAbsent: true });
  });
  it('does not flatten a directory or ENOTDIR storage error into absence', async () => {
    await mkdir(join(root, 'verification'));
    await expect(adapter.head('verification')).rejects.toThrow('restricted-storage-unavailable');
    await writeFile(join(root, 'verification', 'case'), 'not a directory');
    await expect(adapter.head(key)).rejects.toThrow('restricted-storage-unavailable');
    await expect(adapter.eraseObject(key)).rejects.toThrow('restricted-erasure-unconfirmed');
  });
  it.each(['public/photo.png', 'verification/../../outside'])(
    'refuses non-evidence key %s',
    async (value) => {
      await expect(adapter.eraseObject(value)).rejects.toThrow();
    },
  );
});

describe('S3 version erasure — real SDK commands, deterministic transport', () => {
  function fixture() {
    const versions = [
      { Key: key, VersionId: 'v1' },
      { Key: key, VersionId: 'v2' },
      { Key: `${key}-sibling`, VersionId: 'keep' },
    ];
    const markers: Array<{ Key: string; VersionId: string }> = [];
    const send = jest.fn(
      async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (cmd.constructor.name === 'ListObjectVersionsCommand')
          return { Versions: versions, DeleteMarkers: markers, IsTruncated: false };
        if (cmd.constructor.name === 'HeadObjectCommand')
          throw Object.assign(new Error('missing'), { name: 'NotFound' });
        if (cmd.constructor.name === 'DeleteObjectCommand') {
          if (!cmd.input.VersionId) markers.push({ Key: key, VersionId: 'marker' });
          else
            for (const list of [versions, markers]) {
              const at = list.findIndex(
                (v) => v.Key === cmd.input.Key && v.VersionId === cmd.input.VersionId,
              );
              if (at >= 0) list.splice(at, 1);
            }
          return {};
        }
        throw new Error('unexpected-command');
      },
    );
    class Adapter extends S3RestrictedStorageAdapter {
      protected createClient() {
        return { send } as unknown as S3Client;
      }
    }
    return {
      send,
      versions,
      markers,
      adapter: new Adapter(config({ S3_RESTRICTED_BUCKET: 'synthetic-test-bucket' })),
    };
  }
  it('deletes every exact-key version and marker, never a prefix sibling', async () => {
    const f = fixture();
    expect((await f.adapter.eraseObject(key)).verifiedAbsent).toBe(true);
    expect(f.versions).toEqual([{ Key: `${key}-sibling`, VersionId: 'keep' }]);
    expect(f.markers).toEqual([]);
    expect(f.send.mock.calls.every(([cmd]) => !cmd.input.BypassGovernanceRetention)).toBe(true);
  });
  it('does not accept a 404 without a complete version inventory', async () => {
    const f = fixture();
    f.send.mockImplementation(async (cmd) =>
      cmd.constructor.name === 'ListObjectVersionsCommand'
        ? { Versions: [], DeleteMarkers: [], IsTruncated: true }
        : {},
    );
    await expect(f.adapter.eraseObject(key)).rejects.toThrow('restricted-erasure-unconfirmed');
  });
  it('storage/permission/lock failures stay opaque and retryable', async () => {
    const f = fixture();
    f.send.mockRejectedValue(new Error('sensitive bucket/key text'));
    await expect(f.adapter.eraseObject(key)).rejects.toThrow(/^restricted-erasure-unconfirmed$/);
  });
});
