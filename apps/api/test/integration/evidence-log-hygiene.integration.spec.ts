/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Logger,
  VersioningType,
} from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.3 — what the evidence paths are allowed to WRITE DOWN.
//
// The sibling suites prove who may read a document. This one proves that
// merely handling it does not spill it somewhere else. Logs outlive requests:
// they go to stdout, then to a shipper, then to an index a far larger group of
// people can search than could ever call the read route. A storage key or a
// filename in a log line quietly relocates identity data from a controlled
// store into an uncontrolled one, and no 404 on the read route undoes that.
//
// The audit-metadata assertions in evidence-upload.integration.spec.ts cover a
// DIFFERENT sink: rows this system writes on purpose. This covers the sink it
// writes by accident.
//
// Both halves are exercised: the success path AND the failure paths, because
// failure is where leaks actually happen — an error handler reaching for
// "context" is the most common way a filename or a key ends up in a log line
// that the happy path would never have produced.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

let currentUser: { id: string } | null = null;
let reviewerPermission = false;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) return false;
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}

class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

const PDF = Buffer.from('%PDF-1.4\nSENTINELBODY-do-not-log-me\n');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.from(' '.repeat(64))]);

/** Distinctive enough that a substring match cannot collide with real prose. */
const FILENAME = 'SENTINELFILE-passport-Qx7.pdf';

d('Evidence log hygiene (real Postgres, real storage)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('evidence-log-hygiene');
  const CASE_A = `${P}case-a`;
  const CASE_B = `${P}case-b`;
  const USER_A = `${P}user-a`;
  const USER_B = `${P}user-b`;
  const PP_A = `${P}pp-a`;
  const PP_B = `${P}pp-b`;
  const POLICY = `2099.06-${P.replace(/-$/, '')}-v1`;

  let storageRoot: string;
  let lifecycleLock: HeldLock;

  /** Everything any evidence code path wrote to a log during one test. */
  let captured: string[] = [];
  let restoreConsole: (() => void) | null = null;

  const record = (...args: unknown[]): void => {
    for (const a of args) {
      if (a === undefined) continue;
      try {
        captured.push(typeof a === 'string' ? a : JSON.stringify(a));
      } catch {
        captured.push(String(a));
      }
    }
  };

  const capturedText = (): string => captured.join('\n');

  const REQUIREMENTS = {
    policyVersion: POLICY,
    verificationRequired: true,
    requirements: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null, fromVersion: POLICY }],
  };

  const prepare = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/verification/evidence/prepare').send(body);

  const putContent = (assetId: string, bytes: Buffer, contentType: string) =>
    request(http)
      .put(`/v1/me/provider/verification/evidence/${assetId}/content`)
      .set('Content-Type', contentType)
      .send(bytes);

  const finalize = (assetId: string) =>
    request(http).post(`/v1/me/provider/verification/evidence/${assetId}/finalize`).send({});

  const readDoc = (docId: string) =>
    request(http).get(`/v1/verification/documents/${docId}/content`);

  async function seedCase(
    caseId: string,
    userId: string,
    profileId: string,
    state = 'DRAFT',
  ): Promise<void> {
    await prisma.user.create({
      data: { id: userId, email: `${userId}@hygiene.test`, firstName: 'H', lastName: 'U' },
    });
    await prisma.providerProfile.create({
      data: {
        id: profileId,
        userId,
        displayName: `Hy ${profileId}`,
        initials: 'HY',
        status: 'DRAFT',
      },
    });
    await prisma.verificationCase.create({
      data: {
        id: caseId,
        providerProfileId: profileId,
        state,
        policyVersion: POLICY,
        requirementsSnapshot: REQUIREMENTS,
      },
    });
  }

  async function cleanup(): Promise<void> {
    await prisma.verificationAccessLog.deleteMany({ where: { caseId: { startsWith: P } } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: { startsWith: P } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: P } } });
    await prisma.verificationCase.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY } });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    storageRoot = mkdtempSync(join(tmpdir(), 'hsm-hygiene-it-'));

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const {
      EvidenceUploadController,
    } = require('../../src/modules/provider/verification/media/evidence-upload.controller');
    const {
      EvidenceUploadService,
    } = require('../../src/modules/provider/verification/media/evidence-upload.service');
    const {
      EvidenceReadController,
    } = require('../../src/modules/provider/verification/media/evidence-read.controller');
    const {
      EvidenceReadService,
    } = require('../../src/modules/provider/verification/media/evidence-read.service');
    const {
      VerificationSettingsService,
    } = require('../../src/modules/provider/verification/verification-settings.service');
    const {
      PlatformSettingRepository,
    } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
    const {
      LocalDiskRestrictedStorageAdapter,
    } = require('../../src/infrastructure/storage/local-disk-restricted-storage.adapter');
    const {
      RESTRICTED_OBJECT_STORAGE,
    } = require('../../src/infrastructure/storage/restricted-object-storage.port');
    const {
      PermissionResolverService,
    } = require('../../src/modules/iam/authorization/services/permission-resolver.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');

    const config = {
      get: (k: string) => (k === 'RESTRICTED_STORAGE_DIR' ? storageRoot : undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [EvidenceUploadController, EvidenceReadController],
      providers: [
        EvidenceUploadService,
        EvidenceReadService,
        VerificationSettingsService,
        PlatformSettingRepository,
        TransactionRunner,
        AuditService,
        AuditEventRepository,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        // Sprint 9B.8 — ProviderCapabilityGuard now gates these routes and
        // needs this service. A SET rather than a blanket allow: these suites
        // exercise the real provider flows, and a guard stubbed to pass would
        // stop them proving the routes are gated at all.
        {
          provide: ProviderCapabilityService,
          useValue: {
            can: async (_u: string, c: string) => new Set(['MANAGE_VERIFICATION']).has(c),
          },
        },
        { provide: AppConfigService, useValue: config },
        {
          provide: RESTRICTED_OBJECT_STORAGE,
          useValue: new LocalDiskRestrictedStorageAdapter(config),
        },
        {
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
      .overrideGuard(CsrfGuard)
      .useClass(PassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    http = app.getHttpServer();

    // Every `new Logger(ctx)` in the services under test resolves through the
    // static ref, so overriding it here catches all of them without any
    // service having to be constructed by hand.
    Logger.overrideLogger({
      log: record,
      error: record,
      warn: record,
      debug: record,
      verbose: record,
      fatal: record,
    });

    // A stray console.* is the other way a filename reaches stdout, and it
    // bypasses the Nest logger entirely.
    const originals = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };
    console.log = record;
    console.warn = record;
    console.error = record;
    console.info = record;
    console.debug = record;
    restoreConsole = () => {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
      console.info = originals.info;
      console.debug = originals.debug;
    };

    await cleanup();
    await prisma.verificationRequirementPolicy.create({
      data: {
        version: POLICY,
        // XD: XA/XB/XC are taken by the upload, cleanup and read-boundary
        // suites, and the live-policy-per-scope index is global.
        country: 'XD',
        requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
        publishedAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
  });

  beforeEach(async () => {
    await prisma.verificationAccessLog.deleteMany({ where: { caseId: { startsWith: P } } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: { startsWith: P } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: P } } });
    await prisma.verificationCase.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });

    await seedCase(CASE_A, USER_A, PP_A);
    await seedCase(CASE_B, USER_B, PP_B);
    currentUser = { id: USER_A };
    reviewerPermission = false;
    captured = [];
  });

  afterAll(async () => {
    Logger.overrideLogger(false);
    restoreConsole?.();
    await cleanup();
    await app?.close();
    rmSync(storageRoot, { recursive: true, force: true });
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  /** Prepare + upload + finalize, returning the server-side facts to scan for. */
  async function fullSuccessPath(): Promise<{ assetId: string; docId: string }> {
    const res = await prepare({
      kind: 'INDIVIDUAL_IDENTITY',
      declaredMimeType: 'application/pdf',
      sizeBytes: PDF.length,
      filename: FILENAME,
    });
    expect(res.status).toBe(200);
    const assetId = res.body.assetId as string;

    expect((await putContent(assetId, PDF, 'application/pdf')).status).toBe(200);
    const fin = await finalize(assetId);
    expect(fin.status).toBe(200);

    const doc = await prisma.verificationDocument.findFirst({ where: { mediaAssetId: assetId } });
    return { assetId, docId: doc.id as string };
  }

  /** The server-derived facts about an asset that must never be logged. */
  async function secretsOf(assetId: string): Promise<string[]> {
    const row = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    return [row.storageKey as string, row.sha256 as string];
  }

  // ── the harness itself ──────────────────────────────────────────────────

  it('the capture harness would actually catch a leak', () => {
    // Without this, every assertion below passes just as well when the capture
    // is silently broken and `captured` is always empty. A hygiene gate that
    // cannot fail is worse than none, because it gets believed.
    new Logger('hygiene-tripwire').warn({ msg: 'planted', name: FILENAME });
    expect(capturedText()).toContain(FILENAME);
  });

  // ── the success path ────────────────────────────────────────────────────

  it('leaks nothing while successfully accepting a document', async () => {
    const { assetId } = await fullSuccessPath();

    const text = capturedText();
    expect(text).not.toContain(FILENAME);
    expect(text).not.toContain(USER_A);
    expect(text).not.toContain(storageRoot);
    expect(text).not.toContain('SENTINELBODY');
    for (const s of await secretsOf(assetId)) expect(text).not.toContain(s);
  });

  it('leaks nothing while serving the document to its owner', async () => {
    const { assetId, docId } = await fullSuccessPath();
    await prisma.mediaAsset.update({ where: { id: assetId }, data: { scanState: 'CLEAN' } });

    captured = [];
    expect((await readDoc(docId)).status).toBe(200);

    const text = capturedText();
    expect(text).not.toContain(FILENAME);
    expect(text).not.toContain(storageRoot);
    expect(text).not.toContain('SENTINELBODY');
    for (const s of await secretsOf(assetId)) expect(text).not.toContain(s);
  });

  // ── the failure paths ───────────────────────────────────────────────────

  it('leaks nothing when the bytes are rejected', async () => {
    // An executable declared as a PDF. The rejection path is the one most
    // likely to want to say WHICH file was rejected.
    const res = await prepare({
      kind: 'INDIVIDUAL_IDENTITY',
      declaredMimeType: 'application/pdf',
      sizeBytes: EXE.length,
      filename: FILENAME,
    });
    expect(res.status).toBe(200);
    const assetId = res.body.assetId as string;

    captured = [];
    expect((await putContent(assetId, EXE, 'application/pdf')).status).toBe(400);

    const text = capturedText();
    expect(text).not.toContain(FILENAME);
    expect(text).not.toContain(storageRoot);
    const row = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
    expect(text).not.toContain(row.storageKey);
  });

  it('leaks nothing when a read is denied', async () => {
    const { assetId, docId } = await fullSuccessPath();

    captured = [];
    // PENDING for its owner, then a foreign caller, then an id that does not
    // exist. All three answer 404, and none may explain why.
    expect((await readDoc(docId)).status).toBe(404);
    currentUser = { id: USER_B };
    expect((await readDoc(docId)).status).toBe(404);
    expect((await readDoc(`${P}no-such-doc`)).status).toBe(404);

    const text = capturedText();
    expect(text).not.toContain(FILENAME);
    expect(text).not.toContain(storageRoot);
    for (const s of await secretsOf(assetId)) expect(text).not.toContain(s);
  });

  it('leaks nothing when the sweep cannot reach storage', async () => {
    // The compensating path: storage is down, and the sweep must say so
    // without naming the object it failed to delete.
    const {
      EvidenceCleanupService,
    } = require('../../src/modules/provider/verification/media/evidence-cleanup.service');

    const { assetId } = await fullSuccessPath();
    const row = await prisma.mediaAsset.findUnique({ where: { id: assetId } });

    // Turn the finalized asset back into an expired, abandoned preparation so
    // the sweep considers it. Doing it here keeps the fixture honest: the
    // sweep still applies its own rule to what it finds.
    await prisma.verificationDocument.deleteMany({ where: { mediaAssetId: assetId } });
    await prisma.mediaAsset.update({
      where: { id: assetId },
      data: { uploadCompletedAt: null, uploadExpiresAt: new Date(Date.now() - 3_600_000) },
    });

    const failing = {
      deleteObject: async (): Promise<never> => {
        // A raw driver error that names the object, exactly the kind a real
        // filesystem or S3 client produces.
        throw new Error(`ENOENT: cannot unlink ${row.storageKey} under ${storageRoot}`);
      },
    };
    const svc = new EvidenceCleanupService({ client: prisma }, failing);

    captured = [];
    const out = await svc.sweepExpiredPreparations();
    expect(out.failed).toBe(1);

    const text = capturedText();
    expect(text).toContain('evidence.cleanup.storage_delete_failed');
    expect(text).not.toContain(row.storageKey);
    expect(text).not.toContain(storageRoot);
    expect(text).not.toContain(FILENAME);
  });

  // ── credential-shaped material, on every path ───────────────────────────

  it('writes no credential, token or signed-URL shaped material on any path', async () => {
    await fullSuccessPath();
    currentUser = { id: USER_B };
    await readDoc(`${P}nope`);

    const text = capturedText();
    for (const pattern of [
      /AKIA[0-9A-Z]{8}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /X-Amz-Signature=/i,
      /X-Amz-Credential=/i,
      /\bBearer\s+[A-Za-z0-9._-]{16,}/,
      /\beyJ[A-Za-z0-9_-]{10,}\./,
      /aws_secret_access_key/i,
    ]) {
      expect(text).not.toMatch(pattern);
    }
  });
});
