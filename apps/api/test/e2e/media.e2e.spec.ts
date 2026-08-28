// E2E coverage for the Sprint 7.x media upload pipeline:
//
//   POST /v1/media/presigned-url   — auth-gated batch presign
//   PUT  /v1/media/uploads/:key    — local-disk write, signature-gated
//   GET  /v1/media/files/:key      — public serve from disk
//
// We boot a real Nest test app with an isolated temp dir as the
// storage root, fake the JwtAuthGuard / CsrfGuard so the tests don't
// need a live IAM stack, and drive every branch of the controller
// from the wire.

import {
  ExecutionContext,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import express from 'express';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';

import { AppConfigService } from '../../src/config/app-config.service';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';
import { S3StorageAdapter } from '../../src/infrastructure/storage/s3-storage.adapter';
import { STORAGE_PORT } from '../../src/infrastructure/storage/storage.port';
import { MediaController } from '../../src/modules/media/media.controller';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';

jest.setTimeout(15_000);

const ROOT = join(tmpdir(), `hsm-media-e2e-${Date.now()}`);

function makeConfig(): AppConfigService {
  const env: Record<string, string | undefined> = {
    JWT_ACCESS_SECRET: 'test-jwt-secret-at-least-32-bytes-long-aaaaa',
    PORT: '4000',
    PUBLIC_API_URL: 'http://localhost:4000',
    LOCAL_STORAGE_DIR: ROOT,
    MEDIA_SIGNING_SECRET: '',
    STORAGE_DRIVER: 'local',
    NODE_ENV: 'test',
    S3_REGION: 'us-east-1',
  };
  return {
    get: (k: string) => env[k] as never,
    get isProduction() {
      return false;
    },
  } as unknown as AppConfigService;
}

let fakeAuthedUser: { id: string; sessionId: string; jti: string; roles: string[] } | null = null;

class FakeJwtAuthGuard {
  canActivate(ctx: ExecutionContext): boolean {
    if (!fakeAuthedUser) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    const req = ctx.switchToHttp().getRequest();
    req.user = fakeAuthedUser;
    return true;
  }
}

class FakeCsrfGuard {
  canActivate(): boolean {
    return true;
  }
}

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();
  @Module({
    controllers: [MediaController],
    providers: [
      Reflector,
      LocalDiskStorageAdapter,
      S3StorageAdapter,
      { provide: AppConfigService, useValue: config },
      {
        provide: STORAGE_PORT,
        inject: [LocalDiskStorageAdapter],
        useFactory: (local: LocalDiskStorageAdapter) => local,
      },
      { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeJwtAuthGuard)
    .overrideGuard(CsrfGuard)
    .useClass(FakeCsrfGuard)
    .compile();

  // bodyParser: false disables Nest's default JSON body parser so we
  // can wire two independently:
  //   - /v1/media/uploads/*  → express.raw() (binary Buffer body)
  //   - everything else      → express.json() (default JSON parsing)
  // Order matters — registering raw FIRST means it short-circuits the
  // generic JSON parser for upload paths.
  const app = moduleRef.createNestApplication({ logger: false, bodyParser: false });
  app.use('/v1/media/uploads', express.raw({ type: '*/*', limit: '10mb' }));
  app.use(express.json());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
}

describe('Media upload pipeline (e2e) — Sprint 7.x', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await mkdir(ROOT, { recursive: true });
    app = await bootApp();
  });

  afterAll(async () => {
    await app.close();
    await rm(ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    fakeAuthedUser = null;
  });

  describe('POST /v1/media/presigned-url', () => {
    it('rejects unauthenticated callers with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ items: [{ contentType: 'image/jpeg', sizeBytes: 1024 }] });
      expect(res.status).toBe(401);
    });

    it('issues one presigned URL per item with the expected shape', async () => {
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({
          items: [
            { contentType: 'image/jpeg', sizeBytes: 1024 },
            { contentType: 'video/mp4', sizeBytes: 2048 },
          ],
        });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items).toHaveLength(2);
      for (const item of res.body.items) {
        expect(item.uploadUrl).toMatch(
          /\/v1\/media\/uploads\/requests\/u-1\/[0-9a-f-]{36}\.(jpg|mp4)/,
        );
        expect(item.fileUrl).toMatch(
          /\/v1\/media\/files\/requests\/u-1\/[0-9a-f-]{36}\.(jpg|mp4)$/,
        );
        expect(new Date(item.expiresAt).toString()).not.toBe('Invalid Date');
      }
    });

    // ── Sprint 9B.17 — the avatar purpose ────────────────────────────────

    it('mints avatar keys in their own namespace, under an OPAQUE owner ref', async () => {
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer', 'provider'] };
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ purpose: 'avatar', items: [{ contentType: 'image/jpeg', sizeBytes: 1024 }] });

      expect(res.status).toBe(200);
      const { fileUrl } = res.body.items[0];
      expect(fileUrl).toMatch(/\/avatars\/[0-9a-f]{24}\/[0-9a-f-]{36}\.jpg$/);
      // The ref is an HMAC, never the user id: an avatar URL is handed to every
      // customer who sees this provider, and a raw id in it publishes an
      // internal identifier that correlates them across every other surface.
      expect(fileUrl).not.toContain('u-1');
    });

    it('refuses VIDEO for an avatar even though the shared allowlist permits it', async () => {
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer', 'provider'] };
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ purpose: 'avatar', items: [{ contentType: 'video/mp4', sizeBytes: 1024 }] });

      // A 400, not a 500: the refusal is a bad request and must render as one.
      expect(res.status).toBe(400);
    });

    it('refuses GIF and HEIC for an avatar', async () => {
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer', 'provider'] };
      for (const contentType of ['image/gif', 'image/heic']) {
        const res = await request(app.getHttpServer())
          .post('/v1/media/presigned-url')
          .send({ purpose: 'avatar', items: [{ contentType, sizeBytes: 1024 }] });
        expect(res.status).toBe(400);
      }
    });

    it('keeps request media on its existing layout', async () => {
      // Changing that scheme would orphan every URL already stored in
      // ServiceRequest.mediaUrls[].
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ items: [{ contentType: 'image/jpeg', sizeBytes: 1024 }] });
      expect(res.body.items[0].fileUrl).toContain('/requests/u-1/');
    });

    it('rejects content types outside the whitelist with VALIDATION_ERROR', async () => {
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ items: [{ contentType: 'application/exe', sizeBytes: 1024 }] });
      expect(res.status).toBe(400);
    });

    it('rejects oversized files (> 10 MB)', async () => {
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ items: [{ contentType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024 }] });
      expect(res.status).toBe(400);
    });

    it('accepts exactly MAX_FILES_PER_REQUEST (6) in one batch', async () => {
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const items = Array.from({ length: 6 }, () => ({
        contentType: 'image/jpeg',
        sizeBytes: 1,
      }));
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ items });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(6);
    });

    it('rejects more than MAX_FILES_PER_REQUEST (6) in one batch', async () => {
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const items = Array.from({ length: 7 }, () => ({
        contentType: 'image/jpeg',
        sizeBytes: 1,
      }));
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ items });
      expect(res.status).toBe(400);
    });

    it('synthesises the key server-side — the wire never gets to pick it', async () => {
      fakeAuthedUser = { id: 'u-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        // Hostile filename: try to escape the user's prefix.
        .send({
          items: [{ contentType: 'image/jpeg', sizeBytes: 1, filename: '../../etc/passwd' }],
        });
      expect(res.status).toBe(200);
      // The synthesised key MUST stay under requests/<userId>/.
      expect(res.body.items[0].fileUrl).toMatch(
        /\/v1\/media\/files\/requests\/u-1\/[0-9a-f-]{36}\.jpg$/,
      );
      expect(res.body.items[0].fileUrl).not.toContain('..');
      expect(res.body.items[0].fileUrl).not.toContain('passwd');
    });
  });

  describe('PUT /v1/media/uploads/* + GET /v1/media/files/*', () => {
    it('round-trips a binary upload: presign → PUT → GET', async () => {
      fakeAuthedUser = { id: 'u-2', sessionId: 's', jti: 'j', roles: ['customer'] };
      const presign = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ items: [{ contentType: 'image/png', sizeBytes: 5 }] });
      expect(presign.status).toBe(200);
      const { uploadUrl, fileUrl } = presign.body.items[0] as {
        uploadUrl: string;
        fileUrl: string;
      };

      // Strip the public origin so supertest hits THIS app.
      const uploadPath = uploadUrl.replace(/^https?:\/\/[^/]+/, '');
      const filePath = fileUrl.replace(/^https?:\/\/[^/]+/, '');

      const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a]);
      const put = await request(app.getHttpServer())
        .put(uploadPath)
        .set('Content-Type', 'image/png')
        .send(body);
      expect(put.status).toBe(204);

      // supertest returns binary GET responses as a Buffer in `.body`
      // when the response Content-Type isn't text-shaped, but does
      // text decoding otherwise. We tell it explicitly to treat the
      // response as a Buffer via `.buffer(true).parse(binaryParser)`.
      const fetched = await request(app.getHttpServer())
        .get(filePath)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(fetched.status).toBe(200);
      expect(Buffer.isBuffer(fetched.body)).toBe(true);
      expect((fetched.body as Buffer).equals(body)).toBe(true);
    });

    it('rejects PUT with a tampered signature (401)', async () => {
      fakeAuthedUser = { id: 'u-3', sessionId: 's', jti: 'j', roles: ['customer'] };
      const presign = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ items: [{ contentType: 'image/png', sizeBytes: 4 }] });
      const uploadUrl = (presign.body.items[0] as { uploadUrl: string }).uploadUrl;
      // Tamper with the sig.
      const tampered = uploadUrl
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/sig=[0-9a-f]+/, 'sig=' + 'a'.repeat(64));

      const res = await request(app.getHttpServer())
        .put(tampered)
        .set('Content-Type', 'image/png')
        .send(Buffer.from('PNG!'));
      expect(res.status).toBe(401);
      // The presigned URL IS the auth for this route; a bad sig
      // surfaces as the same UNAUTHORIZED code as any other 401 the
      // AppError envelope emits — never AUTH_INVALID_CREDENTIALS,
      // which is reserved for the JWT login path.
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects PUT when the uploaded body length disagrees with the signed sizeBytes (400)', async () => {
      fakeAuthedUser = { id: 'u-4', sessionId: 's', jti: 'j', roles: ['customer'] };
      const presign = await request(app.getHttpServer())
        .post('/v1/media/presigned-url')
        .send({ items: [{ contentType: 'image/png', sizeBytes: 4 }] });
      const uploadPath = (presign.body.items[0] as { uploadUrl: string }).uploadUrl.replace(
        /^https?:\/\/[^/]+/,
        '',
      );
      const res = await request(app.getHttpServer())
        .put(uploadPath)
        .set('Content-Type', 'image/png')
        .send(Buffer.from('toolong'));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET returns 404 for an unknown key (no traversal info leaked)', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/media/files/requests/u-999/does-not-exist.jpg',
      );
      expect(res.status).toBe(404);
    });
  });
});
