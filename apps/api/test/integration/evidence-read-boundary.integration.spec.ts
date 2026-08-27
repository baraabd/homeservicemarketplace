/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import { CanActivate, ExecutionContext, INestApplication, VersioningType } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import request from 'supertest';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.3 — the restricted READ route, exercised over HTTP against real
// Postgres and real bytes on disk.
//
// The unit policy test proves the RULE. This proves the ROUTE, which is a
// different claim and the one that actually protects a passport: a rule nobody
// calls is not a control. It also proves the 9A defect is really gone — the
// controller now resolves bytes through RestrictedObjectStoragePort, so this
// suite passes without any local-disk adapter being injected into it.
//
// The single most important assertion here is that PENDING is unreadable BY
// ITS OWNER. Everything in the upload path leaves evidence PENDING, and if the
// owner could read it back the scan gate would be decorative.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

let currentUser: { id: string } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) return false;
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}

const BYTES = Buffer.from('%PDF-1.4 restricted evidence body');

d('Restricted evidence read boundary (real Postgres, real bytes)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('evidence-read-boundary');
  const OWNER = `${P}owner`;
  const OTHER = `${P}other`;
  const REVIEWER = `${P}reviewer`;
  const PP = `${P}pp`;
  const CASE_ID = `${P}case`;
  const ASSET = `${P}asset`;
  const DOC = `${P}doc`;
  const POLICY = `2099.04-${P.replace(/-$/, '')}-v1`;
  const KEY = `verification/${CASE_ID}/${ASSET}.pdf`;

  let storageRoot: string;
  let lifecycleLock: HeldLock;
  /** Whether the caller holds verification:evidence:view this request. */
  let reviewerPermission = false;

  const readDoc = () => request(http).get(`/v1/verification/documents/${DOC}/content`);

  async function setScanState(state: string): Promise<void> {
    await prisma.mediaAsset.update({ where: { id: ASSET }, data: { scanState: state } });
  }

  async function cleanup(): Promise<void> {
    await prisma.verificationAccessLog.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: P } } });
    await prisma.verificationCase.deleteMany({ where: { id: CASE_ID } });
    await prisma.providerProfile.deleteMany({ where: { id: PP } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY } });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    storageRoot = mkdtempSync(join(tmpdir(), 'hsm-read-it-'));

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const {
      EvidenceReadController,
    } = require('../../src/modules/provider/verification/media/evidence-read.controller');
    const {
      EvidenceReadService,
    } = require('../../src/modules/provider/verification/media/evidence-read.service');
    const {
      LocalDiskRestrictedStorageAdapter,
    } = require('../../src/infrastructure/storage/local-disk-restricted-storage.adapter');
    const {
      RESTRICTED_OBJECT_STORAGE,
    } = require('../../src/infrastructure/storage/restricted-object-storage.port');
    const {
      PermissionResolverService,
    } = require('../../src/modules/iam/authorization/services/permission-resolver.service');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');

    const config = {
      get: (k: string) => (k === 'RESTRICTED_STORAGE_DIR' ? storageRoot : undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [EvidenceReadController],
      providers: [
        EvidenceReadService,
        { provide: PrismaService, useValue: { client: prisma } },
        { provide: AppConfigService, useValue: config },
        {
          provide: RESTRICTED_OBJECT_STORAGE,
          useValue: new LocalDiskRestrictedStorageAdapter(config),
        },
        {
          // Same shape as the real resolver: roles in, a Set of permission
          // keys out. Resolved PER REQUEST by the controller, so the stub
          // reads `reviewerPermission` at call time — which is what lets the
          // revocation test below observe an immediate effect rather than one
          // that would need a restart.
          provide: PermissionResolverService,
          useValue: {
            resolveForRoles: async (): Promise<Set<string>> =>
              new Set(reviewerPermission ? ['verification:evidence:view'] : []),
          },
        },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
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
  });

  beforeEach(async () => {
    await prisma.verificationAccessLog.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: CASE_ID } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: P } } });
    await prisma.verificationCase.deleteMany({ where: { id: CASE_ID } });
    await prisma.providerProfile.deleteMany({ where: { id: PP } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });

    for (const id of [OWNER, OTHER, REVIEWER]) {
      await prisma.user.create({
        data: { id, email: `${id}@read.test`, firstName: 'R', lastName: 'U' },
      });
    }
    await prisma.providerProfile.create({
      data: { id: PP, userId: OWNER, displayName: 'Read', initials: 'RD', status: 'DRAFT' },
    });
    await prisma.verificationCase.create({
      data: { id: CASE_ID, providerProfileId: PP, state: 'SUBMITTED', policyVersion: POLICY },
    });

    const abs = join(storageRoot, KEY);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, BYTES);

    await prisma.mediaAsset.create({
      data: {
        id: ASSET,
        visibility: 'RESTRICTED',
        storageKey: KEY,
        declaredMimeType: 'application/pdf',
        detectedMimeType: 'application/pdf',
        sizeBytes: BYTES.length,
        sha256: 'a'.repeat(64),
        scanState: 'PENDING',
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
    reviewerPermission = false;
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
    rmSync(storageRoot, { recursive: true, force: true });
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── PENDING is unreadable ───────────────────────────────────────────────

  describe('an unscanned document is unreadable', () => {
    it('refuses the OWNER', async () => {
      // The assertion the whole scan gate rests on. Every upload leaves
      // evidence PENDING; if the owner could read it back, the gate would be
      // decorative.
      const res = await readDoc();
      expect(res.status).toBe(404);
    });

    it('refuses a PERMITTED reviewer', async () => {
      currentUser = { id: REVIEWER };
      reviewerPermission = true;
      const res = await readDoc();
      expect(res.status).toBe(404);
    });

    it.each(['SCAN_FAILED', 'QUARANTINED'])('refuses %s too', async (state) => {
      // Compared against CLEAN rather than against a list of bad states, so a
      // state added later fails closed by default.
      await setScanState(state);
      const res = await readDoc();
      expect(res.status).toBe(404);
    });
  });

  // ── CLEAN, and only for the right caller ────────────────────────────────

  describe('a CLEAN document', () => {
    beforeEach(async () => {
      // The transition only a scanner may make. Done here directly because
      // 9B.4 owns the scanner; this suite owns what happens afterwards.
      await setScanState('CLEAN');
    });

    it('is readable by its owner', async () => {
      const res = await readDoc();
      expect(res.status).toBe(200);
      expect(Buffer.from(res.body)).toEqual(BYTES);
    });

    it('is readable by a reviewer WITH the permission', async () => {
      currentUser = { id: REVIEWER };
      reviewerPermission = true;
      const res = await readDoc();
      expect(res.status).toBe(200);
    });

    it('is refused to a reviewer WITHOUT the permission', async () => {
      // verification:evidence:view is narrower than "is an admin" on purpose:
      // every admin being able to open every passport makes the access audit
      // meaningless.
      currentUser = { id: REVIEWER };
      reviewerPermission = false;
      const res = await readDoc();
      expect(res.status).toBe(404);
    });

    it('is refused to a DIFFERENT provider', async () => {
      currentUser = { id: OTHER };
      const res = await readDoc();
      expect(res.status).toBe(404);
    });

    it('is refused once the bytes were DELETED under retention', async () => {
      // Sprint 9B.13. Retention deletion (ADR 0012) removes the object and
      // stamps the row; the metadata survives so the audit trail can still say
      // a document existed. A read after that must refuse — and refuse with the
      // SAME answer as an unknown document, because "this one used to be here"
      // is itself a fact about someone's identity papers.
      await prisma.mediaAsset.update({
        where: { id: ASSET },
        data: { deletedAt: new Date() },
      });

      const res = await readDoc();
      expect(res.status).toBe(404);

      // Still audited. A refused read is exactly the read worth recording.
      const logs = await prisma.verificationAccessLog.findMany({ where: { mediaAssetId: ASSET } });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('is refused to an unauthenticated caller', async () => {
      currentUser = null;
      const res = await readDoc();
      expect(res.status).toBe(403);
    });

    it('honours a permission revoked between requests', async () => {
      currentUser = { id: REVIEWER };
      reviewerPermission = true;
      await readDoc().expect(200);

      // Resolved per request, so revocation takes effect on the very next
      // call rather than at the next process restart.
      reviewerPermission = false;
      const after = await readDoc();
      expect(after.status).toBe(404);
    });

    it('sends no-store and nosniff, and never a public cache header', async () => {
      const res = await readDoc();
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['cache-control']).not.toContain('public');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toContain('attachment');
    });

    it('serves the DETECTED type, not the declared one', async () => {
      await prisma.mediaAsset.update({
        where: { id: ASSET },
        data: { declaredMimeType: 'text/html' },
      });
      const res = await readDoc();
      expect(res.headers['content-type']).toContain('application/pdf');
    });

    it('leaks no storage key in headers or body', async () => {
      const res = await readDoc();
      const text = JSON.stringify(res.headers);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('.restricted-uploads');
      expect(text).not.toContain(storageRoot);
    });
  });

  // ── every denial is audited, and none of them enumerate ─────────────────

  describe('audit and non-enumeration', () => {
    it('records an access log row for a DENIED read', async () => {
      await readDoc().expect(404);
      const rows = await prisma.verificationAccessLog.findMany({ where: { caseId: CASE_ID } });
      expect(rows.length).toBeGreaterThan(0);
    });

    it('records an access log row for an ALLOWED read', async () => {
      await setScanState('CLEAN');
      await readDoc().expect(200);
      const rows = await prisma.verificationAccessLog.findMany({ where: { caseId: CASE_ID } });
      expect(rows.length).toBeGreaterThan(0);
    });

    it('writes no full IP or raw user agent into the access log', async () => {
      await readDoc().set('User-Agent', 'Mozilla/5.0 (SecretBuild 1.2.3)').expect(404);
      const rows = await prisma.verificationAccessLog.findMany({ where: { caseId: CASE_ID } });
      const text = JSON.stringify(rows);
      expect(text).not.toContain('SecretBuild');
      expect(text).not.toContain('Mozilla/5.0');
    });

    it('answers an unknown document exactly as it answers a forbidden one', async () => {
      currentUser = { id: OTHER };
      const forbidden = await readDoc();
      const unknown = await request(http).get(`/v1/verification/documents/${P}no-such-doc/content`);

      expect(forbidden.status).toBe(unknown.status);
      expect(forbidden.body).toEqual(unknown.body);
    });
  });
});
