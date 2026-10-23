import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { RestrictedObjectStoragePort } from '../../../infrastructure/storage/restricted-object-storage.port';
import { readReceiptBytes } from './receipt-upload.service';

describe('R30 private receipt byte boundary', () => {
  const bytes = Buffer.from('Synthetic immutable receipt bytes');
  const asset = {
    storageKey: 'financial-receipts/intent/receipt.pdf',
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };

  function storage(contents: Buffer): RestrictedObjectStoragePort {
    return {
      openReadStream: jest.fn().mockResolvedValue(Readable.from([contents])),
    } as unknown as RestrictedObjectStoragePort;
  }

  it('reads actual bytes under exact size metadata and authenticates the entire digest', async () => {
    const objects = storage(bytes);
    await expect(readReceiptBytes(objects, asset)).resolves.toEqual(bytes);
    expect(objects.openReadStream).toHaveBeenCalledWith(asset.storageKey, {
      sizeBytes: asset.sizeBytes,
    });
  });

  it.each(['truncated', 'longer', 'tampered'])(
    'refuses %s storage without returning evidence',
    async (kind) => {
      const content =
        kind === 'truncated'
          ? bytes.subarray(1)
          : kind === 'longer'
            ? Buffer.concat([bytes, Buffer.from('x')])
            : Buffer.alloc(bytes.length, 65);
      await expect(readReceiptBytes(storage(content), asset)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    },
  );

  it('rejects oversized metadata before any storage I/O', async () => {
    const objects = storage(bytes);
    await expect(
      readReceiptBytes(objects, { ...asset, sizeBytes: 11 * 1024 * 1024 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(objects.openReadStream).not.toHaveBeenCalled();
  });

  it('propagates unavailable storage instead of inventing an inspection', async () => {
    const objects = {
      openReadStream: jest.fn().mockRejectedValue(new Error('missing')),
    } as unknown as RestrictedObjectStoragePort;
    await expect(readReceiptBytes(objects, asset)).rejects.toThrow('missing');
  });
});
