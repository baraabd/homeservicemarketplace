/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import { CanActivate, ExecutionContext, INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.5 — the case workflow over real HTTP against a real database.
//
// The unit suite proves the control flow with doubles. This proves what only a
// database can:
//
//   - the state change, the decision row, the audit entry, the outbox event and
//     the notification really are ONE transaction
//   - the conditional claim really does exclude a second writer
//   - the full loop works: submit -> request action -> resubmit
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

let currentUser: { id: string } | null = null;
let permissions = new Set<string>();

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

d('Verification case workflow (real Postgres, real routes)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('case-workflow');
  const OWNER = `${P}owner`;
  const REVIEWER = `${P}reviewer`;
  const PP = `${P}pp`;
  const CASE_ID = `${P}case`;
  const POLICY = `2099.08-${P.replace(/-$/, '')}-v1`;
  const CATEGORY = `${P}cat`;

  let lifecycleLock: HeldLock;
  let outboxLock: HeldLock;

  const REQS = {
    policyVersion: POLICY,
    verificationRequired: true,
    requirements: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null, fromVersion: POLICY }],
  };

  const submit = (body: Record<string, unknown> = {}) =>
    request(http).post('/v1/me/provider/verification/case/submit').send(body);
  const assign = (caseId: string, body: Record<string, unknown> = {}) =>
    request(http).post(`/v1/admin/verification/cases/${caseId}/assign`).send(body);
  const requestAction = (caseId: string, body: Record<string, unknown>) =>
    request(http).post(`/v1/admin/verification/cases/${caseId}/request-action`).send(body);

  const stateOf = async (): Promise<string> =>
    (await prisma.verificationCase.findUnique({ where: { id: CASE_ID } })).state;

  async function seedCase(state = 'DRAFT', cleanEvidence = true): Promise<void> {
    await prisma.verificationCase.create({
      data: {
        id: CASE_ID,
        providerProfileId: PP,
        state,
        policyVersion: POLICY,
        requirementsSnapshot: REQS,
      },
    });
    const assetId = `${P}asset`;
    await prisma.mediaAsset.create({
      data: {
        id: assetId,
        visibility: 'RESTRICTED',
        storageKey: `verification/${CASE_ID}/${assetId}.pdf`,
        declaredMimeType: 'application/pdf',
        detectedMimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        scanState: cleanEvidence ? 'CLEAN' : 'PENDING',
        ownerUserId: OWNER,
        verificationCaseId: CASE_ID,
        uploadCompletedAt: new Date(),
      },
    });
    await prisma.verificationDocument.create({
      data: {
        id: `${P}doc`,
        caseId: CASE_ID,
        kind: 'INDIVIDUAL_IDENTITY',
        mediaAssetId: assetId,
        uploadedByUserId: OWNER,
      },
    });
  }

  /** Fixtures only — never the policy, which cases reference by foreign key. */
  async function cleanupFixtures(): Promise<void> {
    await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { startsWith: P } } });
    await prisma.verificationDecision.deleteMany({ where: { caseId: { startsWith: P } } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: { startsWith: P } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: P } } });
    await prisma.verificationCase.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: CATEGORY } });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');
    // SHARED on the outbox: this suite PRODUCES verification.case.* events, and
    // outbox.integration.spec.ts runs real workers that claim whatever is due.
    outboxLock = await acquireAdvisoryLock('outbox', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const {
      PlatformSettingRepository,
    } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
    const {
      VerificationSettingsService,
    } = require('../../src/modules/provider/verification/verification-settings.service');
    const {
      VerificationCaseWorkflowService,
    } = require('../../src/modules/provider/verification/case/verification-case-workflow.service');
    const {
      ProviderVerificationCaseController,
    } = require('../../src/modules/provider/verification/case/provider-verification-case.controller');
    const {
      ProviderVerificationCaseService,
    } = require('../../src/modules/provider/verification/case/provider-verification-case.service');
    const {
      AdminVerificationCaseCommandsController,
    } = require('../../src/modules/admin/verification/admin-verification-case-commands.controller');
    // Sprint 9B.6 added read routes to that controller, so it now needs the
    // queue and detail services too.
    const {
      AdminVerificationQueueService,
    } = require('../../src/modules/admin/verification/admin-verification-queue.service');
    const {
      AdminVerificationCaseService,
    } = require('../../src/modules/admin/verification/admin-verification-case.service');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const {
      PermissionsGuard,
    } = require('../../src/modules/iam/authorization/guards/permissions.guard');

    const config = { get: () => undefined, isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderVerificationCaseController, AdminVerificationCaseCommandsController],
      providers: [
        VerificationCaseWorkflowService,
        AdminVerificationQueueService,
        AdminVerificationCaseService,
        VerificationSettingsService,
        PlatformSettingRepository,
        ProviderVerificationCaseService,
        TransactionRunner,
        AuditService,
        AuditEventRepository,
        OutboxRepository,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: 'AppConfigService', useValue: config },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .overrideGuard(CsrfGuard)
      .useClass(PassGuard)
      .overrideGuard(PermissionsGuard)
      .useValue({
        canActivate: () => permissions.has('verification:decide'),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    http = app.getHttpServer();

    await cleanupFixtures();
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY } });
    await prisma.verificationRequirementPolicy.create({
      data: {
        version: POLICY,
        // XF: XA-XE are taken by the sibling suites and the
        // live-policy-per-scope index is global.
        country: 'XF',
        requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
        publishedAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
  });

  beforeEach(async () => {
    await cleanupFixtures();
    for (const [id, email] of [
      [OWNER, `${OWNER}@wf.test`],
      [REVIEWER, `${REVIEWER}@wf.test`],
    ]) {
      await prisma.user.create({
        data: {
          id,
          email,
          firstName: 'W',
          lastName: 'F',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
    }
    await prisma.providerProfile.create({
      data: {
        id: PP,
        userId: OWNER,
        displayName: 'Workflow Provider Services',
        headline: 'Experienced provider serving the test region',
        bio: 'A sufficiently long biography for the onboarding policy to consider this profile complete for submission.',
        phoneNumber: '+963900000111',
        serviceAreaCity: 'Aleppo',
        serviceAreaCountry: 'SY',
        serviceAreaRadiusKm: 25,
        initials: 'WP',
        status: 'DRAFT',
      },
    });
    // The onboarding policy requires at least one service category, and this
    // suite's submissions must clear it — otherwise every submit is a 422 about
    // the profile rather than a test of the workflow.
    await prisma.serviceCategory.create({
      data: { id: CATEGORY, slug: CATEGORY, labelEn: 'WF', labelAr: 'WF', icon: 'bolt' },
    });
    await prisma.providerProfileServiceCategory.create({
      data: { providerProfileId: PP, serviceCategoryId: CATEGORY },
    });
    currentUser = { id: OWNER };
    permissions = new Set();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY } });
    await app?.close();
    await prisma.$disconnect();
    await outboxLock?.release();
    await lifecycleLock.release();
  });

  // ── the loop ────────────────────────────────────────────────────────────

  it('runs the whole loop: submit, return, resubmit', async () => {
    await seedCase('DRAFT');

    const first = await submit();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: 'SUBMITTED', changed: true });

    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    expect((await assign(CASE_ID)).status).toBe(200);
    expect(await stateOf()).toBe('IN_REVIEW');

    const returned = await requestAction(CASE_ID, {
      reasonCode: 'DOCUMENT_ILLEGIBLE',
      note: 'The identity page is out of focus.',
    });
    expect(returned.status).toBe(200);
    expect(await stateOf()).toBe('ACTION_REQUIRED');

    // The provider fixes it and sends it back through the SAME edge.
    currentUser = { id: OWNER };
    const again = await submit();
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ state: 'SUBMITTED', changed: true });
  });

  // ── atomicity ───────────────────────────────────────────────────────────

  it('writes the decision, the audit row, the event and the notification together', async () => {
    await seedCase('SUBMITTED');
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);

    await requestAction(CASE_ID, { reasonCode: 'DOCUMENT_MISSING' });

    const [decisions, audits, events, notes] = await Promise.all([
      prisma.verificationDecision.findMany({ where: { caseId: CASE_ID } }),
      prisma.auditEvent.findMany({ where: { userId: REVIEWER } }),
      prisma.outboxEvent.findMany({ where: { aggregateId: CASE_ID } }),
      prisma.notification.findMany({ where: { userId: OWNER } }),
    ]);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      outcome: 'ACTION_REQUIRED',
      reasonCode: 'DOCUMENT_MISSING',
      fromState: 'SUBMITTED',
      toState: 'ACTION_REQUIRED',
      decidedByUserId: REVIEWER,
    });
    expect(audits.map((a: { type: string }) => a.type)).toEqual([
      'VERIFICATION_CASE_ACTION_REQUESTED',
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('verification.case.action_required');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: 'VERIFICATION_ACTION_REQUIRED',
      resourceType: 'VERIFICATION_CASE',
      resourceId: CASE_ID,
    });
  });

  it('keeps the reviewer note off the notification', async () => {
    await seedCase('SUBMITTED');
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);

    await requestAction(CASE_ID, {
      reasonCode: 'OTHER',
      note: 'SENTINELNOTE the passport photo is unreadable',
    });

    const notes = await prisma.notification.findMany({ where: { userId: OWNER } });
    expect(JSON.stringify(notes)).not.toContain('SENTINELNOTE');

    // It IS on the case, which is access-controlled.
    const kase = await prisma.verificationCase.findUnique({ where: { id: CASE_ID } });
    expect(kase.reviewerNotes).toContain('SENTINELNOTE');
  });

  // ── idempotence and concurrency ─────────────────────────────────────────

  it('is idempotent: a repeated submission changes nothing', async () => {
    await seedCase('DRAFT');

    const first = await submit();
    const second = await submit();

    expect(first.body.changed).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ state: 'SUBMITTED', changed: false });

    const audits = await prisma.auditEvent.findMany({ where: { userId: OWNER } });
    expect(audits).toHaveLength(1);
  });

  it('two concurrent submissions produce exactly one transition', async () => {
    await seedCase('DRAFT');

    const [a, b] = await Promise.all([submit(), submit()]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.changed, b.body.changed].filter(Boolean)).toHaveLength(1);

    const audits = await prisma.auditEvent.findMany({ where: { userId: OWNER } });
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: CASE_ID } });
    expect(audits).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('refuses a caller working from a stale view', async () => {
    await seedCase('ACTION_REQUIRED');
    const res = await submit({ expectedState: 'DRAFT' });
    expect(res.status).toBe(409);
    expect(await stateOf()).toBe('ACTION_REQUIRED');
  });

  // ── authorization ───────────────────────────────────────────────────────

  it('refuses a reviewer without the permission', async () => {
    await seedCase('SUBMITTED');
    currentUser = { id: REVIEWER };
    permissions = new Set();
    expect((await assign(CASE_ID)).status).toBe(403);
    expect(await stateOf()).toBe('SUBMITTED');
  });

  it('refuses a reviewer acting on their own case', async () => {
    await seedCase('SUBMITTED');
    await prisma.providerProfile.update({ where: { id: PP }, data: { userId: REVIEWER } });
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);

    const res = await assign(CASE_ID);
    expect(res.status).toBe(403);
    expect(await stateOf()).toBe('SUBMITTED');
  });

  it('answers a case that is not yours exactly as one that does not exist', async () => {
    await seedCase('DRAFT');
    currentUser = { id: REVIEWER };
    // The reviewer has no provider profile, so there is no case to submit.
    const res = await submit();
    expect(res.status).toBe(404);
  });

  // ── readiness ───────────────────────────────────────────────────────────

  it('refuses submission while the evidence has not cleared scanning', async () => {
    await seedCase('DRAFT', false);

    const res = await submit();

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('EVIDENCE_NOT_CLEAN');
    expect(await stateOf()).toBe('DRAFT');
  });

  it('never offers approve in a command result', async () => {
    await seedCase('SUBMITTED');
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);

    const res = await assign(CASE_ID);
    expect(res.body.availableActions).not.toContain('approve');
    expect(res.body.availableActions).toContain('requestAction');
  });
});
