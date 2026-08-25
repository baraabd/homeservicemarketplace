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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import request from 'supertest';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.4 — the scan lifecycle against a real database and real bytes.
//
// The unit suite proves the control flow with doubles. This proves the part
// that only a database can: that the conditional claim actually excludes a
// second worker, that the audit and outbox rows really land in the same
// transaction as the state change, and — the assertion the whole sprint exists
// for — that a QUARANTINED document is refused by the REAL read route.
//
// A quarantine that is enforced only by a unit test is not a quarantine.
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

const PDF_HEAD = Buffer.from('%PDF-1.4\n');
const PDF_TAIL = Buffer.from('\ntrailer\n%%EOF\n');
const CLEAN_PDF = Buffer.concat([PDF_HEAD, Buffer.from('ordinary evidence'), PDF_TAIL]);
const TRUNCATED_PDF = Buffer.concat([PDF_HEAD, Buffer.from('cut off here')]);

d('Evidence scanning (real Postgres, real bytes)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let scanService: any;
  let makeService: (scanner: unknown) => any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('evidence-scan');
  const OWNER = `${P}owner`;
  const PP = `${P}pp`;
  const CASE_ID = `${P}case`;
  const POLICY = `2099.07-${P.replace(/-$/, '')}-v1`;

  let storageRoot: string;
  let lifecycleLock: HeldLock;
  let outboxLock: HeldLock;
  let EICAR_PDF: Buffer;

  const readDoc = (docId: string) =>
    request(http).get(`/v1/verification/documents/${docId}/content`);

  /** Create a finished, unscanned evidence asset with the given bytes. */
  async function seedAsset(id: string, bytes: Buffer, filename = 'passport.pdf'): Promise<string> {
    const key = `verification/${CASE_ID}/${id}.pdf`;
    const abs = join(storageRoot, key);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);

    await prisma.mediaAsset.create({
      data: {
        id,
        visibility: 'RESTRICTED',
        storageKey: key,
        declaredMimeType: 'application/pdf',
        detectedMimeType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: 'a'.repeat(64),
        scanState: 'PENDING',
        ownerUserId: OWNER,
        originalFilename: filename,
        verificationCaseId: CASE_ID,
        uploadCompletedAt: new Date(),
      },
    });
    return id;
  }

  async function attachDocument(assetId: string, docId: string): Promise<string> {
    await prisma.verificationDocument.create({
      data: {
        id: docId,
        caseId: CASE_ID,
        kind: 'INDIVIDUAL_IDENTITY',
        mediaAssetId: assetId,
        uploadedByUserId: OWNER,
      },
    });
    return docId;
  }

  const stateOf = async (id: string): Promise<string> =>
    (await prisma.mediaAsset.findUnique({ where: { id } })).scanState;

  /**
   * Everything this suite creates EXCEPT the policy.
   *
   * VerificationCase.policyVersion is a foreign key to the policy row, so
   * deleting the policy between tests makes every later case create fail with
   * a constraint violation. The policy is created once in beforeAll and lives
   * for the whole suite; only the fixtures hanging off it are recycled.
   */
  async function cleanupFixtures(): Promise<void> {
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { startsWith: P } } });
    await prisma.verificationAccessLog.deleteMany({ where: { caseId: { startsWith: P } } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: { startsWith: P } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: P } } });
    await prisma.verificationCase.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  }

  /** The fixtures AND the policy. Only safe when no case references it. */
  async function cleanup(): Promise<void> {
    await cleanupFixtures();
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY } });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    // SHARED on the outbox, because this suite is a PRODUCER.
    //
    // Scanning enqueues evidence.scanned rows. outbox.integration.spec.ts runs
    // real workers that claim whatever is PENDING and due — by design, since a
    // queue consumer cannot be selective — and it asserts table-wide totals.
    // Left unlocked, its workers dead-letter this suite's events (no handler is
    // registered in ITS module) and its counts include rows it never enqueued.
    //
    // That suite takes the same lock EXCLUSIVE, so shared here is exactly the
    // mutual exclusion needed: many producers may run together, but never
    // alongside the consumer. Taken after providerLifecycle, in the same order
    // as every other suite, so the two cannot deadlock.
    outboxLock = await acquireAdvisoryLock('outbox', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    storageRoot = mkdtempSync(join(tmpdir(), 'hsm-scan-it-'));

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const {
      EvidenceReadController,
    } = require('../../src/modules/provider/verification/media/evidence-read.controller');
    const {
      EvidenceReadService,
    } = require('../../src/modules/provider/verification/media/evidence-read.service');
    const {
      EvidenceScanService,
    } = require('../../src/modules/provider/verification/media/evidence-scan.service');
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
      MALWARE_SCANNER_PORT,
      DeterministicTestScanner,
      EICAR_TEST_SIGNATURE,
    } = require('../../src/modules/provider/verification/media/malware-scanner.port');
    const {
      PermissionResolverService,
    } = require('../../src/modules/iam/authorization/services/permission-resolver.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');

    EICAR_PDF = Buffer.concat([PDF_HEAD, Buffer.from(EICAR_TEST_SIGNATURE), PDF_TAIL]);

    const config = {
      get: (k: string) => (k === 'RESTRICTED_STORAGE_DIR' ? storageRoot : undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [EvidenceReadController],
      providers: [
        EvidenceReadService,
        EvidenceScanService,
        VerificationSettingsService,
        PlatformSettingRepository,
        TransactionRunner,
        AuditService,
        AuditEventRepository,
        OutboxRepository,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        {
          provide: RESTRICTED_OBJECT_STORAGE,
          useValue: new LocalDiskRestrictedStorageAdapter(config),
        },
        { provide: MALWARE_SCANNER_PORT, useValue: new DeterministicTestScanner() },
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
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    http = app.getHttpServer();
    scanService = moduleRef.get(EvidenceScanService);

    // A second service instance with a different scanner, for the cases where
    // the scanner's ANSWER is the thing under test.
    makeService = (scanner: unknown) =>
      new EvidenceScanService(
        { client: prisma },
        new LocalDiskRestrictedStorageAdapter(config),
        scanner,
        moduleRef.get(AuditService),
        moduleRef.get(TransactionRunner),
        moduleRef.get(VerificationSettingsService),
        moduleRef.get(OutboxRepository),
      );

    await cleanup();
    await prisma.verificationRequirementPolicy.create({
      data: {
        version: POLICY,
        // XE: XA/XB/XC/XD are taken by the sibling suites, and the
        // live-policy-per-scope index is global.
        country: 'XE',
        requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
        publishedAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
  });

  beforeEach(async () => {
    await cleanupFixtures();
    await prisma.user.create({
      data: { id: OWNER, email: `${OWNER}@scan.test`, firstName: 'S', lastName: 'U' },
    });
    await prisma.providerProfile.create({
      data: { id: PP, userId: OWNER, displayName: 'Scan', initials: 'SC', status: 'DRAFT' },
    });
    await prisma.verificationCase.create({
      data: { id: CASE_ID, providerProfileId: PP, state: 'SUBMITTED', policyVersion: POLICY },
    });
    currentUser = { id: OWNER };
    reviewerPermission = false;
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
    rmSync(storageRoot, { recursive: true, force: true });
    await prisma.$disconnect();
    await outboxLock?.release();
    await lifecycleLock.release();
  });

  // ── the happy path, end to end ──────────────────────────────────────────

  it('clears an ordinary document and makes it readable through the REAL route', async () => {
    const id = await seedAsset(`${P}a1`, CLEAN_PDF);
    const doc = await attachDocument(id, `${P}d1`);

    // Unreadable before the scan. This is the guarantee the upload path leans
    // on entirely.
    expect((await readDoc(doc)).status).toBe(404);

    const out = await scanService.scanPending();
    expect(out.cleared).toBe(1);
    expect(await stateOf(id)).toBe('CLEAN');

    const res = await readDoc(doc);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body)).toEqual(CLEAN_PDF);
  });

  // ── quarantine, enforced by the route and not just the rule ─────────────

  it('quarantines an infected document and the route still refuses it', async () => {
    const id = await seedAsset(`${P}a2`, EICAR_PDF);
    const doc = await attachDocument(id, `${P}d2`);

    const out = await scanService.scanPending();

    expect(out.quarantined).toBe(1);
    expect(await stateOf(id)).toBe('QUARANTINED');

    // The assertion the sprint exists for.
    expect((await readDoc(doc)).status).toBe(404);

    // Even for a reviewer who holds the permission: quarantine is about the
    // FILE, not about who is asking.
    currentUser = { id: `${P}reviewer` };
    reviewerPermission = true;
    expect((await readDoc(doc)).status).toBe(404);
  });

  it('records the signature but never the bytes', async () => {
    const id = await seedAsset(`${P}a3`, EICAR_PDF);
    await scanService.scanPending();

    const row = await prisma.mediaAsset.findUnique({ where: { id } });
    expect(row.scanSignature).toBe('EICAR-Test-File');
    expect(row.scannedAt).toBeInstanceOf(Date);
  });

  // ── rejection is not quarantine ─────────────────────────────────────────

  it('REJECTS a truncated document rather than quarantining it', async () => {
    // The distinction that keeps an innocent provider's broken upload out of
    // the malware retention window.
    const id = await seedAsset(`${P}a4`, TRUNCATED_PDF);
    const doc = await attachDocument(id, `${P}d4`);

    const out = await scanService.scanPending();

    expect(out.rejected).toBe(1);
    expect(await stateOf(id)).toBe('REJECTED');
    expect((await readDoc(doc)).status).toBe(404);
  });

  // ── fail closed ─────────────────────────────────────────────────────────

  it('leaves evidence PENDING and unreadable when no scanner is configured', async () => {
    const {
      UnconfiguredMalwareScanner,
    } = require('../../src/modules/provider/verification/media/malware-scanner.port');

    const id = await seedAsset(`${P}a5`, CLEAN_PDF);
    const doc = await attachDocument(id, `${P}d5`);

    const out = await makeService(new UnconfiguredMalwareScanner()).scanPending();

    expect(out.cleared).toBe(0);
    expect(await stateOf(id)).toBe('PENDING');
    expect((await readDoc(doc)).status).toBe(404);
  });

  it('records SCAN_FAILED when the scanner errors, and never CLEAN', async () => {
    const id = await seedAsset(`${P}a6`, CLEAN_PDF);

    const failing = {
      scannerId: 'failing',
      isRealScanner: true,
      scan: async () => ({ state: 'FAILED', scannerId: 'failing', reason: 'timeout' }),
    };
    await makeService(failing).scanPending();

    expect(await stateOf(id)).toBe('SCAN_FAILED');
  });

  it('never releases a quarantined document, however often a scanner clears it', async () => {
    const id = await seedAsset(`${P}a7`, EICAR_PDF);
    await scanService.scanPending();
    expect(await stateOf(id)).toBe('QUARANTINED');

    const optimistic = {
      scannerId: 'optimistic',
      isRealScanner: true,
      scan: async () => ({ state: 'CLEAN', scannerId: 'optimistic' }),
    };
    await makeService(optimistic).scanPending();
    await makeService(optimistic).scanPending();

    expect(await stateOf(id)).toBe('QUARANTINED');
  });

  // ── idempotence and races ───────────────────────────────────────────────

  it('is idempotent: a second sweep finds nothing to do', async () => {
    await seedAsset(`${P}a8`, CLEAN_PDF);

    const first = await scanService.scanPending();
    const second = await scanService.scanPending();

    expect(first.cleared).toBe(1);
    expect(second.examined).toBe(0);
  });

  it('two concurrent sweeps write once and report once', async () => {
    const id = await seedAsset(`${P}a9`, CLEAN_PDF);

    const [a, b] = await Promise.all([scanService.scanPending(), scanService.scanPending()]);

    expect(a.cleared + b.cleared).toBe(1);
    expect(await stateOf(id)).toBe('CLEAN');

    // And exactly one audit row, because the audit write shares the
    // transaction with the claim.
    const audits = await prisma.auditEvent.findMany({
      where: { userId: OWNER, type: 'VERIFICATION_EVIDENCE_SCAN_CLEARED' },
    });
    expect(audits).toHaveLength(1);
  });

  // ── what it writes down ─────────────────────────────────────────────────

  it('writes an audit row and an outbox event in the same transaction', async () => {
    const id = await seedAsset(`${P}a10`, EICAR_PDF);
    await scanService.scanPending();

    const audits = await prisma.auditEvent.findMany({ where: { userId: OWNER } });
    expect(audits.map((a: { type: string }) => a.type)).toEqual([
      'VERIFICATION_EVIDENCE_SCAN_QUARANTINED',
    ]);

    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: id } });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('evidence.scanned');
    expect(events[0].payload).toMatchObject({ scanState: 'QUARANTINED' });
  });

  it('puts no storage key, filename or hash into the audit metadata', async () => {
    const id = await seedAsset(`${P}a11`, CLEAN_PDF, 'SENTINELNAME-passport.pdf');
    await scanService.scanPending();

    const audits = await prisma.auditEvent.findMany({ where: { userId: OWNER } });
    const text = JSON.stringify(audits.map((a: { metadata: unknown }) => a.metadata));
    expect(text).not.toContain('SENTINELNAME');
    expect(text).not.toContain(`verification/${CASE_ID}/${id}.pdf`);
    expect(text).not.toContain('a'.repeat(64));
  });

  it('logs counts only, naming no document', async () => {
    const captured: string[] = [];
    const record = (...args: unknown[]): void => {
      for (const a of args) captured.push(typeof a === 'string' ? a : JSON.stringify(a));
    };
    Logger.overrideLogger({
      log: record,
      error: record,
      warn: record,
      debug: record,
      verbose: record,
      fatal: record,
    });

    try {
      const id = await seedAsset(`${P}a12`, CLEAN_PDF, 'SENTINELLOG-passport.pdf');
      await scanService.scanPending();

      const text = captured.join('\n');
      expect(text).not.toContain('SENTINELLOG');
      expect(text).not.toContain(`verification/${CASE_ID}/${id}.pdf`);
      expect(text).not.toContain(OWNER);
    } finally {
      Logger.overrideLogger(false);
    }
  });
});
