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
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
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

  it('offers approve now that the atomic transaction exists', async () => {
    await seedCase('SUBMITTED');
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);

    const res = await assign(CASE_ID);
    expect(res.body.availableActions).toContain('approve');
    expect(res.body.availableActions).toContain('requestAction');
    // Still withheld: no scheduler drives the system actor's edge.
    expect(res.body.availableActions).not.toContain('expire');
  });

  // ── the review queue, over real HTTP ────────────────────────────────────

  describe('the review queue', () => {
    const queue = (qs = '') => request(http).get(`/v1/admin/verification/cases${qs}`);

    it('refuses a caller without verification:decide', async () => {
      await seedCase('SUBMITTED');
      currentUser = { id: REVIEWER };
      permissions = new Set();
      expect((await queue()).status).toBe(403);
    });

    it('lists a live case for a permitted reviewer, with server-computed actions', async () => {
      await seedCase('SUBMITTED');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const res = await queue();
      expect(res.status).toBe(200);

      const mine = res.body.items.find((i: { id: string }) => i.id === CASE_ID);
      expect(mine).toMatchObject({ state: 'SUBMITTED', providerProfileId: PP });
      expect(mine.availableActions).toEqual(
        expect.arrayContaining(['assign', 'requestAction', 'reject']),
      );
      expect(mine.availableActions).toContain('approve');
      // Still withheld: the system actor's edge has no scheduler.
      expect(mine.availableActions).not.toContain('expire');
    });

    it('hides the actions on a case the reviewer is the subject of', async () => {
      await seedCase('SUBMITTED');
      await prisma.providerProfile.update({ where: { id: PP }, data: { userId: REVIEWER } });
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const mine = (await queue()).body.items.find((i: { id: string }) => i.id === CASE_ID);
      expect(mine.availableActions).toEqual([]);
      expect(mine.blockedReason).toBe('SELF_REVIEW');
    });

    it('excludes terminal cases from the default view', async () => {
      await seedCase('REJECTED');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const ids = (await queue()).body.items.map((i: { id: string }) => i.id);
      expect(ids).not.toContain(CASE_ID);

      // ...but returns it when asked for explicitly.
      const asked = (await queue('?state=REJECTED')).body.items.map((i: { id: string }) => i.id);
      expect(asked).toContain(CASE_ID);
    });

    it('refuses an unknown state rather than quietly ignoring the filter', async () => {
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);
      expect((await queue('?state=NONSENSE')).status).toBe(400);
    });

    it('carries no storage key, filename or hash', async () => {
      await seedCase('SUBMITTED');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const text = JSON.stringify((await queue()).body);
      expect(text).not.toMatch(/storageKey|sha256|\.pdf/);
    });

    it('serves ONE specific case by id, and its audit trail', async () => {
      await seedCase('SUBMITTED');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const detail = await request(http).get(`/v1/admin/verification/cases/${CASE_ID}`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ id: CASE_ID, state: 'SUBMITTED' });

      await requestAction(CASE_ID, { reasonCode: 'DOCUMENT_MISSING' });

      const audit = await request(http).get(`/v1/admin/verification/cases/${CASE_ID}/audit`);
      expect(audit.status).toBe(200);
      expect(audit.body.items.map((i: { type: string }) => i.type)).toContain(
        'VERIFICATION_CASE_ACTION_REQUESTED',
      );
    });

    it('answers an unknown case id with 404', async () => {
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);
      const res = await request(http).get(`/v1/admin/verification/cases/${P}no-such-case`);
      expect(res.status).toBe(404);
    });
  });

  // ── rejection, end to end ───────────────────────────────────────────────

  describe('rejection', () => {
    it('closes the case, records the decision and tells the provider', async () => {
      await seedCase('IN_REVIEW');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const res = await request(http)
        .post(`/v1/admin/verification/cases/${CASE_ID}/reject`)
        .send({ reasonCode: 'SUSPECTED_FORGERY', note: 'SENTINELREJECT altered document' });

      expect(res.status).toBe(200);
      expect(await stateOf()).toBe('REJECTED');
      expect(res.body.availableActions).toEqual([]);

      const decisions = await prisma.verificationDecision.findMany({ where: { caseId: CASE_ID } });
      expect(decisions[0]).toMatchObject({ outcome: 'REJECTED', reasonCode: 'SUSPECTED_FORGERY' });

      const notes = await prisma.notification.findMany({ where: { userId: OWNER } });
      expect(notes[0].type).toBe('VERIFICATION_REJECTED');
      // Neither the prose nor the reason reaches a row that is listed and pushed.
      const text = JSON.stringify(notes);
      expect(text).not.toContain('SENTINELREJECT');
      expect(text).not.toContain('SUSPECTED_FORGERY');
    });

    it('refuses without a reason', async () => {
      await seedCase('IN_REVIEW');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const res = await request(http)
        .post(`/v1/admin/verification/cases/${CASE_ID}/reject`)
        .send({});
      expect(res.status).toBe(400);
      expect(await stateOf()).toBe('IN_REVIEW');
    });

    it('approves atomically: case, decision, provider state and grant together', async () => {
      // Until Sprint 9B.7 this asserted the route 404'd, because approval was
      // deliberately unbuilt. It is built now, and what matters is that all of
      // it lands together.
      await seedCase('IN_REVIEW');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const res = await request(http)
        .post(`/v1/admin/verification/cases/${CASE_ID}/approve`)
        .send({ reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' });

      expect(res.status).toBe(200);
      expect(await stateOf()).toBe('VERIFIED');

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.verificationState).toBe('VERIFIED');
      expect(profile.verified).toBe(true);
      // The ACCOUNT axis is untouched: approving documents says nothing about
      // whether the account is in good standing.
      expect(profile.standingState).toBeNull();

      const grants = await prisma.providerWorkAccessGrant.findMany({
        where: { providerProfileId: PP },
      });
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({
        status: 'ACTIVE',
        source: 'VERIFIED_DOCUMENTS',
        caseId: CASE_ID,
        grantedByUserId: REVIEWER,
      });

      const decisions = await prisma.verificationDecision.findMany({ where: { caseId: CASE_ID } });
      expect(decisions[0]).toMatchObject({ outcome: 'APPROVED', toState: 'VERIFIED' });
    });

    it('two concurrent approvals produce ONE decision and ONE grant', async () => {
      // The database is the real guarantee: provider_work_access_grant_one_live_per_reason
      // makes the second insert fail, and the conditional case claim makes the
      // second transaction lose. Neither alone is enough.
      await seedCase('IN_REVIEW');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const call = () =>
        request(http)
          .post(`/v1/admin/verification/cases/${CASE_ID}/approve`)
          .send({ reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' });

      await Promise.all([call(), call()]);

      expect(await stateOf()).toBe('VERIFIED');
      expect(await prisma.verificationDecision.count({ where: { caseId: CASE_ID } })).toBe(1);
      expect(await prisma.providerWorkAccessGrant.count({ where: { providerProfileId: PP } })).toBe(
        1,
      );
    });

    it('revocation closes the grant immediately', async () => {
      await seedCase('IN_REVIEW');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      await request(http)
        .post(`/v1/admin/verification/cases/${CASE_ID}/approve`)
        .send({ reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' });

      const res = await request(http)
        .post(`/v1/admin/verification/cases/${CASE_ID}/revoke`)
        .send({ reasonCode: 'TRUST_AND_SAFETY_ACTION' });

      expect(res.status).toBe(200);
      const grants = await prisma.providerWorkAccessGrant.findMany({
        where: { providerProfileId: PP },
      });
      expect(grants[0].status).toBe('REVOKED');
      expect(grants[0].revokedAt).not.toBeNull();

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.verificationState).toBe('EXPIRED');
      expect(profile.verified).toBe(false);
    });
  });

  // ── Sprint 9B.11 — what the provider's own case surface carries ─────────
  //
  // The provider surface could previously say WHAT was required but never what
  // had happened to what was supplied. A provider whose passport is being
  // scanned, was quarantined, or was rejected saw the same screen as one who
  // uploaded nothing — the difference between "wait" and "act".
  describe('the provider view of their own case', () => {
    it('carries each uploaded document and its scan verdict', async () => {
      await seedCase('SUBMITTED');
      currentUser = { id: OWNER };

      const res = await request(http).get('/v1/me/provider/verification/case');

      expect(res.status).toBe(200);
      expect(res.body.case.documents).toHaveLength(1);
      expect(res.body.case.documents[0]).toMatchObject({
        kind: 'INDIVIDUAL_IDENTITY',
        scanState: 'CLEAN',
        superseded: false,
      });
      expect(typeof res.body.case.documents[0].uploadedAt).toBe('string');
    });

    it.each(['PENDING', 'QUARANTINED', 'SCAN_FAILED', 'REJECTED'])(
      'surfaces a %s scan verdict verbatim',
      async (scanState) => {
        // Three different things to say to the person waiting: still checking,
        // malware found, refused before scanning. Collapsing them into one
        // "not ready" would tell a provider to wait when they must act.
        await seedCase('SUBMITTED');
        await prisma.mediaAsset.updateMany({
          where: { verificationCaseId: CASE_ID },
          data: { scanState },
        });
        currentUser = { id: OWNER };

        const res = await request(http).get('/v1/me/provider/verification/case');
        expect(res.body.case.documents[0].scanState).toBe(scanState);
      },
    );

    it('carries the latest decision as a CODE', async () => {
      await seedCase('IN_REVIEW');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);
      await request(http)
        .post(`/v1/admin/verification/cases/${CASE_ID}/request-action`)
        .send({ reasonCode: 'DOCUMENT_ILLEGIBLE', note: 'the scan is blurry, ask again' });

      currentUser = { id: OWNER };
      const res = await request(http).get('/v1/me/provider/verification/case');

      expect(res.body.case.latestDecision).toMatchObject({
        outcome: 'ACTION_REQUIRED',
        reasonCode: 'DOCUMENT_ILLEGIBLE',
      });
    });

    it('NEVER carries the reviewer’s prose', async () => {
      // The reason CODE is a stable, translatable fact the provider can act on.
      // The reviewer's note is internal writing about a person, and Sprint
      // 9B.5 already keeps it off the notification for the same reason.
      const secret = 'internal note: claimant seems evasive';
      await seedCase('IN_REVIEW');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);
      await request(http)
        .post(`/v1/admin/verification/cases/${CASE_ID}/request-action`)
        .send({ reasonCode: 'DOCUMENT_ILLEGIBLE', note: secret });

      currentUser = { id: OWNER };
      const raw = JSON.stringify(
        (await request(http).get('/v1/me/provider/verification/case')).body,
      );

      expect(raw).not.toContain(secret);
      expect(raw).not.toContain('reviewerNotes');
      expect(raw).not.toContain('evasive');
    });

    it('carries no reviewer identity, storage key or internal id', async () => {
      await seedCase('SUBMITTED');
      currentUser = { id: OWNER };
      const raw = JSON.stringify(
        (await request(http).get('/v1/me/provider/verification/case')).body,
      );

      for (const forbidden of [
        'reviewerNotes',
        'assignedToUserId',
        'storageKey',
        'mediaAssetId',
        REVIEWER,
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it('is null before any decision', async () => {
      await seedCase('DRAFT');
      currentUser = { id: OWNER };
      const res = await request(http).get('/v1/me/provider/verification/case');
      expect(res.body.case.latestDecision).toBeNull();
    });
  });

  // ── Sprint 9B.12 — what a REVIEWER needs that was not on the surface ────
  describe('the reviewer view of work access', () => {
    it('reports no grant as null rather than as a false one', async () => {
      await seedCase('SUBMITTED');
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const res = await request(http).get(`/v1/admin/verification/cases/${CASE_ID}`);
      expect(res.status).toBe(200);
      expect(res.body.workAccess).toBeNull();
    });

    it('reports a live grant as active, with its source', async () => {
      await seedCase('VERIFIED');
      await prisma.providerWorkAccessGrant.create({
        data: {
          providerProfileId: PP,
          status: 'ACTIVE',
          source: 'VERIFIED_DOCUMENTS',
          reason: 'TEST',
          grantedAt: new Date(Date.now() - 1000),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const res = await request(http).get(`/v1/admin/verification/cases/${CASE_ID}`);
      expect(res.body.workAccess).toMatchObject({ active: true, source: 'VERIFIED_DOCUMENTS' });
    });

    it('reports an ACTIVE row whose expiry has PASSED as inactive', async () => {
      // The read-time predicate, on the reviewer's screen. Showing "ACTIVE"
      // for access that is already gone would have a reviewer revoke
      // something that lapsed last week — or decline to, believing it live.
      await seedCase('VERIFIED');
      await prisma.providerWorkAccessGrant.create({
        data: {
          providerProfileId: PP,
          status: 'ACTIVE',
          source: 'VERIFIED_DOCUMENTS',
          reason: 'TEST',
          grantedAt: new Date(Date.now() - 2 * 86_400_000),
          expiresAt: new Date(Date.now() - 86_400_000),
        },
      });
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const res = await request(http).get(`/v1/admin/verification/cases/${CASE_ID}`);
      expect(res.body.workAccess.active).toBe(false);
      // The raw column still says ACTIVE — which is exactly why the computed
      // answer has to be the one on screen.
      expect(res.body.workAccess.status).toBe('ACTIVE');
    });

    it('reports a revoked grant as inactive', async () => {
      await seedCase('VERIFIED');
      await prisma.providerWorkAccessGrant.create({
        data: {
          providerProfileId: PP,
          status: 'REVOKED',
          source: 'VERIFIED_DOCUMENTS',
          reason: 'TEST',
          grantedAt: new Date(Date.now() - 1000),
          revokedAt: new Date(),
        },
      });
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);

      const res = await request(http).get(`/v1/admin/verification/cases/${CASE_ID}`);
      expect(res.body.workAccess.active).toBe(false);
      expect(res.body.workAccess.revokedAt).not.toBeNull();
    });
  });

  describe('the queue date filter', () => {
    beforeEach(async () => {
      await seedCase('SUBMITTED');
      await prisma.verificationCase.update({
        where: { id: CASE_ID },
        data: { submittedAt: new Date('2026-06-15T12:00:00Z') },
      });
      currentUser = { id: REVIEWER };
      permissions = new Set(['verification:decide']);
    });

    const queue = (q: string) => request(http).get(`/v1/admin/verification/cases?${q}`);
    const ids = (body: { items: Array<{ id: string }> }) => body.items.map((i) => i.id);

    it('includes a case inside the window', async () => {
      const res = await queue('submittedFrom=2026-06-01&submittedTo=2026-06-30');
      expect(ids(res.body)).toContain(CASE_ID);
    });

    it('excludes a case before the window', async () => {
      const res = await queue('submittedFrom=2026-07-01');
      expect(ids(res.body)).not.toContain(CASE_ID);
    });

    it('excludes a case after the window', async () => {
      const res = await queue('submittedTo=2026-06-01');
      expect(ids(res.body)).not.toContain(CASE_ID);
    });

    it('refuses an unparseable date rather than ignoring it', async () => {
      // A filter that silently does nothing shows a list that does not match
      // what was asked for, and it looks like an answer.
      const res = await queue('submittedFrom=last-tuesday');
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('UNPARSEABLE_DATE');
    });

    it('refuses an inverted range rather than returning nothing', async () => {
      // An empty queue reads as "no work", not as "you typed the dates the
      // wrong way round".
      const res = await queue('submittedFrom=2026-07-01&submittedTo=2026-06-01');
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('INVERTED_DATE_RANGE');
    });

    it('narrows rather than widens when combined with a state filter', async () => {
      const res = await queue('state=REJECTED&submittedFrom=2026-06-01');
      expect(ids(res.body)).not.toContain(CASE_ID);
    });
  });
});
