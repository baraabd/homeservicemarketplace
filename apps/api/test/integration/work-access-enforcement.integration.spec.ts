/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { Test } from '@nestjs/testing';
import { APP_FILTER } from '@nestjs/core';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  UseGuards,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.7 — the enforcement flags turned ON, over real HTTP, against a real
// database.
//
// WHY THIS SUITE EXISTS SEPARATELY
//
// Every other test of this area runs with WORK_ACCESS_ENFORCED and
// VERIFICATION_ENFORCED at their production default of FALSE, which is correct:
// those tests describe the shipped behaviour. But the flags are the whole point
// of the sprint, and "off" tests cannot say anything about what happens when
// somebody arms them. This suite arms them and proves the loop end to end:
//
//   denied -> approved -> allowed -> revoked -> denied -> approved -> expired
//   -> denied -> suspended -> reactivated -> still denied
//
// It caught a real defect. Admin suspension writes only the legacy `status`
// column, and rank 3 of the capability service read only `standingState`. With
// the flag OFF that was survivable because rank 7 re-checked `legacyStatus`;
// with it ON, a suspended provider holding a grant was authorised to work.
//
// WHAT "REPRESENTATIVE WORK ENDPOINT" MEANS HERE
//
// The real work routes (`provider-bids.controller.ts`,
// `available-requests.controller.ts`) gate on `ProviderActiveGuard`, which asks
// the capability service for VIEW_MARKETPLACE and translates the answer into
// 403. Mounting those controllers would drag in the whole bidding subsystem
// without changing what is under test, so this suite mounts the REAL guard on a
// minimal controller — and a separate assertion proves the real work
// controllers do mount that same guard, so the stand-in cannot drift away from
// what it stands in for.
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

d('Work-access enforcement with the flags ON (real Postgres, real routes)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let expiry: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('work-access');
  const OWNER = `${P}owner`;
  const REVIEWER = `${P}reviewer`;
  const PP = `${P}pp`;
  const POLICY = `2099.08-${P.replace(/-$/, '')}-v1`;
  const CATEGORY = `${P}cat`;

  let lifecycleLock: HeldLock;
  let outboxLock: HeldLock;
  let grantsLock: HeldLock;

  const REQS = {
    policyVersion: POLICY,
    verificationRequired: true,
    requirements: [{ kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null, fromVersion: POLICY }],
  };

  // The two flags, armed. Named so the report can quote exactly what was set.
  const FLAGS_ON: Record<string, unknown> = {
    WORK_ACCESS_ENFORCED: true,
    VERIFICATION_ENFORCED: true,
  };

  /** A stand-in for a work route, behind the REAL marketplace guard. */
  @Controller({ path: 'test-work', version: '1' })
  class WorkProbeController {
    @Get()
    take(): { ok: true } {
      return { ok: true };
    }
  }

  const work = () => request(http).get('/v1/test-work');
  const approve = (caseId: string, body: Record<string, unknown> = {}) =>
    request(http)
      .post(`/v1/admin/verification/cases/${caseId}/approve`)
      .send({ reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE', ...body });
  const revoke = (caseId: string) =>
    request(http)
      .post(`/v1/admin/verification/cases/${caseId}/revoke`)
      .send({ reasonCode: 'TRUST_AND_SAFETY_ACTION' });

  const profileRow = () => prisma.providerProfile.findUnique({ where: { id: PP } });
  const grantsOf = () =>
    prisma.providerWorkAccessGrant.findMany({
      where: { providerProfileId: PP },
      orderBy: { createdAt: 'asc' },
    });

  let seq = 0;
  /** A fresh SUBMITTED case with clean evidence, ready to approve. */
  async function seedCase(): Promise<string> {
    const caseId = `${P}case${(seq += 1)}`;
    await prisma.verificationCase.create({
      data: {
        id: caseId,
        providerProfileId: PP,
        state: 'SUBMITTED',
        submittedAt: new Date(),
        policyVersion: POLICY,
        requirementsSnapshot: REQS,
      },
    });
    const assetId = `${P}asset${seq}`;
    await prisma.mediaAsset.create({
      data: {
        id: assetId,
        visibility: 'RESTRICTED',
        storageKey: `verification/${caseId}/${assetId}.pdf`,
        declaredMimeType: 'application/pdf',
        detectedMimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'b'.repeat(64),
        scanState: 'CLEAN',
        ownerUserId: OWNER,
        verificationCaseId: caseId,
        uploadCompletedAt: new Date(),
      },
    });
    await prisma.verificationDocument.create({
      data: {
        id: `${P}doc${seq}`,
        caseId,
        kind: 'INDIVIDUAL_IDENTITY',
        mediaAssetId: assetId,
        uploadedByUserId: OWNER,
      },
    });
    return caseId;
  }

  async function cleanupFixtures(): Promise<void> {
    await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { startsWith: P } } });
    await prisma.providerWorkAccessGrant.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
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
    outboxLock = await acquireAdvisoryLock('outbox', 'shared');
    // EXCLUSIVE: this suite asserts on the expiry sweep's TABLE-WIDE totals
    // ("scanned: 0" means nothing anywhere is due), which no fixture prefix can
    // make true while another suite holds a due grant.
    grantsLock = await acquireAdvisoryLock('workAccessGrants', 'exclusive');

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
      VerificationExpiryService,
    } = require('../../src/modules/provider/verification/expiry/verification-expiry.service');
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
    const {
      ProviderActiveGuard,
    } = require('../../src/modules/provider/guards/provider-active.guard');
    const {
      AdminVerificationCaseCommandsController,
    } = require('../../src/modules/admin/verification/admin-verification-case-commands.controller');
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
    const { RolesGuard } = require('../../src/modules/iam/authorization/guards/roles.guard');
    const { AppConfigService } = require('../../src/config/app-config.service');

    // THE FLAGS, ON. Everything else falls through to undefined, which is what
    // the sibling suites already pass.
    const config = {
      get: (key: string) => FLAGS_ON[key],
      isProduction: false,
    };

    // The probe mounts the real guard, exactly as the real work controllers do.
    UseGuards(StubJwtGuard, PassGuard, ProviderActiveGuard)(WorkProbeController);

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminVerificationCaseCommandsController, WorkProbeController],
      providers: [
        VerificationCaseWorkflowService,
        VerificationExpiryService,
        ProviderCapabilityService,
        ProviderActiveGuard,
        AdminVerificationQueueService,
        AdminVerificationCaseService,
        VerificationSettingsService,
        PlatformSettingRepository,
        TransactionRunner,
        AuditService,
        AuditEventRepository,
        OutboxRepository,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        { provide: 'AppConfigService', useValue: config },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .overrideGuard(CsrfGuard)
      .useClass(PassGuard)
      .overrideGuard(RolesGuard)
      .useClass(PassGuard)
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => permissions.has('verification:decide') })
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    http = app.getHttpServer();
    expiry = app.get(VerificationExpiryService);

    await cleanupFixtures();
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY } });
    await prisma.verificationRequirementPolicy.create({
      data: {
        version: POLICY,
        // XG: the live-policy-per-scope index is global and XA-XF are taken by
        // the sibling suites.
        country: 'XG',
        requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
        publishedAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
  });

  beforeEach(async () => {
    await cleanupFixtures();
    for (const [id, email] of [
      [OWNER, `${OWNER}@wa.test`],
      [REVIEWER, `${REVIEWER}@wa.test`],
    ]) {
      await prisma.user.create({
        data: {
          id,
          email,
          firstName: 'W',
          lastName: 'A',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          // User.status defaults to PENDING_VERIFICATION, and rank 0 of the
          // capability service denies EVERYTHING for an ineligible account.
          // Without this the whole suite passes for the wrong reason: every
          // 403 would be an account denial and no assertion would ever reach
          // the verification or grant ranks it claims to be testing.
          status: 'ACTIVE',
        },
      });
    }
    await prisma.providerProfile.create({
      data: {
        id: PP,
        userId: OWNER,
        displayName: 'Work Access Provider Services',
        headline: 'Experienced provider serving the test region',
        bio: 'A sufficiently long biography for the onboarding policy to consider this profile complete for submission.',
        phoneNumber: '+963900000222',
        // A service area NO other suite uses. This provider is deliberately
        // marketplace-eligible — that is the whole point of the suite — and
        // geo-fanout.integration.spec.ts counts every eligible recipient in
        // 'aleppo' table-wide, so seeding one there made its recipient total
        // 601 instead of 600. An eligible provider is a shared-world fixture
        // in a way a DRAFT one is not.
        serviceAreaCity: 'WorkAccessTestCity',
        serviceAreaCountry: 'SY',
        serviceAreaRadiusKm: 25,
        initials: 'WA',
        // The state a provider reaches after registering, verifying OTP and
        // completing onboarding — the steps this suite takes as given, because
        // auth-flow.integration.spec.ts already proves them and repeating them
        // here would test the registration path, not the access path.
        status: 'ACTIVE',
        onboardingState: 'ACCEPTED',
        standingState: 'GOOD',
        verificationState: 'UNVERIFIED',
      },
    });
    await prisma.serviceCategory.create({
      data: { id: CATEGORY, slug: CATEGORY, labelEn: 'WA', labelAr: 'WA', icon: 'bolt' },
    });
    await prisma.providerProfileServiceCategory.create({
      data: { providerProfileId: PP, serviceCategoryId: CATEGORY },
    });
    currentUser = { id: OWNER };
    permissions = new Set();
    seq = 0;
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.verificationRequirementPolicy.deleteMany({ where: { version: POLICY } });
    await app?.close();
    await prisma.$disconnect();
    await grantsLock?.release();
    await outboxLock?.release();
    await lifecycleLock.release();
  });

  // ── the journey ─────────────────────────────────────────────────────────

  it('denies work to an onboarded but unverified provider', async () => {
    // Step 5 of the journey. With the flags on, being ACTIVE is no longer
    // enough — this is the denial the whole sprint exists to introduce.
    expect((await work()).status).toBe(403);
  });

  it('no recognition flag buys work access — VIP, Featured, verified or a paid tier', async () => {
    // Sprint 9B.13. ADR 0005 axis 5: subscription and recognition may change
    // what a provider is SHOWN, and must never change what they are ALLOWED.
    // The capability matrix asserts that against the service; this asserts it
    // at the HTTP boundary with the flags armed, which is where a bypass would
    // actually be attempted.
    //
    // Every flag a future "VIP" or "Featured" feature would plausibly reach
    // for is set at once, directly in the database — the strongest form of the
    // attempt, since no API accepts these from a client at all.
    await prisma.providerProfile.update({
      where: { id: PP },
      data: { verified: true, topPro: true },
    });

    // Still denied. The only thing that opens work is a live grant.
    expect((await work()).status).toBe(403);

    const grants = await grantsOf();
    expect(grants).toHaveLength(0);

    // And the flags did not quietly become a verification state either.
    const profile = await profileRow();
    expect(profile.verificationState).not.toBe('VERIFIED');
  });

  it('approval opens work access, and the grant carries a real expiry', async () => {
    const caseId = await seedCase();
    expect((await work()).status).toBe(403);

    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    expect((await approve(caseId)).status).toBeLessThan(400);

    const decisions = await prisma.verificationDecision.findMany({ where: { caseId } });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].outcome).toBe('APPROVED');

    const profile = await profileRow();
    expect(profile.verificationState).toBe('VERIFIED');
    // The account axis is untouched: approving documents is not a standing
    // decision.
    expect(profile.standingState).toBe('GOOD');

    const grants = await grantsOf();
    expect(grants).toHaveLength(1);
    expect(grants[0].status).toBe('ACTIVE');
    expect(grants[0].source).toBe('VERIFIED_DOCUMENTS');
    expect(grants[0].caseId).toBe(caseId);
    // Not open-ended. Before this sprint expiresAt was never written at all.
    expect(grants[0].expiresAt).not.toBeNull();
    expect(grants[0].expiresAt.getTime()).toBeGreaterThan(grants[0].grantedAt.getTime());

    currentUser = { id: OWNER };
    expect((await work()).status).toBe(200);
  });

  it('revocation denies work on the very next request', async () => {
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);
    currentUser = { id: OWNER };
    expect((await work()).status).toBe(200);

    currentUser = { id: REVIEWER };
    expect((await revoke(caseId)).status).toBeLessThan(400);

    currentUser = { id: OWNER };
    // ADR 0013 §6: the blocking window is the next request, because the
    // capability service reads state per request and holds no cache.
    expect((await work()).status).toBe(403);

    const grants = await grantsOf();
    expect(grants[0].status).toBe('REVOKED');
    expect(grants[0].revokedAt).not.toBeNull();
  });

  it('a revocation does not touch a MANUAL_OVERRIDE the provider also holds', async () => {
    // The multi-source rule. Revoking a documents decision may only close what
    // that case issued; an override granted deliberately for an unrelated
    // reason must survive, and the provider keeps working on it.
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);

    const override = await prisma.providerWorkAccessGrant.create({
      data: {
        providerProfileId: PP,
        status: 'ACTIVE',
        source: 'MANUAL_OVERRIDE',
        reason: 'OPS_MANUAL_OVERRIDE',
        grantedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    await revoke(caseId);

    const after = await prisma.providerWorkAccessGrant.findUnique({ where: { id: override.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.revokedAt).toBeNull();
    // Its identity survives too, not just its row: a MANUAL_OVERRIDE that came
    // back as a VERIFIED_DOCUMENTS grant would have lost the distinction ADR
    // 0013 requires to be permanent.
    expect(after.source).toBe('MANUAL_OVERRIDE');

    // The documents grant, and ONLY the documents grant, was closed.
    const closed = (await grantsOf()).filter(
      (g: { source: string }) => g.source === 'VERIFIED_DOCUMENTS',
    );
    expect(closed).toHaveLength(1);
    expect(closed[0].status).toBe('REVOKED');

    currentUser = { id: OWNER };
    // WORK IS STILL DENIED, and that is correct — it is worth being precise
    // about why, because the surviving override looks like it should help.
    //
    // Revocation moved the provider's EVIDENCE axis to EXPIRED, and rank 6
    // (VERIFICATION_ENFORCED) denies work on that axis alone, before rank 7
    // ever looks at a grant. So the override is preserved for the day
    // verification is restored, and it does not resurrect access in the
    // meantime. Preserving a grant and honouring it are different things, and
    // only the first is what "do not erase unrelated grants" asks for.
    expect((await work()).status).toBe(403);
  });

  it('suspension overrides EVERY grant source', async () => {
    // The P0 this suite caught. Admin suspension writes only `status`, so
    // before the rank-3 fix a suspended provider holding a grant was
    // authorised to work the moment the flag was armed.
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);
    await prisma.providerWorkAccessGrant.create({
      data: {
        providerProfileId: PP,
        status: 'ACTIVE',
        source: 'MANUAL_OVERRIDE',
        reason: 'OPS_MANUAL_OVERRIDE',
        grantedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    currentUser = { id: OWNER };
    expect((await work()).status).toBe(200);

    await prisma.providerProfile.update({ where: { id: PP }, data: { status: 'SUSPENDED' } });
    expect((await work()).status).toBe(403);
  });

  it('suspension preserves the verification evidence and history', async () => {
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);

    await prisma.providerProfile.update({ where: { id: PP }, data: { status: 'SUSPENDED' } });

    const profile = await profileRow();
    // A suspension is a standing decision. It must not rewrite what a reviewer
    // concluded about the documents, or the evidence history becomes a record
    // of conduct rather than of evidence.
    expect(profile.verificationState).toBe('VERIFIED');
    expect(await prisma.verificationDecision.count({ where: { caseId } })).toBe(1);
    expect((await prisma.verificationCase.findUnique({ where: { id: caseId } })).state).toBe(
      'VERIFIED',
    );
  });

  it('reactivation restores no revoked grant, and no work access with it', async () => {
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);
    await revoke(caseId);

    await prisma.providerProfile.update({ where: { id: PP }, data: { status: 'SUSPENDED' } });
    await prisma.providerProfile.update({ where: { id: PP }, data: { status: 'ACTIVE' } });

    const grants = await grantsOf();
    // Reactivation is a standing decision and creates nothing. A grant is
    // issued by a decision about evidence, and no such decision was made.
    expect(grants.every((g: { status: string }) => g.status !== 'ACTIVE')).toBe(true);

    currentUser = { id: OWNER };
    expect((await work()).status).toBe(403);
  });

  it('reactivation does not turn a rejected verification into a verified one', async () => {
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await request(http)
      .post(`/v1/admin/verification/cases/${caseId}/reject`)
      .send({ reasonCode: 'DOCUMENT_ILLEGIBLE' });

    await prisma.providerProfile.update({ where: { id: PP }, data: { status: 'SUSPENDED' } });
    await prisma.providerProfile.update({ where: { id: PP }, data: { status: 'ACTIVE' } });

    const profile = await profileRow();
    expect(profile.verificationState).not.toBe('VERIFIED');
    expect(await grantsOf()).toHaveLength(0);

    currentUser = { id: OWNER };
    expect((await work()).status).toBe(403);
  });

  // ── expiry ──────────────────────────────────────────────────────────────

  it('the sweep persists the whole lifecycle, not just the denial', async () => {
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);

    const grant = (await grantsOf())[0];
    // One millisecond past the window. The clock is injected, so the boundary
    // is exact and nothing sleeps.
    const after = new Date(grant.expiresAt.getTime() + 1);

    const result = await expiry.runOnce({ now: after, limit: 10 });
    expect(result).toMatchObject({ scanned: 1, expired: 1, failed: 0 });

    const kase = await prisma.verificationCase.findUnique({ where: { id: caseId } });
    expect(kase.state).toBe('EXPIRED');

    const profile = await profileRow();
    expect(profile.verificationState).toBe('EXPIRED');
    expect(profile.verified).toBe(false);
    // Not a sanction: standing is untouched.
    expect(profile.standingState).toBe('GOOD');

    expect((await grantsOf())[0].status).toBe('EXPIRED');

    const decisions = await prisma.verificationDecision.findMany({
      where: { caseId },
      orderBy: { decidedAt: 'asc' },
    });
    expect(decisions.map((r: { outcome: string }) => r.outcome)).toEqual(['APPROVED', 'EXPIRED']);
    // No human decided, so no human is named.
    expect(decisions[1].decidedByUserId).toBeNull();

    expect(
      await prisma.auditEvent.count({ where: { type: 'VERIFICATION_CASE_EXPIRED' } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.notification.count({ where: { userId: OWNER, type: 'VERIFICATION_EXPIRED' } }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateId: caseId, eventType: 'verification.case.access_closed' },
      }),
    ).toBeGreaterThan(0);
  });

  it('an expired verification denies work', async () => {
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);
    currentUser = { id: OWNER };
    expect((await work()).status).toBe(200);

    const grant = (await grantsOf())[0];
    await expiry.runOnce({ now: new Date(grant.expiresAt.getTime() + 1), limit: 10 });

    expect((await work()).status).toBe(403);
  });

  it('denies work at the expiry instant even before the sweep runs', async () => {
    // The property ADR 0013 relies on: access is a read-time predicate, so a
    // failed or unscheduled sweep can never leave access granted that nobody
    // authorised. Proved by expiring the grant window WITHOUT running the
    // sweep at all.
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);

    // BOTH timestamps move into the past. A row with expiresAt before
    // grantedAt is refused outright by the CHECK constraint
    // `provider_work_access_grant_expiry_after_grant` — the database will not
    // store a grant that ended before it began, which is the same refusal
    // computeGrantWindow makes in application code, enforced a second time
    // where nothing can bypass it.
    await prisma.providerWorkAccessGrant.updateMany({
      where: { caseId },
      data: {
        grantedAt: new Date(Date.now() - 2 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });

    currentUser = { id: OWNER };
    expect((await work()).status).toBe(403);
    // And the row is still ACTIVE — nothing wrote it. That is the point.
    expect((await grantsOf())[0].status).toBe('ACTIVE');
  });

  it('the sweep leaves a not-yet-due grant completely alone', async () => {
    // Non-vacuity for every expiry assertion above: if the sweep expired
    // everything it looked at, they would all pass for the wrong reason.
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);

    const grant = (await grantsOf())[0];
    const before = new Date(grant.expiresAt.getTime() - 1);
    const result = await expiry.runOnce({ now: before, limit: 10 });

    expect(result).toMatchObject({ scanned: 0, expired: 0 });
    expect((await grantsOf())[0].status).toBe('ACTIVE');
    expect((await prisma.verificationCase.findUnique({ where: { id: caseId } })).state).toBe(
      'VERIFIED',
    );

    currentUser = { id: OWNER };
    expect((await work()).status).toBe(200);
  });

  it('running the sweep twice expires once', async () => {
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);

    const grant = (await grantsOf())[0];
    const after = new Date(grant.expiresAt.getTime() + 1);

    const first = await expiry.runOnce({ now: after, limit: 10 });
    const second = await expiry.runOnce({ now: after, limit: 10 });

    expect(first.expired).toBe(1);
    // The case is no longer VERIFIED, so it is not even selected the second
    // time — idempotent by construction rather than by a guard.
    expect(second).toMatchObject({ scanned: 0, expired: 0 });
    expect(await prisma.verificationDecision.count({ where: { caseId, outcome: 'EXPIRED' } })).toBe(
      1,
    );
  });

  it('two concurrent sweeps expire once and neither reports a failure', async () => {
    const caseId = await seedCase();
    currentUser = { id: REVIEWER };
    permissions = new Set(['verification:decide']);
    await approve(caseId);

    const grant = (await grantsOf())[0];
    const after = new Date(grant.expiresAt.getTime() + 1);

    const [a, b] = await Promise.all([
      expiry.runOnce({ now: after, limit: 10 }),
      expiry.runOnce({ now: after, limit: 10 }),
    ]);

    expect(a.expired + b.expired).toBe(1);
    expect(a.failed + b.failed).toBe(0);
    expect(await prisma.verificationDecision.count({ where: { caseId, outcome: 'EXPIRED' } })).toBe(
      1,
    );
  });

  // ── the stand-in cannot drift ───────────────────────────────────────────

  it('the real work controllers gate on the same guard this suite mounts', () => {
    // Keeps the probe honest. If a work controller stopped using
    // ProviderActiveGuard, everything above would still pass while the real
    // route went unguarded.
    const fs = require('node:fs');
    for (const file of [
      'src/modules/provider/bids/provider-bids.controller.ts',
      'src/modules/provider/available-requests/available-requests.controller.ts',
    ]) {
      // Sprint 9B.8 — either name is a pass, and that is not laxity.
      // ProviderActiveGuard IS ProviderCapabilityGuard specialised to
      // VIEW_MARKETPLACE; the bids controller moved to the general form
      // because its mutations need SUBMIT_BID, while the available-requests
      // feed kept the specialised one because VIEW_MARKETPLACE really is the
      // right question there. What this pins is the property that matters:
      // the real work routes are gated by a capability guard, not by a status
      // comparison, so the probe below cannot drift away from them.
      expect(fs.readFileSync(file, 'utf8')).toMatch(/ProviderCapabilityGuard|ProviderActiveGuard/);
    }
  });
});
