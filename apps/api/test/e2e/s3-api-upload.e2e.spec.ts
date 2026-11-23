import { INestApplication, VersioningType } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import express from 'express';
import request from 'supertest';
import { AppConfigService } from '../../src/config/app-config.service';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { S3StorageAdapter } from '../../src/infrastructure/storage/s3-storage.adapter';
import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';
import { STORAGE_PORT } from '../../src/infrastructure/storage/storage.port';
import { MediaController } from '../../src/modules/media/media.controller';
import { PortfolioMediaService } from '../../src/modules/media/portfolio-media.service';
import { PublicMediaLedgerService } from '../../src/modules/media/public-media-ledger.service';
import { PublicMediaReadService } from '../../src/modules/media/public-media-read.service';
import { RequestMediaService } from '../../src/modules/media/request-media.service';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { makeTestSecret } from '../support/test-secrets';

/** Real HTTP/controller/grant/adapter, deterministic S3 command double.
 * Actual MinIO conditional-write proof is in the gated R20 integration suite. */
describe('private S3 API upload transport', () => {
  let app: INestApplication;
  let adapter: S3StorageAdapter;
  let send: jest.SpyInstance;
  const objects = new Map<string, Buffer>();
  const localWrite = jest.fn();
  let transport = 'api';
  let rootState = 'public';
  let storageFailure = false;
  const values: Record<string, unknown> = {
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'private-public-media',
    S3_REGION: 'us-east-1',
    S3_ENDPOINT: 'http://object-store.railway.internal:9000',
    S3_FORCE_PATH_STYLE: true,
    PUBLIC_API_URL: 'https://api.example.test',
    S3_PUBLIC_BASE_URL: 'https://api.example.test/v1/media/files',
    JWT_ACCESS_SECRET: makeTestSecret('s3-api-upload'),
    NODE_ENV: 'test',
  };
  const config = {
    get: (key: string) => (key === 'S3_UPLOAD_TRANSPORT' ? transport : values[key]),
    isProduction: false,
  } as unknown as AppConfigService;

  beforeEach(async () => {
    transport = 'api';
    rootState = 'public';
    storageFailure = false;
    objects.clear();
    localWrite.mockClear();
    adapter = new S3StorageAdapter(config);
    send = jest
      .spyOn(Reflect.get(adapter, 'client') as S3Client, 'send')
      .mockImplementation(async (command) => {
        if (storageFailure)
          throw {
            name: 'AccessDenied',
            message: 'private bucket endpoint secret',
            $metadata: { httpStatusCode: 403 },
          };
        if (command instanceof GetObjectCommand) {
          if (rootState === 'absent') throw { name: 'NoSuchKey' };
          return {
            Body: {
              transformToString: async () =>
                JSON.stringify({
                  schema: 'hsm.storage-root/v1',
                  namespace: rootState,
                  rootId: '00000000-0000-4000-8000-000000000000',
                  createdAt: '2026-11-11T00:00:00Z',
                }),
            },
          };
        }
        if (!(command instanceof PutObjectCommand)) throw new Error('Unexpected command');
        expect(command.input.IfNoneMatch).toBe('*');
        const key = command.input.Key!;
        if (objects.has(key))
          throw { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } };
        objects.set(key, Buffer.from(command.input.Body as Buffer));
        return {};
      });
    const module = await Test.createTestingModule({
      controllers: [MediaController],
      providers: [
        { provide: AppConfigService, useValue: config },
        { provide: STORAGE_PORT, useValue: adapter },
        { provide: LocalDiskStorageAdapter, useValue: { acceptUpload: localWrite } },
        { provide: PublicMediaLedgerService, useValue: {} },
        { provide: PublicMediaReadService, useValue: {} },
        { provide: RequestMediaService, useValue: {} },
        { provide: PortfolioMediaService, useValue: {} },
        { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false, bodyParser: false });
    app.use('/v1/media/uploads', express.raw({ type: '*/*', limit: '10mb' }));
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    send?.mockRestore();
  });
  const input = { key: 'avatars/ref/photo.png', contentType: 'image/png' as const, sizeBytes: 3 };
  async function uploadPath() {
    const url = new URL((await adapter.presignUpload(input)).uploadUrl);
    return url.pathname + url.search;
  }
  const put = (path: string, body = Buffer.from('png'), type = 'image/png') =>
    request(app.getHttpServer()).put(path).set('Content-Type', type).send(body);

  it('uploads through API and preserves immutable bytes on replay without any local write', async () => {
    const path = await uploadPath();
    expect(path).toMatch(/^\/v1\/media\/uploads\/avatars\//);
    expect(await put(path)).toHaveProperty('status', 204);
    expect(objects.get(input.key)).toEqual(Buffer.from('png'));
    expect(await put(path, Buffer.from('new'))).toHaveProperty('status', 409);
    expect(objects.get(input.key)).toEqual(Buffer.from('png'));
    expect(localWrite).not.toHaveBeenCalled();
  });
  it('refuses altered grants, content-type, size and malformed URL parameters before writes', async () => {
    const path = await uploadPath();
    expect(await put(path.replace('photo.png', 'other.png'))).toHaveProperty('status', 401);
    expect(await put(path, Buffer.from('png'), 'text/html')).toHaveProperty('status', 400);
    expect(await put(path, Buffer.from('larger'))).toHaveProperty('status', 400);
    expect(await put(path + '&sz=3')).toHaveProperty('status', 400);
    expect(await put(path.replace('sz=3', 'sz=3junk'))).toHaveProperty('status', 400);
    expect(
      await put(path.replace('avatars/ref/photo.png', 'verification/case/doc.png')),
    ).toHaveProperty('status', 400);
    expect(objects.size).toBe(0);
  });
  it('refuses private S3 API uploads when transport is disabled and strips storage errors', async () => {
    const path = await uploadPath();
    transport = 'direct';
    expect(await put(path)).toHaveProperty('status', 503);
    transport = 'api';
    storageFailure = true;
    const response = await put(path);
    expect(response.status).toBe(503);
    expect(response.text).not.toMatch(/bucket|endpoint|secret/);
    expect(objects.size).toBe(0);
  });
  it.each(['restricted', 'absent'])(
    'refuses a wrong or unverified origin root: %s',
    async (state) => {
      rootState = state;
      await expect(adapter.presignUpload(input)).rejects.toThrow();
      expect(objects.size).toBe(0);
    },
  );

  it('recovers when a private root is provisioned after the first grant attempt', async () => {
    rootState = 'absent';
    await expect(adapter.presignUpload(input)).rejects.toThrow();
    rootState = 'public';
    expect(await put(await uploadPath())).toHaveProperty('status', 204);
  });

  it('probes private storage through marker metadata without bucket-list authority', async () => {
    send.mockResolvedValue({});
    await adapter.headBuckets(AbortSignal.timeout(1000));
    expect(send).toHaveBeenCalledWith(
      expect.any(HeadObjectCommand),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
    );
    expect(send.mock.calls[0][0].input.Key).toBe('.hsm-storage-root.json');
  });
});
