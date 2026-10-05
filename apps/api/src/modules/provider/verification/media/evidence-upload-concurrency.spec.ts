import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import type { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import type { AppConfigService } from '../../../../config/app-config.service';
import { LocalDiskRestrictedStorageAdapter } from '../../../../infrastructure/storage/local-disk-restricted-storage.adapter';
import type { AuditService } from '../../../iam/audit/audit.service';
import type { VerificationSettingsService } from '../verification-settings.service';
import { EvidenceUploadService } from './evidence-upload.service';

const FIRST = Buffer.from('%PDF-1.4\nfirst evidence\n%%EOF\n');
const REPLACEMENT = Buffer.from('%PDF-1.4\nother evidence\n%%EOF\n');
const key = 'verification/case-1/asset-1.pdf';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hsm-evidence-race-'));
  const storage = new LocalDiskRestrictedStorageAdapter({
    get: () => root,
  } as unknown as AppConfigService);
  const row = {
    id: 'asset-1',
    storageKey: key,
    visibility: 'RESTRICTED',
    sizeBytes: FIRST.length,
    sha256: null as string | null,
    scanState: 'PENDING',
    deletedAt: null as Date | null,
    erasureStartedAt: null as Date | null,
    retainUntil: null as Date | null,
    uploadCompletedAt: null as Date | null,
    createdAt: new Date(),
    uploadExpiresAt: new Date(Date.now() + 60_000),
    verificationCaseId: 'case-1',
    pendingDocumentKind: 'INDIVIDUAL_IDENTITY',
    pendingServiceCategoryId: null,
    verificationCase: { state: 'DRAFT' },
  };
  const document = {
    id: 'document-1',
    kind: 'INDIVIDUAL_IDENTITY',
    serviceCategoryId: null,
  };
  let linkedDocument: typeof document | null = null;
  const client = {
    $queryRaw: jest.fn(async () => []),
    verificationCase: { findUnique: jest.fn(async () => ({ state: 'DRAFT' })) },
    verificationDocument: {
      findUnique: jest.fn(async () => linkedDocument),
      updateMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async () => {
        linkedDocument = document;
        return document;
      }),
    },
    mediaAsset: {
      findFirst: jest.fn(async () => structuredClone(row)),
      findUnique: jest.fn(async () => structuredClone(row)),
      // The database suite covers SQL isolation. This unit harness controls
      // the exact ordering while retaining the REAL immutable disk adapter.
      updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (
          row.sha256 !== null ||
          row.uploadCompletedAt ||
          row.scanState !== 'PENDING' ||
          row.deletedAt ||
          row.erasureStartedAt ||
          row.retainUntil ||
          row.verificationCase.state !== 'DRAFT'
        ) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        Object.assign(row, data),
      ),
    },
  };
  const settings = {
    evidenceLimits: async () => ({ maxBytes: 1024, maxDocumentsPerCase: 5, uploadTtlSeconds: 60 }),
  };
  const tx = {
    run: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(client)),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new EvidenceUploadService(
    { client } as unknown as PrismaService,
    tx as unknown as TransactionRunner,
    audit as unknown as AuditService,
    settings as unknown as VerificationSettingsService,
    storage,
  );
  const seedObject = async (bytes: Buffer) => {
    const sourcePath = join(root, 'legacy-object');
    await writeFile(sourcePath, bytes);
    await storage.putObjectFromFile({
      key,
      sourcePath,
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
    });
  };
  return { service, storage, client, row, root, tx, audit, seedObject };
}

describe('restricted evidence content cannot replace a scanned document', () => {
  const roots: string[] = [];
  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('refuses a slow PUT admitted before another upload finalizes and becomes CLEAN', async () => {
    const f = await fixture();
    roots.push(f.root);
    let observed!: () => void;
    const admitted = new Promise<void>((resolve) => {
      observed = resolve;
    });
    f.client.mediaAsset.findFirst.mockImplementationOnce(async () => {
      const snapshot = structuredClone(f.row);
      observed();
      return snapshot;
    });
    const body = new PassThrough();
    const late = f.service.acceptContent('owner', 'asset-1', body, 'application/pdf').then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await admitted;
    await f.service.acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf');
    f.row.uploadCompletedAt = new Date();
    f.row.scanState = 'CLEAN';
    f.row.verificationCase.state = 'SUBMITTED';
    const remove = jest.spyOn(f.storage, 'deleteObject');
    body.end(REPLACEMENT);

    expect(await late).toMatchObject({
      error: { status: 409, details: { reason: 'ALREADY_FINALIZED' } },
    });
    expect(await drain(await f.storage.openReadStream(key))).toEqual(FIRST);
    expect(f.row.sha256).toBe(digest(FIRST));
    expect(f.row.scanState).toBe('CLEAN');
    expect(f.client.mediaAsset.update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('permits an identical pending retry while refusing different content for that key', async () => {
    const f = await fixture();
    roots.push(f.root);
    const upload = (bytes: Buffer) =>
      f.service.acceptContent('owner', 'asset-1', Readable.from(bytes), 'application/pdf');
    await upload(FIRST);
    await expect(upload(FIRST)).resolves.toEqual({
      sizeBytes: FIRST.length,
      detectedMime: 'application/pdf',
    });
    await expect(upload(REPLACEMENT)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'CONTENT_ALREADY_STORED' },
    });
    expect(await drain(await f.storage.openReadStream(key))).toEqual(FIRST);
    expect(f.row.sha256).toBe(digest(FIRST));
  });

  it('recovers the same immutable object after a transport reports failure following a successful write', async () => {
    const f = await fixture();
    roots.push(f.root);
    const put = f.storage.putObjectFromFile.bind(f.storage);
    jest.spyOn(f.storage, 'putObjectFromFile').mockImplementationOnce(async (input) => {
      await put(input);
      throw new Error('transport response was lost');
    });
    const remove = jest.spyOn(f.storage, 'deleteObject');
    await expect(
      f.service.acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf'),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      f.service.acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf'),
    ).resolves.toEqual({ sizeBytes: FIRST.length, detectedMime: 'application/pdf' });
    expect(await drain(await f.storage.openReadStream(key))).toEqual(FIRST);
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses a legacy same-length different object and cannot finalize it after the rejected PUT', async () => {
    const f = await fixture();
    roots.push(f.root);
    expect(REPLACEMENT.length).toBe(FIRST.length);
    await f.seedObject(REPLACEMENT);
    const remove = jest.spyOn(f.storage, 'deleteObject');

    await expect(
      f.service.acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf'),
    ).rejects.toMatchObject({ status: 409, details: { reason: 'OBJECT_MISMATCH' } });
    // The CAS claim is pending, not proof that the physical object is valid.
    expect(f.row.sha256).toBe(digest(FIRST));
    await expect(f.service.finalize('owner', 'asset-1')).rejects.toMatchObject({
      status: 409,
      details: { reason: 'OBJECT_MISMATCH' },
    });
    expect(f.row.uploadCompletedAt).toBeNull();
    expect(f.row.scanState).toBe('PENDING');
    expect(f.client.verificationDocument.create).not.toHaveBeenCalled();
    expect(f.tx.run).not.toHaveBeenCalled();
    expect(f.audit.record).not.toHaveBeenCalled();
    expect(await drain(await f.storage.openReadStream(key))).toEqual(REPLACEMENT);
    expect(remove).not.toHaveBeenCalled();
  });

  it('adopts matching legacy bytes and finalizes them once, without body reads on finalized replay', async () => {
    const f = await fixture();
    roots.push(f.root);
    await f.seedObject(FIRST);
    await expect(
      f.service.acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf'),
    ).resolves.toEqual({ sizeBytes: FIRST.length, detectedMime: 'application/pdf' });
    await expect(f.service.finalize('owner', 'asset-1')).resolves.toMatchObject({ created: true });
    const read = jest.spyOn(f.storage, 'openReadStream');
    await expect(f.service.finalize('owner', 'asset-1')).resolves.toMatchObject({
      documentId: 'document-1',
      created: false,
    });
    expect(read).not.toHaveBeenCalled();
    expect(f.client.verificationDocument.create).toHaveBeenCalledTimes(1);
    expect(f.audit.record).toHaveBeenCalledTimes(1);
  });

  it.each(['truncated', 'overlong', 'nonbyte'])(
    'rejects a %s read even when HEAD reports the expected length and closes the stream',
    async (fault) => {
      const f = await fixture();
      roots.push(f.root);
      await f.seedObject(FIRST);
      const stream =
        fault === 'nonbyte'
          ? Readable.from([{ private: 'backend-object' }])
          : Readable.from(
              fault === 'truncated' ? FIRST.subarray(0, -1) : Buffer.concat([FIRST, FIRST]),
            );
      const read = jest.spyOn(f.storage, 'openReadStream').mockResolvedValueOnce(stream);
      const remove = jest.spyOn(f.storage, 'deleteObject');
      await expect(
        f.service.acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf'),
      ).rejects.toMatchObject({ status: 409, details: { reason: 'OBJECT_MISMATCH' } });
      expect(stream.destroyed).toBe(true);
      expect(remove).not.toHaveBeenCalled();
      read.mockRestore();
      expect(await drain(await f.storage.openReadStream(key))).toEqual(FIRST);
    },
  );

  it.each(['head', 'open', 'read'])(
    'returns a safe retryable error for a %s storage failure without removing the object',
    async (fault) => {
      const f = await fixture();
      roots.push(f.root);
      await f.seedObject(FIRST);
      const privateFailure = new Error(`backend failed at ${key}`);
      const stream = new Readable({
        read() {
          this.destroy(privateFailure);
        },
      });
      if (fault === 'head') jest.spyOn(f.storage, 'head').mockRejectedValueOnce(privateFailure);
      if (fault === 'open')
        jest.spyOn(f.storage, 'openReadStream').mockRejectedValueOnce(privateFailure);
      if (fault === 'read') jest.spyOn(f.storage, 'openReadStream').mockResolvedValueOnce(stream);
      const remove = jest.spyOn(f.storage, 'deleteObject');
      const error: unknown = await f.service
        .acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf')
        .catch((failure: unknown) => failure);
      expect(error).toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
      expect(String(error)).not.toContain(key);
      if (fault === 'read') expect(stream.destroyed).toBe(true);
      expect(remove).not.toHaveBeenCalled();
      expect(f.row.uploadCompletedAt).toBeNull();
    },
  );

  it.each(['head', 'open', 'read'])(
    'bounds a stalled %s probe and owns late or stalled streams',
    async (fault) => {
      const f = await fixture();
      roots.push(f.root);
      await f.seedObject(FIRST);
      let observed!: () => void;
      const entered = new Promise<void>((resolve) => {
        observed = resolve;
      });
      let release!: (stream: Readable) => void;
      const stream = new PassThrough();
      if (fault === 'head')
        jest.spyOn(f.storage, 'head').mockImplementationOnce(() => {
          observed();
          return new Promise(() => {});
        });
      if (fault === 'open')
        jest.spyOn(f.storage, 'openReadStream').mockImplementationOnce(() => {
          observed();
          return new Promise((resolve) => {
            release = resolve;
          });
        });
      if (fault === 'read')
        jest.spyOn(f.storage, 'openReadStream').mockImplementationOnce(async () => {
          observed();
          return stream;
        });
      const remove = jest.spyOn(f.storage, 'deleteObject');
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const result = f.service
        .acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf')
        .catch((failure: unknown) => failure);
      await entered;
      await jest.advanceTimersByTimeAsync(5_000);
      expect(await result).toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
      if (fault === 'open') {
        release(stream);
        await jest.advanceTimersByTimeAsync(0);
      }
      if (fault !== 'head') expect(stream.destroyed).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
      expect(remove).not.toHaveBeenCalled();
      expect(f.tx.run).not.toHaveBeenCalled();
    },
  );

  it('shares one deadline across finalize HEAD and hashing and creates no document on timeout', async () => {
    const f = await fixture();
    roots.push(f.root);
    await f.seedObject(FIRST);
    f.row.sha256 = digest(FIRST);
    let releaseHead!: (value: { sizeBytes: number }) => void;
    jest.spyOn(f.storage, 'head').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseHead = resolve;
        }),
    );
    const stream = new PassThrough();
    const read = jest.spyOn(f.storage, 'openReadStream').mockResolvedValueOnce(stream);
    jest.useFakeTimers();
    const result = f.service.finalize('owner', 'asset-1').catch((failure: unknown) => failure);
    await jest.advanceTimersByTimeAsync(4_000);
    releaseHead({ sizeBytes: FIRST.length });
    await jest.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
    expect(stream.destroyed).toBe(true);
    expect(f.client.verificationDocument.create).not.toHaveBeenCalled();
    expect(f.tx.run).not.toHaveBeenCalled();
    expect(f.row.uploadCompletedAt).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not publish bytes when persisting their immutable content claim fails', async () => {
    const f = await fixture();
    roots.push(f.root);
    f.client.mediaAsset.updateMany.mockRejectedValueOnce(new Error('database unavailable'));
    const put = jest.spyOn(f.storage, 'putObjectFromFile');
    await expect(
      f.service.acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf'),
    ).rejects.toThrow('database unavailable');
    expect(put).not.toHaveBeenCalled();
    expect(await f.storage.head(key)).toBeNull();
  });

  it('removes its own newly promoted bytes when erasure begins during storage transfer', async () => {
    const f = await fixture();
    roots.push(f.root);
    const put = f.storage.putObjectFromFile.bind(f.storage);
    jest.spyOn(f.storage, 'putObjectFromFile').mockImplementationOnce(async (input) => {
      await put(input);
      f.row.erasureStartedAt = new Date();
    });
    await expect(
      f.service.acceptContent('owner', 'asset-1', Readable.from(FIRST), 'application/pdf'),
    ).rejects.toMatchObject({ status: 404 });
    expect(await f.storage.head(key)).toBeNull();
  });
});
