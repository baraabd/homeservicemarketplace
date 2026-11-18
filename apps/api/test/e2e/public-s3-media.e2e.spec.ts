import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Readable } from 'node:stream';
import request from 'supertest';
import { MediaController } from '../../src/modules/media/media.controller';
import { PublicMediaReadService } from '../../src/modules/media/public-media-read.service';
import { PublicMediaLedgerService } from '../../src/modules/media/public-media-ledger.service';
import { RequestMediaService } from '../../src/modules/media/request-media.service';
import { PortfolioMediaService } from '../../src/modules/media/portfolio-media.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';
import { STORAGE_PORT } from '../../src/infrastructure/storage/storage.port';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { AppConfigService } from '../../src/config/app-config.service';
import { AppError } from '../../src/shared/errors/app-error';

const suffix = '0123456789abcdef01234567/12345678-1234-4123-8123-123456789abc.png';
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const findUnique = jest.fn();
const readObjectHead = jest.fn();
const readObjectStream = jest.fn();
const portfolioOpen = jest.fn();
const localPath = jest.fn();

function published(key: string) {
  const avatar = key.startsWith('avatars/');
  return {
    storageKey: key,
    visibility: 'PUBLIC',
    purpose: avatar ? null : 'REQUEST_ATTACHMENT',
    declaredMimeType: 'image/png',
    detectedMimeType: avatar ? null : 'image/png',
    sizeBytes: bytes.length,
    scanState: 'PENDING',
    uploadCompletedAt: new Date(),
    deletedAt: null,
    retainUntil: null,
    erasureStartedAt: null,
    verificationCaseId: null,
    verificationDocument: null,
    portfolioItems: [],
    ownerUserId: 'owner',
    owner: {
      deletedAt: null,
      providerProfile: {
        deletedAt: null,
        profileImageUrl: `https://api.test/v1/media/files/${key}`,
        avatarUrl: null,
      },
    },
    serviceRequestId: avatar ? null : 'request',
    requestClaimedAt: avatar ? null : new Date(),
    serviceRequest: avatar ? null : { deletedAt: null, seekerUserId: 'owner' },
  };
}

describe('private S3 public read route', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        PublicMediaReadService,
        { provide: PrismaService, useValue: { client: { mediaAsset: { findUnique } } } },
        { provide: STORAGE_PORT, useValue: { readObjectHead, readObjectStream } },
        { provide: LocalDiskStorageAdapter, useValue: { absolutePathForKey: localPath } },
        { provide: PortfolioMediaService, useValue: { openPublic: portfolioOpen } },
        { provide: PublicMediaLedgerService, useValue: {} },
        { provide: RequestMediaService, useValue: {} },
        {
          provide: AppConfigService,
          useValue: { get: (key: string) => (key === 'STORAGE_DRIVER' ? 's3' : 'test') },
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    findUnique.mockReset();
    readObjectHead.mockReset().mockResolvedValue({ sizeBytes: bytes.length, head: bytes });
    readObjectStream.mockReset().mockImplementation(async () => Readable.from(bytes));
    portfolioOpen.mockReset().mockRejectedValue(new AppError('NOT_FOUND', 'File not found.', 404));
    localPath.mockReset();
  });

  it.each(['avatars', 'requests'])(
    'serves committed %s through private storage without local fallback',
    async (prefix) => {
      const key = `${prefix}/${suffix}`;
      findUnique.mockResolvedValue(published(key));
      const res = await request(app.getHttpServer()).get(`/v1/media/files/${key}`).expect(200);
      expect(res.body).toEqual(bytes);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(localPath).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['avatars', { uploadCompletedAt: null }],
    ['avatars', { retainUntil: new Date() }],
    ['requests', { requestClaimedAt: null }],
    ['requests', { deletedAt: new Date() }],
    ['requests', { visibility: 'RESTRICTED' }],
  ])('refuses unavailable %s media at the HTTP boundary', async (prefix, override) => {
    const key = `${prefix}/${suffix}`;
    findUnique.mockResolvedValue({ ...published(key), ...(override as object) });
    await request(app.getHttpServer()).get(`/v1/media/files/${key}`).expect(404);
    expect(readObjectHead).not.toHaveBeenCalled();
    expect(readObjectStream).not.toHaveBeenCalled();
    expect(localPath).not.toHaveBeenCalled();
  });

  it.each([
    'verification/case/document.png',
    'avatars/%252e%252e/secret.png',
    'requests/bad/key.png',
    '.hsm-storage-root.json',
  ])('does not read protected/malformed %s', async (key) => {
    await request(app.getHttpServer()).get(`/v1/media/files/${key}`).expect(404);
    expect(findUnique).not.toHaveBeenCalled();
    expect(readObjectStream).not.toHaveBeenCalled();
    expect(localPath).not.toHaveBeenCalled();
  });

  it('retains portfolio moderation authority and never falls through to public assets', async () => {
    await request(app.getHttpServer())
      .get(`/v1/media/files/portfolio-staging/${suffix}`)
      .expect(404);
    expect(portfolioOpen).toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(readObjectStream).not.toHaveBeenCalled();
  });

  it('rechecks publication after a successful read when the asset is retired', async () => {
    const key = `avatars/${suffix}`;
    findUnique.mockResolvedValue(published(key));
    await request(app.getHttpServer()).get(`/v1/media/files/${key}`).expect(200);
    findUnique.mockResolvedValue({ ...published(key), retainUntil: new Date() });
    await request(app.getHttpServer()).get(`/v1/media/files/${key}`).expect(404);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(readObjectStream).toHaveBeenCalledTimes(1);
  });

  it('returns a sanitized unavailable response before streaming', async () => {
    findUnique.mockResolvedValue(published(`avatars/${suffix}`));
    readObjectStream.mockRejectedValue(new Error('secret S3 endpoint credentials'));
    const res = await request(app.getHttpServer())
      .get(`/v1/media/files/avatars/${suffix}`)
      .expect(503);
    expect(res.text).not.toContain('credentials');
    expect(res.text).not.toContain('endpoint');
  });

  it('terminates a failed body without a second JSON response', async () => {
    findUnique.mockResolvedValue({ ...published(`avatars/${suffix}`), sizeBytes: 16 });
    readObjectHead.mockResolvedValue({ sizeBytes: 16, head: bytes });
    readObjectStream.mockImplementation(async () =>
      Readable.from(
        (async function* () {
          yield bytes;
          await new Promise<void>((resolve) => setImmediate(resolve));
          throw new Error('secret storage error');
        })(),
      ),
    );
    await expect(
      request(app.getHttpServer()).get(`/v1/media/files/avatars/${suffix}`),
    ).rejects.toThrow();
  });
});
