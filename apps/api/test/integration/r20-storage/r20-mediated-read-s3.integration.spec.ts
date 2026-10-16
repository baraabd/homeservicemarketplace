/* eslint-disable @typescript-eslint/no-require-imports -- Prisma, Nest modules and the AWS SDK load only inside the gate. */
export {};

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import { CanActivate, ExecutionContext, INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import type { S3Client } from '@aws-sdk/client-s3';

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../../support/db-isolation';
import {
  adapterConfig,
  sdk,
  bucketName,
  client,
  createBucket,
  destroyBucket,
  endpoint,
  putRaw,
  r20Enabled,
} from './r20-s3-fixture';

// R20 — the restricted evidence READ ROUTE over real S3-compatible storage and
// real Postgres.
//
// test/integration/evidence-read-boundary proves the same matrix against LOCAL
// disk with a stubbed permission resolver. This suite changes the two things
// that matter in production: bytes come from the S3 restricted adapter, and the
// reviewer permission is resolved by the REAL PermissionResolverService from
// UserRole/RolePermission rows, so "revoked" means a deleted grant row.
//
// Contract doubles, labelled: authentication is a stub guard (as in the local
// suite — sessions are not R20's subject) and RedisService is an empty object
// (resolveFreshForUser never touches the cache).
//
// Gate: RUN_R20_STORAGE_INTEGRATION=1 and RUN_DB_INTEGRATION=1 with a
// disposable DATABASE_URL.

const d = r20Enabled && process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

let currentUser: { id: string } | null = null;
class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) return false;
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}

const BYTES = Buffer.from('%PDF-1.4\nR20 synthetic evidence over S3 only.\n%%EOF');

d('R20 restricted evidence read route — real S3-compatible storage + real Postgres', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let healthy: any;
  let active: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  let admin: S3Client;
  let locks: HeldLock | undefined;
  let stageDir: string;

  const P = fixturePrefix('r20-mediated-read');
  const OWNER = `${P}owner`;
  const OTHER = `${P}other`;
  const REVIEWER = `${P}reviewer`;
  const PP = `${P}pp`;
  const CASE_ID = `${P}case`;
  const ASSET = `${P}asset`;
  const DOC = `${P}doc`;
  const ROLE = `${P}evidence-reviewer`;
  const POLICY = `2099.10-${P.replace(/-$/, '')}-v1`;
  const KEY = `verification/${CASE_ID}/${ASSET}.pdf`;
  const RESTR = bucketName('read');

  const readDoc = () => request(http).get(`/v1/verification/documents/${DOC}/content`);
  const readUnknown = () => request(http).get(`/v1/verification/documents/${P}no-such-doc/content`);

  /** The error body as JSON whatever Content-Type it was sent with. */
  function errorJson(res: { body: unknown; text?: string }): unknown {
    if (Buffer.isBuffer(res.body)) return JSON.parse(res.body.toString('utf8'));
    return res.body;
  }

  /** Storage failures preserve a JSON denial with no downloadable document. */
  function expectStorageSide404Headers(res: { headers: Record<string, string> }): void {
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['cache-control']).toContain('no-store');
  }

  async function grantReviewer(): Promise<void> {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: ROLE } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: REVIEWER, roleId: role.id } },
      create: { userId: REVIEWER, roleId: role.id },
      update: {},
    });
  }

  async function revokeReviewer(): Promise<void> {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: ROLE } });
    await prisma.userRole.deleteMany({ where: { userId: REVIEWER, roleId: role.id } });
  }

  async function cleanup(): Promise<void> {
    await prisma.verificationAccessLog.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.mediaAsset.deleteMany({ where: { id: ASSET } });
    await prisma.verificationCase.deleteMany({ where: { id: CASE_ID } });
    await prisma.providerProfile.deleteMany({ where: { id: PP } });
    await prisma.role.deleteMany({ where: { name: ROLE } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY } });
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle' as const, mode: 'shared' as const },
      { resource: 'mediaAssets' as const, mode: 'shared' as const },
    ]);
    prisma = require('@homeservicemarketplace/database').prisma;
    admin = client();
    stageDir = mkdtempSync(join(tmpdir(), 'hsm-r20-read-'));
    await createBucket(admin, RESTR, { versioning: true, marker: 'restricted' });

    const { PrismaService } = require('../../../src/infrastructure/prisma/prisma.service');
    const { AppConfigService } = require('../../../src/config/app-config.service');
    const { RedisService } = require('../../../src/infrastructure/redis/redis.service');
    const {
      EvidenceReadController,
    } = require('../../../src/modules/provider/verification/media/evidence-read.controller');
    const {
      EvidenceReadService,
    } = require('../../../src/modules/provider/verification/media/evidence-read.service');
    const {
      S3RestrictedStorageAdapter,
    } = require('../../../src/infrastructure/storage/s3-restricted-storage.adapter');
    const {
      RESTRICTED_OBJECT_STORAGE,
    } = require('../../../src/infrastructure/storage/restricted-object-storage.port');
    const {
      PermissionResolverService,
    } = require('../../../src/modules/iam/authorization/services/permission-resolver.service');
    const {
      RoleRepository,
    } = require('../../../src/infrastructure/persistence/iam/role.repository');
    const {
      AllExceptionsFilter,
    } = require('../../../src/infrastructure/http/all-exceptions.filter');
    const {
      JwtAuthGuard,
    } = require('../../../src/modules/iam/authentication/guards/jwt-auth.guard');

    const cfg = adapterConfig({ restricted: RESTR });
    healthy = new S3RestrictedStorageAdapter(cfg);
    active = healthy;
    // Delegates to whichever adapter the test selects, so "storage became
    // unavailable" is a real adapter pointed at a dead endpoint, not a mock.
    const switchable = {
      openReadStream: (key: string, expected?: unknown) => active.openReadStream(key, expected),
      head: (key: string) => active.head(key),
      putObjectFromFile: (input: unknown) => active.putObjectFromFile(input),
      deleteObject: (key: string) => active.deleteObject(key),
      eraseObject: (key: string) => active.eraseObject(key),
      close: () => undefined,
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [EvidenceReadController],
      providers: [
        EvidenceReadService,
        PermissionResolverService,
        RoleRepository,
        { provide: PrismaService, useValue: { client: prisma } },
        { provide: AppConfigService, useValue: cfg },
        { provide: RedisService, useValue: {} },
        { provide: RESTRICTED_OBJECT_STORAGE, useValue: switchable },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(cfg) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    http = app.getHttpServer();

    await cleanup();
    await prisma.verificationRequirementPolicy.create({
      data: {
        version: POLICY,
        country: 'XC',
        requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
        publishedAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
    const permission = await prisma.permission.upsert({
      where: { key: 'verification:evidence:view' },
      create: { key: 'verification:evidence:view', description: 'R20 fixture upsert' },
      update: {},
    });
    await prisma.role.create({
      data: { name: ROLE, rolePermissions: { create: { permissionId: permission.id } } },
    });
  });

  beforeEach(async () => {
    active = healthy;
    await prisma.verificationAccessLog.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.mediaAsset.deleteMany({ where: { id: ASSET } });
    await prisma.verificationCase.deleteMany({ where: { id: CASE_ID } });
    await prisma.providerProfile.deleteMany({ where: { id: PP } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    for (const id of [OWNER, OTHER, REVIEWER]) {
      await prisma.user.create({
        data: { id, email: `${id}@r20.test`, firstName: 'R', lastName: 'T', status: 'ACTIVE' },
      });
    }
    await prisma.providerProfile.create({
      data: { id: PP, userId: OWNER, displayName: 'R20', initials: 'RT', status: 'DRAFT' },
    });
    await prisma.verificationCase.create({
      data: { id: CASE_ID, providerProfileId: PP, state: 'SUBMITTED', policyVersion: POLICY },
    });
    // Fresh object per test through the real adapter write path. Erase first
    // so the immutable-write rule does not refuse a re-run.
    await healthy.eraseObject(KEY);
    const src = join(stageDir, `${randomUUID()}.pdf`);
    writeFileSync(src, BYTES);
    await healthy.putObjectFromFile({
      key: KEY,
      sourcePath: src,
      contentType: 'application/pdf',
      sizeBytes: BYTES.length,
    });
    await prisma.mediaAsset.create({
      data: {
        id: ASSET,
        visibility: 'RESTRICTED',
        storageKey: KEY,
        declaredMimeType: 'application/pdf',
        detectedMimeType: 'application/pdf',
        sizeBytes: BYTES.length,
        sha256: 'b'.repeat(64),
        scanState: 'CLEAN',
        ownerUserId: OWNER,
        originalFilename: 'passport.pdf',
        verificationCaseId: CASE_ID,
        uploadCompletedAt: new Date(),
      },
    });
    await prisma.verificationDocument.create({
      data: {
        id: DOC,
        caseId: CASE_ID,
        kind: 'INDIVIDUAL_IDENTITY',
        mediaAssetId: ASSET,
        uploadedByUserId: OWNER,
      },
    });
    currentUser = { id: OWNER };
  });

  afterAll(async () => {
    try {
      if (prisma) await cleanup();
      await app?.close();
    } finally {
      if (admin) {
        await destroyBucket(admin, RESTR);
        admin.destroy();
      }
      if (stageDir) rmSync(stageDir, { recursive: true, force: true });
      await locks?.release();
    }
  });

  it('serves the owner the exact bytes, through the API, with no storage URL', async () => {
    const res = await readDoc()
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(BYTES);
    expect(res.headers.location).toBeUndefined();
  });

  it('serves a reviewer holding a REAL grant, and refuses on the next request after revocation', async () => {
    currentUser = { id: REVIEWER };
    await grantReviewer();
    await readDoc().expect(200);
    await revokeReviewer();
    expect((await readDoc()).status).toBe(404);
  });

  it('refuses a reviewer who never held the grant, and a different provider', async () => {
    currentUser = { id: REVIEWER };
    expect((await readDoc()).status).toBe(404);
    currentUser = { id: OTHER };
    expect((await readDoc()).status).toBe(404);
  });

  it('refuses an unauthenticated caller', async () => {
    currentUser = null;
    expect((await readDoc()).status).toBe(403);
  });

  it('sends no-store/private, nosniff and attachment, and leaks no key, bucket or endpoint', async () => {
    const res = await readDoc();
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['cache-control']).toContain('private');
    expect(res.headers['cache-control']).not.toContain('public');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toContain('attachment');
    const headers = JSON.stringify(res.headers);
    for (const s of [KEY, RESTR, new URL(endpoint()).host, 'X-Amz-Signature']) {
      expect(headers).not.toContain(s);
    }
  });

  it('a MISSING object answers exactly like an unknown document', async () => {
    const { DeleteObjectCommand } = sdk();
    await admin.send(new DeleteObjectCommand({ Bucket: RESTR, Key: KEY }));
    const missing = await readDoc().buffer(true);
    const unknown = await readUnknown();
    expect(missing.status).toBe(404);
    expect(missing.status).toBe(unknown.status);
    expect(errorJson(missing)).toEqual(unknown.body);
    expect(JSON.stringify(errorJson(missing))).not.toContain(KEY);
    expectStorageSide404Headers(missing);
  });

  it('UNAVAILABLE storage answers exactly like an unknown document and names nothing', async () => {
    active =
      new (require('../../../src/infrastructure/storage/s3-restricted-storage.adapter').S3RestrictedStorageAdapter)(
        adapterConfig({ restricted: RESTR }, undefined, 'http://127.0.0.1:9'),
      );
    const down = await readDoc().buffer(true);
    const unknown = await readUnknown();
    expect(down.status).toBe(404);
    expect(errorJson(down)).toEqual(unknown.body);
    expectStorageSide404Headers(down);
    const text = JSON.stringify(errorJson(down)) + JSON.stringify(down.headers);
    for (const s of [KEY, RESTR, '127.0.0.1:9', 'ECONNREFUSED']) expect(text).not.toContain(s);
  });

  it('refuses a substituted object with the same denial as an unknown document', async () => {
    await putRaw(admin, RESTR, KEY, Buffer.concat([BYTES, Buffer.from('substituted')]));
    const res = await readDoc();
    const unknown = await readUnknown();
    expect(res.status).toBe(404);
    expect(errorJson(res)).toEqual(unknown.body);
    expectStorageSide404Headers(res);
  });

  it('audits allowed AND denied reads, without raw IP or user agent', async () => {
    await readDoc().set('User-Agent', 'R20SecretAgent/9.9').expect(200);
    currentUser = { id: OTHER };
    await readDoc().set('User-Agent', 'R20SecretAgent/9.9').expect(404);
    const rows = await prisma.verificationAccessLog.findMany({ where: { caseId: CASE_ID } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((r: { outcome: string }) => r.outcome)).size).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(rows)).not.toContain('R20SecretAgent');
    expect(JSON.stringify(rows)).not.toContain(KEY);
  });
});
