import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
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
    uploadExpiresAt: new Date(Date.now() + 60_000),
    verificationCaseId: 'case-1',
    verificationCase: { state: 'DRAFT' },
  };
  const client = {
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
  const service = new EvidenceUploadService(
    { client } as unknown as PrismaService,
    {} as TransactionRunner,
    {} as AuditService,
    settings as unknown as VerificationSettingsService,
    storage,
  );
  return { service, storage, client, row, root };
}

describe('restricted evidence content cannot replace a scanned document', () => {
  const roots: string[] = [];
  afterEach(async () => {
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
