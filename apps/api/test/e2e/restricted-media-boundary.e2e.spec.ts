import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import { CanActivate, INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import express from 'express';

jest.setTimeout(30_000);

import { MediaController } from '../../src/modules/media/media.controller';
import { LocalDiskStorageAdapter } from '../../src/infrastructure/storage/local-disk-storage.adapter';
import { STORAGE_PORT } from '../../src/infrastructure/storage/storage.port';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { AppConfigService } from '../../src/config/app-config.service';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 9B — the public media route must not touch restricted evidence.
//
// docs/adr/0009-restricted-identity-media.md §3
//
// GET /v1/media/files/* is @Public(), resolves any key from the URL path, and
// sets `Cache-Control: public, max-age=31536000, immutable`. If identity
// evidence were ever reachable through it, a passport would be served
// unauthenticated AND cached by intermediaries for a year — which would make
// the retention guarantees of ADR 0012 unenforceable as well.
//
// In a correctly configured deployment restricted objects live in a different
// bucket/root and this is unreachable. These tests cover the deployment that is
// NOT correctly configured: a shared root, a copied env file. Configuration is
// the control; this is what catches the misconfiguration.
//
// Asserted at the HTTP boundary rather than by calling isRestrictedKey(),
// because the thing being claimed is about the ROUTE.
// ─────────────────────────────────────────────────────────────────────────────

class AllowAll implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/** A local-disk adapter that would happily serve anything.
 *
 *  The refusal must come from the CONTROLLER, not from storage failing to find
 *  a file — otherwise the test passes for the wrong reason. So every key
 *  resolves to a real, existing file (this spec), which streams successfully.
 *  A path that does not exist would make `createReadStream(...).pipe(res)`
 *  error after the headers are sent and hang the response instead of failing. */
const REAL_FILE = __filename;

const permissiveLocal = {
  absolutePathForKey: () => REAL_FILE,
  fileExists: async () => true,
  acceptUpload: jest.fn().mockResolvedValue(undefined),
} as unknown as LocalDiskStorageAdapter;

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [MediaController],
    providers: [
      { provide: STORAGE_PORT, useValue: { presignUpload: jest.fn() } },
      { provide: LocalDiskStorageAdapter, useValue: permissiveLocal },
      // The real app registers this via APP_FILTER in AppModule. Without it an
      // AppError surfaces as a bare 500, and the assertions below would be
      // testing Nest's default handler rather than the route's actual wire
      // behaviour.
      { provide: AppConfigService, useValue: { get: () => 'test' } },
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(AllowAll)
    .overrideGuard(CsrfGuard)
    .useClass(AllowAll)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // main.ts wires express.raw() on the upload route so req.body is a Buffer.
  app.use('/v1/media/uploads', express.raw({ type: '*/*', limit: '1mb' }));
  await app.init();
  return app;
}

describe('GET /v1/media/files/* — restricted keys', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it.each([
    'verification/case-1/asset-1.pdf',
    'verification/case-1/asset-2.png',
    'verification/anything.jpg',
  ])('refuses to serve %s', async (key) => {
    // The adapter above would have served it. The 404 must come from the route.
    await request(app.getHttpServer()).get(`/v1/media/files/${key}`).expect(404);
  });

  it('answers 404, not 403, so a prober cannot confirm a case exists', async () => {
    // A distinguishable response would let an unauthenticated caller enumerate
    // case ids by watching the status code change.
    const restricted = await request(app.getHttpServer()).get(
      '/v1/media/files/verification/case-real/a.pdf',
    );
    const missing = await request(app.getHttpServer()).get('/v1/media/files/verification/nope');

    expect(restricted.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(restricted.body).toEqual(missing.body);
  });

  it('refuses a URL-encoded restricted key', async () => {
    // %2F decoding happens before the check; if it did not, encoding the
    // separator would walk straight past the guard.
    await request(app.getHttpServer())
      .get('/v1/media/files/verification%2Fcase-1%2Fasset.pdf')
      .expect(404);
  });

  it('still serves genuinely public request media', async () => {
    // The other half. A guard that fails safe by blocking everything is an
    // outage, and this route carries every seeker's request photos.
    const res = await request(app.getHttpServer()).get('/v1/media/files/requests/user-1/photo.jpg');
    expect(res.status).not.toBe(404);
  });

  it('does not over-block a public key that merely starts with the same letters', async () => {
    // `verificationsomething/` is not the restricted namespace. A bare
    // startsWith would capture it and break a legitimate public read.
    const res = await request(app.getHttpServer()).get(
      '/v1/media/files/verificationsomething/photo.jpg',
    );
    expect(res.status).not.toBe(404);
  });

  it('never sets a public cache header on a refused restricted read', async () => {
    // Belt and braces: even the refusal must not teach an intermediary to
    // cache anything about this path.
    const res = await request(app.getHttpServer()).get('/v1/media/files/verification/case-1/a.pdf');
    expect(res.headers['cache-control'] ?? '').not.toMatch(/public/);
  });
});

describe('PUT /v1/media/uploads/* — restricted keys', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('refuses to write into the restricted namespace', async () => {
    // Evidence forgery, not merely an upload: a file written here would be
    // read by a reviewer AS evidence.
    await request(app.getHttpServer())
      .put(
        '/v1/media/uploads/verification/case-1/forged.pdf?sig=x&exp=9999999999&ct=image/png&sz=3',
      )
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from([1, 2, 3]))
      .expect(400);

    expect(permissiveLocal.acceptUpload).not.toHaveBeenCalled();
  });

  it('refuses BEFORE validating the signature', async () => {
    // Ordering matters. Checking the namespace only after the HMAC would mean
    // anyone who ever obtains a signing capability can write evidence.
    await request(app.getHttpServer())
      .put('/v1/media/uploads/verification/case-1/forged.pdf')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from([1, 2, 3]))
      .expect(400);

    expect(permissiveLocal.acceptUpload).not.toHaveBeenCalled();
  });
});
