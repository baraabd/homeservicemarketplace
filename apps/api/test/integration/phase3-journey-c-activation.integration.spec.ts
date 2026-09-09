/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';

import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';

import { ProviderCapabilityDenialReason } from '@homeservicemarketplace/contracts';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// Derived, never written: a literal here is indistinguishable from a real
// key to the CI secret scanner. See test/support/test-secrets.ts.
const SECRET = makeTestSecret('phase3-journey-c-activation');

// Sprint 09B.29 Phase 3, JOURNEY C (REOPENED) — the COMPLETE canonical
// activation journey: pending moderation → authorised provider work.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §3.9
//
// WHY THIS SUITE REPLACES THE FIRST JOURNEY C
//
// `phase3-journey-c-admin-approval.integration.spec.ts` proved that
// `POST /v1/admin/providers/:id/approve` moves the provider-status axis. Its own
// evidence then showed the specialty still PENDING, verification incomplete, no
// work-access grant and protected endpoints still 403 — i.e. it proved one axis
// and left the actual activation unproven. That suite is retained as FOCUSED
// evidence for axis 2 only; this one proves the whole chain.
//
// THE CHAIN (established by the read-only audit in §3.9.2)
//
// No single endpoint owns activation. Three independent canonical decisions are
// required, and they are gated differently on purpose:
//
//   1. POST /v1/me/provider/onboarding/submit          provider
//   2. POST /v1/admin/providers/:id/approve            RolesGuard('admin')
//   3. PATCH /v1/admin/category-applications/:id/review  RolesGuard('admin')
//   4. POST /v1/me/provider/verification/case          provider (ManageVerification)
//   5. evidence prepare → PUT content → finalize       provider
//   6. EvidenceScanService.scanPending()               system sweep
//   7. POST /v1/me/provider/verification/case/submit   provider
//   8. POST /v1/admin/verification/cases/:id/approve   PermissionsGuard('verification:decide')
//
// Only #8 writes `verificationState = VERIFIED` and issues the
// `ProviderWorkAccessGrant`. #2 cannot, and never could.
//
// WHAT IS REAL, AND WHAT IS NOT
//
// REAL: every controller, service, policy, repository and guard above —
// including `RolesGuard`, `PermissionsGuard` (which resolves
// `verification:decide` from the seeded role→permission rows in the isolated
// database), `ProviderCapabilityGuard`, `ProviderCapabilityService`,
// `VerificationCaseWorkflowService`, `EvidenceUploadService`,
// `EvidenceScanService`, the outbox repository, Postgres and Redis.
//
// NOT REAL — three infrastructure boundaries, substituted and disclosed:
//
//   · `JwtAuthGuard` / `CsrfGuard`. As in Journeys B–E. The identity is
//     asserted by the harness; real sessions are the browser gate's job.
//   · `RestrictedObjectStoragePort`. An in-memory implementation of the real
//     abstract port. Evidence bytes genuinely travel prepare → PUT → finalize
//     → scan; only the bucket is memory.
//   · `MalwareScannerPort`. A deterministic adapter that reports CLEAN.
//
// THE SCANNER SUBSTITUTION IS THE ONE TO SCRUTINISE
//
// `EvidenceScanService` refuses to write CLEAN unless the adapter declares
// `isRealScanner === true` — a guard that exists so a misconfigured no-op
// adapter cannot launder a verdict. This suite's adapter therefore declares it,
// which means the suite is TRUSTING ITS OWN SCANNER. That is unavoidable
// without running ClamAV, and it is stated here rather than buried: this
// journey proves the ACTIVATION CHAIN, not malware detection.
//
// The guard itself is not left unproven — `evidence-scan.service.spec.ts` owns
// it — and a test below asserts the scan actually ran and moved the document to
// CLEAN, rather than the document having been CLEAN all along.
//
// NO STATE UNDER TEST IS CREATED BY DIRECT SQL. Direct database access appears
// only in assertions and in deterministic cleanup. Fixture preconditions (User
// rows, the category catalogue, and one seeker's service request) are created
// directly because they are not what is under test.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(300_000);

let currentUser: { id: string; roles: string[] } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}
class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/**
 * A genuinely valid 1×1 PNG — signature, IHDR, IDAT and IEND, each with a real
 * CRC.
 *
 * Not a padded signature. `validateEvidenceBytes` checks the TRAILER as well as
 * the leading magic (`endsCorrectly` → `TRUNCATED`), and it is re-run by the
 * scan sweep against the stored object. A signature with filler bytes uploads
 * fine and is then rejected at scan time — which is exactly the asymmetry this
 * constant exists to avoid tripping over.
 */
const PNG_BYTES = (() => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  // zlib stream for a single 1-byte scanline (filter 0 + one sample).
  const idat = require('node:zlib').deflateSync(Buffer.from([0x00, 0x00])) as Buffer;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
})();

d('Phase 3 Journey C (reopened) — complete canonical activation (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let scanService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('j3ca');
  const USER = `${P}user`;
  /** A second provider, built identically, for ownership isolation. */
  const OTHER = `${P}other`;
  const ADMIN = `${P}admin`;
  const SEEKER = `${P}seeker`;
  const ROOT = `${P}root`;
  const LEAF = `${P}leaf`;
  const REQUEST = `${P}request`;

  let lifecycleLock: HeldLock;
  let serviceRequestsLock: HeldLock;
  let profileId: string;
  let otherProfileId: string;
  let applicationId: string;
  let otherApplicationId: string;
  let caseId: string;
  /**
   * Outbox ids that existed BEFORE this suite ran.
   *
   * Cleanup removes the difference rather than matching on `aggregateId`.
   * Matching was wrong and it leaked: the evidence-scan event is keyed by the
   * MEDIA ASSET id, not the case or profile id, so nine rows survived and the
   * next suites — which assert a whole-table outbox count of zero — failed on
   * state this one left behind. "Everything I added" is the only rule that
   * cannot be defeated by a new event type keyed off something else.
   */
  let outboxIdsBefore = new Set<string>();

  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const notifications: Array<{ userId: string; title: string }> = [];
  const scanCalls: string[] = [];

  const anonymous = () => {
    currentUser = null;
  };
  const asAdmin = () => {
    currentUser = { id: ADMIN, roles: ['admin'] };
  };
  const asProvider = (id = USER) => {
    currentUser = { id, roles: ['customer', 'provider'] };
  };

  // ── the surfaces ─────────────────────────────────────────────────────────
  const listWork = () => request(http).get('/v1/provider/bids');
  const createBid = () =>
    request(http)
      .post('/v1/provider/bids')
      .send({ requestId: REQUEST, amount: 25_000, pricingType: 'FIXED', note: 'I can help.' });
  const capabilities = () => request(http).get('/v1/me/provider/capabilities');

  const upgrade = () => request(http).post('/v1/me/provider/upgrade').send({});
  const patchStep = (step: string, body: Record<string, unknown>) =>
    request(http).patch(`/v1/me/provider/onboarding/steps/${step}`).send(body);
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');
  const getReview = () => request(http).get('/v1/me/provider/onboarding/review');
  const postSubmit = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/onboarding/submit').send(body);

  const approveProvider = (id: string, body: Record<string, unknown> = {}) =>
    request(http).post(`/v1/admin/providers/${id}/approve`).send(body);
  const suspendProvider = (id: string, body: Record<string, unknown> = {}) =>
    request(http).post(`/v1/admin/providers/${id}/suspend`).send(body);
  const reactivateProvider = (id: string) =>
    request(http).post(`/v1/admin/providers/${id}/reactivate`).send({});

  const reviewApplication = (id: string, body: Record<string, unknown>) =>
    request(http).patch(`/v1/admin/category-applications/${id}/review`).send(body);

  const createCase = (body: Record<string, unknown> = {}) =>
    request(http).post('/v1/me/provider/verification/case').send(body);
  const submitCase = (body: Record<string, unknown> = {}) =>
    request(http).post('/v1/me/provider/verification/case/submit').send(body);
  const prepareEvidence = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/verification/evidence/prepare').send(body);
  const putEvidence = (assetId: string) =>
    request(http)
      .put(`/v1/me/provider/verification/evidence/${assetId}/content`)
      .set('Content-Type', 'image/png')
      .send(PNG_BYTES);
  const finalizeEvidence = (assetId: string) =>
    request(http).post(`/v1/me/provider/verification/evidence/${assetId}/finalize`).send({});
  const approveCase = (id: string, body: Record<string, unknown>) =>
    request(http).post(`/v1/admin/verification/cases/${id}/approve`).send(body);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeOf = (res: any): unknown => res.body?.error?.code;

  const liveGrants = (id: string) =>
    prisma.providerWorkAccessGrant.count({
      where: { providerProfileId: id, status: 'ACTIVE', revokedAt: null },
    });
  const allGrants = (id: string) =>
    prisma.providerWorkAccessGrant.count({ where: { providerProfileId: id } });
  const categoryGrants = (id: string) =>
    prisma.providerProfileServiceCategory.count({ where: { providerProfileId: id } });
  const auditCount = (type: string, userId?: string) =>
    prisma.auditEvent.count({ where: { type, ...(userId ? { userId } : {}) } });
  const outboxCount = (eventType: string) => prisma.outboxEvent.count({ where: { eventType } });

  /** The PERSISTED outbox event name, taken from the production constant.
   *
   *  `OutboxEventType.VERIFICATION_CASE_APPROVED` is `'verification.case.approved'`
   *  — the key and the value differ, and the column stores the value. Reading
   *  it from the source rather than retyping the literal is what stops this
   *  suite silently counting zero of a name nothing writes. */
  const OUTBOX_APPROVED: string = require('../../src/infrastructure/outbox/outbox.tokens')
    .OutboxEventType.VERIFICATION_CASE_APPROVED;

  async function cleanupFixtures(): Promise<void> {
    const rows = (await prisma.providerProfile.findMany({
      where: { userId: { startsWith: P } },
      select: { id: true },
    })) as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);
    const cases = (await prisma.verificationCase.findMany({
      where: { providerProfileId: { in: ids } },
      select: { id: true },
    })) as Array<{ id: string }>;
    const caseIds = cases.map((c) => c.id);

    await prisma.bid.deleteMany({ where: { providerId: { in: ids } } });
    await prisma.serviceRequestEvent.deleteMany({ where: { requestId: REQUEST } });
    await prisma.serviceRequest.deleteMany({ where: { seekerUserId: { startsWith: P } } });
    await prisma.verificationAccessLog.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.verificationDecision.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.verificationDocument.deleteMany({ where: { caseId: { in: caseIds } } });
    await prisma.verificationCase.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.mediaAsset.deleteMany({ where: { ownerUserId: { startsWith: P } } });
    await prisma.providerOnboardingSubmission.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
    const outboxNow = (await prisma.outboxEvent.findMany({ select: { id: true } })) as Array<{
      id: string;
    }>;
    const mine = outboxNow.map((o) => o.id).filter((id) => !outboxIdsBefore.has(id));
    if (mine.length > 0) {
      await prisma.outboxEvent.deleteMany({ where: { id: { in: mine } } });
    }
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.providerOnboardingDraft.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.providerCategoryApplication.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.providerAvailabilityInterval.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.providerProfile.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.userRole.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: [LEAF, ROOT] } } });
  }

  /** Everything a provider owns, through the real step endpoints, then submit. */
  async function buildSubmittedProvider(userId: string, displayName: string): Promise<string> {
    asProvider(userId);
    await upgrade().expect(200);
    const id = (await prisma.providerProfile.findFirst({ where: { userId } })).id as string;

    let v = (await getDraft().expect(200)).body.version as number;
    const step = async (name: string, body: Record<string, unknown>) => {
      const res = await patchStep(name, { ...body, version: v }).expect(200);
      v = res.body.version as number;
    };
    await step('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
    await step('IDENTITY', { displayName, phoneNumber: '+963900000999' });
    await step('LOCATION', {
      serviceAreaCity: 'JourneyCACity',
      serviceAreaCountry: 'SY',
      serviceAreaRadiusKm: 20,
    });
    await step('SPECIALTIES', { specialtyLeafIds: [LEAF], primarySpecialtyId: LEAF });
    await step('EXPERIENCE', { yearsOfExperience: 8, transportModes: ['CAR'] });
    await step('AVAILABILITY', {
      availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
      timezone: 'Asia/Damascus',
    });
    await step('PROFILE', {
      headline: `${displayName} — licensed electrician`,
      bio: 'Eight years of residential electrical work, including rewiring, fault finding and emergency callouts.',
    });
    const review = await getReview().expect(200);
    await patchStep('CONSENT', {
      acceptedConsentVersion: review.body.terms.version,
      version: review.body.draftVersion,
    }).expect(200);
    const ready = await getReview().expect(200);
    expect(ready.body.canSubmit).toBe(true);
    await postSubmit({ version: ready.body.draftVersion }).expect(200);
    return id;
  }

  beforeAll(async () => {
    try {
      await setup();
    } catch (err) {
      // Jest reports a non-Error rejection from a hook as "thrown: undefined"
      // and nothing else — which is exactly what a missing config key did here
      // (RedisService's retry() rejected with a bare undefined). Re-raising as
      // a real Error means the next broken setup names itself instead of
      // failing all 46 tests anonymously.
      throw err instanceof Error
        ? err
        : new Error(`Journey C setup failed: ${JSON.stringify(err)}`);
    }
  });

  async function setup(): Promise<void> {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    // Sprint 09B.29 Phase 3 — SHARED on ServiceRequest, acquired LAST.
    //
    // This journey creates a REAL `OPEN_FOR_BIDS` request, and the marketplace
    // preview is a GLOBAL reader: its query carries no ownership scope, so no
    // fixture namespace can hide this row from it. `marketplace-preview` holds
    // this lock EXCLUSIVE for its whole run and asserts that every open request
    // in the database snaps to ONE cell; one foreign row is one extra cell and
    // it fails on the inscrutable 'Expected 1, Received 2'. That is exactly how
    // it failed when this suite was added without the lock.
    //
    // Shared, so the other request-writing suites still run beside this one and
    // only the global reader excludes them. Last, because the canonical order
    // is providerLifecycle -> outbox -> workAccessGrants -> serviceRequests;
    // two suites taking two locks in opposite orders deadlock.
    serviceRequestsLock = await acquireAdvisoryLock('serviceRequests', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const r = (p: string) => require(p);
    const { PrismaService } = r('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = r('../../src/infrastructure/prisma/transaction.runner');
    const { OutboxRepository } = r('../../src/infrastructure/outbox/outbox.repository');
    const { ProviderProfileRepository } = r(
      '../../src/infrastructure/persistence/bids/provider-profile.repository',
    );
    const { BidRepository } = r('../../src/infrastructure/persistence/bids/bid.repository');
    const { ServiceRequestRepository } = r(
      '../../src/infrastructure/persistence/requests/service-request.repository',
    );
    const { ServiceRequestEventRepository } = r(
      '../../src/infrastructure/persistence/requests/service-request-event.repository',
    );
    const { ProviderOnboardingDraftRepository } = r(
      '../../src/infrastructure/persistence/provider/provider-onboarding-draft.repository',
    );
    const { ServiceCategoryRepository } = r(
      '../../src/infrastructure/persistence/services/service-category.repository',
    );
    const { ProviderCategoryApplicationRepository } = r(
      '../../src/infrastructure/persistence/services/provider-category-application.repository',
    );
    const { UserRepository } = r('../../src/infrastructure/persistence/iam/user.repository');
    const { RoleRepository } = r('../../src/infrastructure/persistence/iam/role.repository');
    const { PlatformSettingRepository } = r(
      '../../src/infrastructure/persistence/settings/platform-setting.repository',
    );
    const { AuditService } = r('../../src/modules/iam/audit/audit.service');
    const { AuditEventRepository } = r(
      '../../src/infrastructure/persistence/iam/audit-event.repository',
    );
    const { AdminAuditService } = r('../../src/modules/admin/admin-audit.service');
    const { SecurityEventsBus } = r('../../src/shared/security-events/security-events.bus');
    const { NotificationsService } = r('../../src/modules/notifications/notifications.service');
    const { AdminVerificationController } = r(
      '../../src/modules/admin/verification/admin-verification.controller',
    );
    const { AdminVerificationService } = r(
      '../../src/modules/admin/verification/admin-verification.service',
    );
    const { AdminVerificationCaseService } = r(
      '../../src/modules/admin/verification/admin-verification-case.service',
    );
    const { AdminVerificationCaseCommandsController } = r(
      '../../src/modules/admin/verification/admin-verification-case-commands.controller',
    );
    const { AdminVerificationQueueService } = r(
      '../../src/modules/admin/verification/admin-verification-queue.service',
    );
    const { AdminCategoryApplicationsController } = r(
      '../../src/modules/admin/category-applications/admin-category-applications.controller',
    );
    const { AdminCategoryApplicationsService } = r(
      '../../src/modules/admin/category-applications/admin-category-applications.service',
    );
    const { ProviderVerificationCaseController } = r(
      '../../src/modules/provider/verification/case/provider-verification-case.controller',
    );
    const { ProviderVerificationCaseService } = r(
      '../../src/modules/provider/verification/case/provider-verification-case.service',
    );
    const { VerificationCaseWorkflowService } = r(
      '../../src/modules/provider/verification/case/verification-case-workflow.service',
    );
    const { VerificationSettingsService } = r(
      '../../src/modules/provider/verification/verification-settings.service',
    );
    const { EvidenceUploadController } = r(
      '../../src/modules/provider/verification/media/evidence-upload.controller',
    );
    const { EvidenceUploadService } = r(
      '../../src/modules/provider/verification/media/evidence-upload.service',
    );
    const { EvidenceScanService } = r(
      '../../src/modules/provider/verification/media/evidence-scan.service',
    );
    const { MALWARE_SCANNER_PORT } = r(
      '../../src/modules/provider/verification/media/malware-scanner.port',
    );
    const { RESTRICTED_OBJECT_STORAGE } = r(
      '../../src/infrastructure/storage/restricted-object-storage.port',
    );
    const { ProviderBidsController } = r(
      '../../src/modules/provider/bids/provider-bids.controller',
    );
    const { ProviderBidsService } = r('../../src/modules/provider/bids/provider-bids.service');
    const { ProviderCapabilitiesController } = r(
      '../../src/modules/provider/capability/provider-capabilities.controller',
    );
    const { ProviderOnboardingWizardController } = r(
      '../../src/modules/provider/onboarding/provider-onboarding-wizard.controller',
    );
    const { ProviderOnboardingWizardService } = r(
      '../../src/modules/provider/onboarding/provider-onboarding-wizard.service',
    );
    const { ProviderAvatarService } = r(
      '../../src/modules/provider/onboarding/avatar/provider-avatar.service',
    );
    // Sprint 09B.29 Phase 4 — ProviderAvatarService claims and retires
    // reservations now, so its ledger has to exist here too. The REAL one:
    // this suite has a database, and a double would leave the claim's
    // ownership conditions untested in the one place they can be.
    const { PublicMediaLedgerService } = r('../../src/modules/media/public-media-ledger.service');
    const { ProviderServiceAreaExpansionService } = r(
      '../../src/modules/provider/onboarding/service-area/expansion/provider-service-area-expansion.service',
    );
    const { ProviderController } = r('../../src/modules/provider/provider.controller');
    const { ProviderService } = r('../../src/modules/provider/provider.service');
    const { ProviderOnboardingService } = r(
      '../../src/modules/provider/onboarding/provider-onboarding.service',
    );
    const { ProviderCapabilityService } = r(
      '../../src/modules/provider/capability/provider-capability.service',
    );
    const { ProviderCapabilityGuard } = r(
      '../../src/modules/provider/guards/provider-capability.guard',
    );
    const { PermissionResolverService } = r(
      '../../src/modules/iam/authorization/services/permission-resolver.service',
    );
    const { AllExceptionsFilter } = r('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = r('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = r('../../src/modules/iam/authentication/guards/csrf.guard');
    const { AppConfigService } = r('../../src/config/app-config.service');
    const { STORAGE_PORT } = r('../../src/infrastructure/storage/storage.port');

    const { RedisService } = r('../../src/infrastructure/redis/redis.service');

    // `PermissionResolverService` caches role→permission sets in Redis, so the
    // REAL RedisService is wired against the isolated stack rather than
    // stubbed: the permission gate that decides Stage 4 is exactly the
    // production one, cache included. The connection details come from the
    // REDIS_URL the runner already points at this stack — never a hard-coded
    // port, because the isolated stack publishes an ephemeral one.
    const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: SECRET,
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
      REDIS_HOST: redisUrl.hostname,
      REDIS_PORT: Number(redisUrl.port || 6379),
      REDIS_PASSWORD: redisUrl.password || '',
      REDIS_DB: 0,
      REDIS_TLS: false,
      // Required by RedisService.onModuleInit. Omitting them made `retry()`
      // run zero attempts and reject with a bare `undefined`, which Jest
      // reports only as "thrown: undefined" — worth the comment, because the
      // symptom names neither the key nor the file.
      REDIS_CONNECT_TIMEOUT_MS: 10_000,
      STARTUP_MAX_RETRIES: 5,
      STARTUP_RETRY_BASE_MS: 100,
      STARTUP_RETRY_CAP_MS: 1_000,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    /** In-memory implementation of the REAL abstract port. */
    const restrictedStorage = {
      async putObjectFromFile(input: {
        key: string;
        sourcePath: string;
        contentType: string;
      }): Promise<void> {
        objects.set(input.key, {
          bytes: await readFile(input.sourcePath),
          contentType: input.contentType,
        });
      },
      async openReadStream(key: string): Promise<Readable> {
        const o = objects.get(key);
        if (!o) throw new Error(`No such object: ${key}`);
        return Readable.from(o.bytes);
      },
      async head(key: string) {
        const o = objects.get(key);
        return o ? { sizeBytes: o.bytes.length } : null;
      },
      async deleteObject(key: string): Promise<void> {
        objects.delete(key);
      },
    };

    // See the header: declaring `isRealScanner` is what lets CLEAN be written,
    // and it is the one place this suite trusts itself.
    const scanner = {
      scannerId: 'phase3-journey-c-deterministic',
      isRealScanner: true,
      async scan(input: { assetId: string }) {
        scanCalls.push(input.assetId);
        return { state: 'CLEAN' as const, scannerId: 'phase3-journey-c-deterministic' };
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminVerificationController,
        AdminVerificationCaseCommandsController,
        AdminCategoryApplicationsController,
        ProviderVerificationCaseController,
        EvidenceUploadController,
        ProviderBidsController,
        ProviderCapabilitiesController,
        ProviderOnboardingWizardController,
        ProviderController,
      ],
      providers: [
        AdminVerificationService,
        AdminVerificationCaseService,
        AdminVerificationQueueService,
        AdminCategoryApplicationsService,
        AdminAuditService,
        SecurityEventsBus,
        ProviderVerificationCaseService,
        VerificationCaseWorkflowService,
        VerificationSettingsService,
        EvidenceUploadService,
        EvidenceScanService,
        PermissionResolverService,
        RedisService,
        ProviderBidsService,
        ProviderOnboardingWizardService,
        ProviderOnboardingService,
        ProviderService,
        ProviderAvatarService,
        PublicMediaLedgerService,
        ProviderServiceAreaExpansionService,
        ProviderCapabilityService,
        ProviderCapabilityGuard,
        ProviderProfileRepository,
        BidRepository,
        ServiceRequestRepository,
        ServiceRequestEventRepository,
        ProviderOnboardingDraftRepository,
        ServiceCategoryRepository,
        ProviderCategoryApplicationRepository,
        UserRepository,
        RoleRepository,
        PlatformSettingRepository,
        AuditService,
        AuditEventRepository,
        OutboxRepository,
        TransactionRunner,
        Reflector,
        {
          provide: NotificationsService,
          useValue: {
            createForUser: async (input: { userId: string; title: string }) => {
              notifications.push(input);
              return { id: 'stub-notification' };
            },
          },
        },
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        { provide: STORAGE_PORT, useValue: {} },
        { provide: RESTRICTED_OBJECT_STORAGE, useValue: restrictedStorage },
        { provide: MALWARE_SCANNER_PORT, useValue: scanner },
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    scanService = moduleRef.get(EvidenceScanService);

    // Recorded BEFORE anything runs, so cleanup can remove exactly what this
    // suite adds and nothing a neighbouring suite owns.
    outboxIdsBefore = new Set(
      ((await prisma.outboxEvent.findMany({ select: { id: true } })) as Array<{ id: string }>).map(
        (o) => o.id,
      ),
    );

    await cleanupFixtures();

    for (const [id, first] of [
      [USER, 'Omar'],
      [OTHER, 'Nadia'],
      [ADMIN, 'Operator'],
      [SEEKER, 'Hala'],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@j3ca.test`,
          firstName: first,
          lastName: 'Saleh',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }
    await prisma.serviceCategory.create({
      data: { id: ROOT, slug: ROOT, labelEn: 'Electrical', labelAr: 'كهرباء', icon: 'bolt' },
    });
    await prisma.serviceCategory.create({
      data: {
        id: LEAF,
        slug: LEAF,
        labelEn: 'Rewiring',
        labelAr: 'إعادة تمديد الأسلاك',
        icon: 'bolt',
        parentId: ROOT,
      },
    });
    await prisma.serviceRequest.create({
      data: {
        id: REQUEST,
        seekerUserId: SEEKER,
        categoryId: LEAF,
        description: 'Kitchen circuit keeps tripping.',
        status: 'OPEN_FOR_BIDS',
        scheduleType: 'ASAP',
        addressSnapshot: { label: 'Home', line1: '12 Baghdad St', country: 'SY' },
        locationCityKey: 'journeycacity',
      },
    });

    profileId = await buildSubmittedProvider(USER, 'Omar Saleh');
    otherProfileId = await buildSubmittedProvider(OTHER, 'Nadia Saleh');
    applicationId = (
      await prisma.providerCategoryApplication.findFirst({
        where: { providerProfileId: profileId },
      })
    ).id;
    otherApplicationId = (
      await prisma.providerCategoryApplication.findFirst({
        where: { providerProfileId: otherProfileId },
      })
    ).id;
  }

  afterAll(async () => {
    currentUser = null;
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await serviceRequestsLock.release();
    await lifecycleLock.release();
  });

  // ══ STAGE 0 — before any decision ════════════════════════════════════════

  describe('Stage 0 — before any decision', () => {
    it('has a submitted onboarding application', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.onboardingState).toBe('DOCUMENTS_REQUIRED');
      expect(p.status).toBe('PENDING_REVIEW');
      expect(
        await prisma.providerOnboardingSubmission.count({
          where: { providerProfileId: profileId },
        }),
      ).toBe(1);
    });

    it('has specialty moderation still pending', async () => {
      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profileId },
      });
      expect(apps).toHaveLength(1);
      expect(apps[0].status).toBe('PENDING');
      expect(await categoryGrants(profileId)).toBe(0);
    });

    it('has verification incomplete and no work-access grant', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.verificationState).not.toBe('VERIFIED');
      expect(p.verified).toBe(false);
      expect(await allGrants(profileId)).toBe(0);
    });

    it('refuses protected work with 403', async () => {
      asProvider();
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');
      expect(codeOf(await createBid().expect(403))).toBe('FORBIDDEN');
      const caps = await capabilities().expect(200);
      expect(caps.body.primaryReason).toBe(ProviderCapabilityDenialReason.VerificationRequired);
    });
  });

  // ══ STAGE 1 — provider-status approval, and ONLY that axis ═══════════════

  describe('Stage 1 — provider-status approval moves only its own axis', () => {
    it('succeeds through the canonical admin endpoint', async () => {
      asAdmin();
      const res = await approveProvider(profileId, { note: 'Application looks complete.' }).expect(
        200,
      );
      expect(res.body.provider.status).toBe('ACTIVE');
    });

    it('moved the status and onboarding axes', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.status).toBe('ACTIVE');
      expect(p.onboardingState).toBe('ACCEPTED');
      expect(p.reviewedByUserId).toBe(ADMIN);
    });

    it('did NOT approve the specialty', async () => {
      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profileId },
      });
      expect(apps[0].status).toBe('PENDING');
      expect(await categoryGrants(profileId)).toBe(0);
    });

    it('did NOT verify the provider', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.verificationState).not.toBe('VERIFIED');
      expect(p.verified).toBe(false);
    });

    it('did NOT issue work access', async () => {
      expect(await allGrants(profileId)).toBe(0);
    });

    it('still refuses protected work, for the verification reason', async () => {
      asProvider();
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');
      const caps = await capabilities().expect(200);
      expect(caps.body.primaryReason).toBe(ProviderCapabilityDenialReason.VerificationRequired);
    });
  });

  // ══ STAGE 2 — specialty moderation ═══════════════════════════════════════

  describe('Stage 2 — canonical specialty moderation', () => {
    it('refuses a non-admin', async () => {
      asProvider();
      expect(
        codeOf(await reviewApplication(applicationId, { action: 'APPROVE' }).expect(403)),
      ).toBe('FORBIDDEN');
      anonymous();
      await reviewApplication(applicationId, { action: 'APPROVE' }).expect(401);
    });

    it('answers 404 for an application that does not exist', async () => {
      asAdmin();
      expect(codeOf(await reviewApplication(`${P}ghost`, { action: 'APPROVE' }).expect(404))).toBe(
        'NOT_FOUND',
      );
    });

    it('approves the correct application', async () => {
      asAdmin();
      const res = await reviewApplication(applicationId, { action: 'APPROVE' }).expect(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('created the category relationship exactly once', async () => {
      expect(await categoryGrants(profileId)).toBe(1);
      const join = await prisma.providerProfileServiceCategory.findFirst({
        where: { providerProfileId: profileId },
      });
      expect(join.serviceCategoryId).toBe(LEAF);
    });

    it('audited the decision exactly once', async () => {
      expect(await auditCount('ADMIN_CATEGORY_APPLICATION_APPROVED', ADMIN)).toBe(1);
    });

    it('did not touch the OTHER provider’s application — ownership isolation', async () => {
      const other = await prisma.providerCategoryApplication.findUnique({
        where: { id: otherApplicationId },
      });
      expect(other.status).toBe('PENDING');
      expect(await categoryGrants(otherProfileId)).toBe(0);
    });

    it('returns the documented 409 on repetition, and adds nothing', async () => {
      asAdmin();
      expect(
        codeOf(await reviewApplication(applicationId, { action: 'APPROVE' }).expect(409)),
      ).toBe('CONFLICT');
      expect(await categoryGrants(profileId)).toBe(1);
      expect(await auditCount('ADMIN_CATEGORY_APPLICATION_APPROVED', ADMIN)).toBe(1);
    });

    it('is safe under concurrent decisions on the OTHER application', async () => {
      asAdmin();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          reviewApplication(otherApplicationId, { action: 'APPROVE' }).then((r) => r.status),
        ),
      );
      expect(results.filter((s) => s === 200)).toHaveLength(1);
      expect(results.filter((s) => s === 409)).toHaveLength(5);
      expect(new Set(results)).toEqual(new Set([200, 409]));
      // Exactly one join row and one audit, despite six attempts.
      expect(await categoryGrants(otherProfileId)).toBe(1);
      expect(await auditCount('ADMIN_CATEGORY_APPLICATION_APPROVED', ADMIN)).toBe(2);
    });

    it('STILL refuses protected work — a specialty is not work access', async () => {
      asProvider();
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');
      expect(await allGrants(profileId)).toBe(0);
      const caps = await capabilities().expect(200);
      expect(caps.body.primaryReason).toBe(ProviderCapabilityDenialReason.VerificationRequired);
    });
  });

  // ══ STAGE 3 — the verification case ══════════════════════════════════════

  describe('Stage 3 — canonical verification case', () => {
    it('lets the provider open a case', async () => {
      asProvider();
      const res = await createCase({}).expect(200);
      caseId = res.body.case.id;
      expect(caseId).toBeTruthy();
    });

    it('refuses to submit before the required evidence is supplied', async () => {
      // The readiness policy is recomputed server-side; the seeded base policy
      // requires an INDIVIDUAL_IDENTITY document.
      asProvider();
      const res = await submitCase({});
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).toContain('MISSING_EVIDENCE');
    });

    it('accepts the evidence through prepare → content → finalize', async () => {
      asProvider();
      const prepared = await prepareEvidence({
        kind: 'INDIVIDUAL_IDENTITY',
        declaredMimeType: 'image/png',
        sizeBytes: PNG_BYTES.length,
        filename: 'id.png',
      }).expect(200);
      const assetId = prepared.body.assetId ?? prepared.body.asset?.id;
      expect(assetId).toBeTruthy();

      await putEvidence(assetId).expect(200);
      await finalizeEvidence(assetId).expect(200);

      const doc = await prisma.verificationDocument.findFirst({ where: { caseId } });
      expect(doc).toBeTruthy();
      expect(doc.kind).toBe('INDIVIDUAL_IDENTITY');

      // The bytes that landed are the bytes that were sent. Worth asserting
      // rather than assuming: the scan sweep re-reads the object and re-sniffs
      // it, so a transport that re-encoded the body would surface later as an
      // unexplained REJECTED verdict rather than as an upload failure.
      const stored = [...objects.values()].at(-1);
      expect(stored).toBeTruthy();
      expect(stored!.bytes.subarray(0, 8)).toEqual(PNG_BYTES.subarray(0, 8));
      expect(stored!.bytes.length).toBe(PNG_BYTES.length);
    });

    it('will not submit while the evidence is unscanned', async () => {
      asProvider();
      const res = await submitCase({});
      expect(res.status).toBeGreaterThanOrEqual(400);
      // Distinct from MISSING_EVIDENCE: the document is there, it just has not
      // cleared scanning. Collapsing them would tell a provider to re-upload a
      // file that was fine.
      expect(JSON.stringify(res.body)).toContain('EVIDENCE_NOT_CLEAN');
    });

    it('clears the evidence through the real scan sweep', async () => {
      const before = await prisma.mediaAsset.findFirst({
        where: { ownerUserId: USER },
        select: { scanState: true },
      });
      expect(before.scanState).not.toBe('CLEAN');

      const result = await scanService.scanPending({ limit: 10 });
      // Asserted as COUNTS, not just "it ran": a sweep that examined nothing
      // and a sweep that examined and failed are different faults, and the
      // bare boolean hides both.
      expect(result).toEqual({
        examined: 1,
        cleared: 1,
        quarantined: 0,
        rejected: 0,
        failed: 0,
        skipped: 0,
      });
      // The sweep genuinely called the adapter — the document was not CLEAN
      // already, and nothing else could have moved it.
      expect(scanCalls.length).toBeGreaterThan(0);

      const after = await prisma.mediaAsset.findFirst({
        where: { ownerUserId: USER },
        select: { scanState: true },
      });
      expect(after.scanState).toBe('CLEAN');
    });

    it('lets the provider submit the case once the evidence is clean', async () => {
      asProvider();
      await submitCase({}).expect(200);
      const kase = await prisma.verificationCase.findUnique({ where: { id: caseId } });
      expect(kase.state).toBe('SUBMITTED');
    });

    it('STILL refuses protected work — submission is not a decision', async () => {
      asProvider();
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');
      expect(await allGrants(profileId)).toBe(0);
    });
  });

  // ══ STAGE 4 — the verification decision, which issues the grant ══════════

  describe('Stage 4 — canonical verification approval', () => {
    it('refuses a caller without verification:decide', async () => {
      // The provider holds the `provider` role, which the seed grants only
      // `user:read:self` / `user:write:self`. A different gate from Stage 2's.
      asProvider();
      expect(
        codeOf(
          await approveCase(caseId, { reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' }).expect(403),
        ),
      ).toBe('FORBIDDEN');
      anonymous();
      await approveCase(caseId, { reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' }).expect(401);
    });

    it('succeeds for an admin, whose role carries the permission', async () => {
      asAdmin();
      await approveCase(caseId, {
        reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
        note: 'Identity document verified.',
      }).expect(200);
    });

    it('moved the case to VERIFIED and recorded a decision', async () => {
      const kase = await prisma.verificationCase.findUnique({ where: { id: caseId } });
      expect(kase.state).toBe('VERIFIED');
      const decisions = await prisma.verificationDecision.findMany({ where: { caseId } });
      expect(decisions).toHaveLength(1);
      expect(decisions[0].outcome).toBe('APPROVED');
    });

    it('set the verification axis on the profile', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.verificationState).toBe('VERIFIED');
      expect(p.verified).toBe(true);
    });

    it('issued exactly one live work-access grant', async () => {
      expect(await liveGrants(profileId)).toBe(1);
      expect(await allGrants(profileId)).toBe(1);
      const grant = await prisma.providerWorkAccessGrant.findFirst({
        where: { providerProfileId: profileId },
      });
      expect(grant.revokedAt).toBeNull();
      expect(grant.status).toBe('ACTIVE');
      expect(grant.caseId).toBe(caseId);
    });

    it('audited and published the decision exactly once', async () => {
      expect(await auditCount('VERIFICATION_CASE_APPROVED')).toBe(1);
      expect(await outboxCount(OUTBOX_APPROVED)).toBe(1);
    });

    it('is replay-safe — a repeated approval adds nothing', async () => {
      asAdmin();
      await approveCase(caseId, { reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' }).expect(200);
      expect(await allGrants(profileId)).toBe(1);
      expect(await auditCount('VERIFICATION_CASE_APPROVED')).toBe(1);
      expect(await outboxCount(OUTBOX_APPROVED)).toBe(1);
      const decisions = await prisma.verificationDecision.count({ where: { caseId } });
      expect(decisions).toBe(1);
    });
  });

  // ══ STAGE 5 — the provider is operational ════════════════════════════════

  describe('Stage 5 — the same endpoints that refused now succeed', () => {
    beforeEach(() => asProvider());

    it('allows the marketplace list that returned 403 in Stage 0', async () => {
      await listWork().expect(200);
    });

    it('reports no denial reason at all', async () => {
      const caps = await capabilities().expect(200);
      expect(caps.body.primaryReason).toBeNull();
      expect(caps.body.allowed).toContain('VIEW_MARKETPLACE');
      expect(caps.body.allowed).toContain('SUBMIT_BID');
    });

    it('creates a real bid against a genuinely biddable request', async () => {
      const res = await createBid().expect(201);
      expect(res.body).toBeTruthy();
      const bids = await prisma.bid.findMany({ where: { providerId: profileId } });
      expect(bids).toHaveLength(1);
      expect(bids[0].requestId).toBe(REQUEST);
      expect(bids[0].status).toBe('PENDING');
    });

    it('ran the handler’s real side effects', async () => {
      // The seeker was notified and the request timeline moved — proof the
      // handler executed rather than a guard merely letting the request pass.
      expect(notifications.filter((n) => n.userId === SEEKER)).toHaveLength(1);
      expect(await prisma.serviceRequestEvent.count({ where: { requestId: REQUEST } })).toBe(1);
    });

    it('created no duplicate grant, category grant, audit or outbox event', async () => {
      expect(await allGrants(profileId)).toBe(1);
      expect(await categoryGrants(profileId)).toBe(1);
      expect(await auditCount('VERIFICATION_CASE_APPROVED')).toBe(1);
      expect(await outboxCount(OUTBOX_APPROVED)).toBe(1);
      expect(await auditCount('ADMIN_PROVIDER_APPROVED', ADMIN)).toBe(1);
    });

    it('left the OTHER provider unactivated — every axis is per-provider', async () => {
      const other = await prisma.providerProfile.findUnique({ where: { id: otherProfileId } });
      expect(other.verified).toBe(false);
      expect(await allGrants(otherProfileId)).toBe(0);
      asProvider(OTHER);
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');
    });
  });

  // ══ STAGE 6 — standing overrides remain independent ══════════════════════

  describe('Stage 6 — suspension overrides, without erasing history', () => {
    it('suspends through the canonical endpoint', async () => {
      asAdmin();
      const res = await suspendProvider(profileId, { reason: 'Under investigation.' }).expect(200);
      expect(res.body.provider.status).toBe('SUSPENDED');
    });

    it('returns protected work to 403', async () => {
      asProvider();
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');
      const caps = await capabilities().expect(200);
      expect(caps.body.primaryReason).toBe(ProviderCapabilityDenialReason.ProviderSuspended);
    });

    it('did NOT erase the moderation decision', async () => {
      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profileId },
      });
      expect(apps[0].status).toBe('APPROVED');
      expect(await categoryGrants(profileId)).toBe(1);
    });

    it('did NOT erase the verification decision or the grant', async () => {
      // ADR 0013 §6: the verified history stands. Suspension is a standing
      // decision at rank 3 — it outranks the grant rather than deleting it.
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.verificationState).toBe('VERIFIED');
      expect(p.verified).toBe(true);
      const kase = await prisma.verificationCase.findUnique({ where: { id: caseId } });
      expect(kase.state).toBe('VERIFIED');
      expect(await liveGrants(profileId)).toBe(1);
    });

    it('did not alter the recorded onboarding decision', async () => {
      // ONBOARDING_AXIS_FOR maps SUSPENDED to ACCEPTED precisely so a
      // suspended provider is not sent back into the wizard.
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.onboardingState).toBe('ACCEPTED');
    });

    it('restores access on reactivation, because every prerequisite still holds', async () => {
      asAdmin();
      await reactivateProvider(profileId).expect(200);
      asProvider();
      await listWork().expect(200);
      const caps = await capabilities().expect(200);
      expect(caps.body.primaryReason).toBeNull();
    });

    it('issued no second grant on reactivation', async () => {
      // Reactivation lifts a standing block. It is not a verification decision
      // and must not mint access of its own.
      expect(await allGrants(profileId)).toBe(1);
      expect(await auditCount('VERIFICATION_CASE_APPROVED')).toBe(1);
    });
  });
});
