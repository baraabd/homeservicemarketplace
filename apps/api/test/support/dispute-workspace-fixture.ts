import { hash as hashPassword } from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient, type Prisma } from '@homeservicemarketplace/database';
import type { AppConfigService } from '../../src/config/app-config.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../src/infrastructure/prisma/transaction.runner';
import { OutboxRepository } from '../../src/infrastructure/outbox/outbox.repository';
import { RoleRepository } from '../../src/infrastructure/persistence/iam/role.repository';
import { PlatformSettingRepository } from '../../src/infrastructure/persistence/settings/platform-setting.repository';
import { WorkspaceRepository } from '../../src/modules/disputes/workspace/workspace.repository';
import { WorkspaceCipher } from '../../src/modules/disputes/workspace/workspace-cipher.service';
import { WorkspaceEvents } from '../../src/modules/disputes/workspace/workspace-events.service';
import { WorkspaceRequests } from '../../src/modules/disputes/workspace/workspace-requests.service';
import { WorkspaceResolution } from '../../src/modules/disputes/workspace/workspace-resolution.service';
import { WorkspaceAppeals } from '../../src/modules/disputes/workspace/workspace-appeals.service';
import { WorkspaceCommands } from '../../src/modules/disputes/workspace/workspace-commands.service';
import { DisputeWorkspaceService } from '../../src/modules/disputes/workspace/workspace.service';
import { WorkspaceDrafts } from '../../src/modules/disputes/workspace/workspace-drafts.service';
import { WorkspaceEvidence } from '../../src/modules/disputes/workspace/workspace-evidence.service';
import { WorkspacePrivateLifecycle } from '../../src/modules/disputes/workspace/workspace-private-lifecycle.service';
import { WorkspaceMaintenance } from '../../src/modules/disputes/workspace/workspace-maintenance.service';
import { WorkspacePreferences } from '../../src/modules/disputes/workspace/workspace-preferences.service';
import {
  WORKSPACE_PERMISSIONS as P,
  WORKSPACE_SETTING,
} from '../../src/modules/disputes/workspace/workspace.policy';
import { DisputeIntakeRepository } from '../../src/modules/disputes/dispute-intake.repository';
import { DisputeIntakeService } from '../../src/modules/disputes/dispute-intake.service';
import { LocalDiskRestrictedStorageAdapter } from '../../src/infrastructure/storage/local-disk-restricted-storage.adapter';
import { ClamAvMalwareScanner } from '../../src/modules/provider/verification/media/clamav-scanner.adapter';
import { DeterministicTestScanner } from '../../src/modules/provider/verification/media/malware-scanner.port';
import { acquireAdvisoryLocks, fixturePrefix } from './db-isolation';

/** Real DB/filesystem, explicitly synthetic accounts and test-only scanner.
 * Excludes other shared policy/seed consumers instead of weakening global worker counts. */
export async function workspaceFixture(options: { authentication?: boolean } = {}) {
  const lock = await acquireAdvisoryLocks([
    { resource: 'seed', mode: options.authentication ? 'exclusive' : 'shared' },
    { resource: 'providerLifecycle', mode: 'exclusive' },
    { resource: 'outbox', mode: 'shared' },
    { resource: 'serviceRequests', mode: 'shared' },
  ]);
  const db = new PrismaClient({ log: [] });
  let root: string | undefined;
  try {
    const prefix = fixturePrefix('s12-workspace');
    const users = {
      seeker: prefix + 'seeker',
      provider: prefix + 'provider',
      reviewer: prefix + 'reviewer',
      independent: prefix + 'independent',
      reader: prefix + 'reader',
      outsider: prefix + 'outsider',
    };
    root = await mkdtemp(join(tmpdir(), 's12-evidence-'));
    const fixtureRoot = root;
    const privateKey = randomBytes(32).toString('base64');
    const configValues: Record<string, unknown> = {
      DISPUTE_PRIVATE_ACTIVE_KEY: 'ci',
      DISPUTE_PRIVATE_KEYS_JSON: JSON.stringify({ ci: privateKey }),
      RESTRICTED_STORAGE_DIR: root,
      NODE_ENV: 'test',
      CLAMAV_HOST: process.env.CLAMAV_HOST ?? '127.0.0.1',
      CLAMAV_PORT: Number(process.env.CLAMAV_PORT ?? 3310),
      CLAMAV_TIMEOUT_MS: 30000,
    };
    const config = {
      get: (key: string) => configValues[key],
      isProduction: false,
    } as AppConfigService;
    const database = { client: db } as PrismaService;
    const roles = new RoleRepository(database);
    const repository = new WorkspaceRepository(database, {
      resolveFreshForUser: async (id, tx) => new Set(await roles.listPermissionKeysForUser(id, tx)),
    });
    const transactions = new TransactionRunner(database),
      outbox = new OutboxRepository(database);
    const cipher = new WorkspaceCipher(config),
      events = new WorkspaceEvents(outbox);
    const resolution = new WorkspaceResolution(cipher, repository),
      requests = new WorkspaceRequests(cipher, repository),
      appeals = new WorkspaceAppeals(cipher, resolution);
    const commands = new WorkspaceCommands(
      transactions,
      repository,
      requests,
      resolution,
      appeals,
      events,
    );
    const cases = new DisputeWorkspaceService(repository, transactions, cipher, events);
    const drafts = new WorkspaceDrafts(repository, transactions, cipher);
    const storage = new LocalDiskRestrictedStorageAdapter(config),
      scanner =
        process.env.DISPUTE_TEST_SCANNER === 'clamav'
          ? new ClamAvMalwareScanner(config)
          : new DeterministicTestScanner();
    const evidence = new WorkspaceEvidence(
      repository,
      transactions,
      cipher,
      events,
      storage,
      scanner,
    );
    const privacy = new WorkspacePrivateLifecycle(repository, transactions, events);
    const maintenance = new WorkspaceMaintenance(
      repository,
      transactions,
      events,
      evidence,
      privacy,
    );
    const preferences = new WorkspacePreferences(database);
    const intake = new DisputeIntakeService(
      new DisputeIntakeRepository(database),
      new PlatformSettingRepository(database),
      transactions,
      outbox,
      cases,
    );
    const settings = ['disputes.self_service.intake', WORKSPACE_SETTING];
    const previous = await db.platformSetting.findMany({ where: { key: { in: settings } } });
    const policy = {
      version: 'ci-workspace-v1',
      enabled: true,
      pilotUserIds: [users.seeker, users.provider],
      appealWindowHours: 24,
      requestWindowHours: 1,
      proposalWindowHours: 1,
      resolutionWindowHours: 48,
      evidenceRetentionDays: 30,
      draftRetentionHours: 24,
    };
    async function clear() {
      const ids = (
        await db.dispute.findMany({
          where: { bookingId: { startsWith: prefix } },
          select: { id: true },
        })
      ).map((x) => x.id);
      const draftIds = (
        await db.disputePrivateDraft.findMany({
          where: { bookingId: { startsWith: prefix } },
          select: { id: true },
        })
      ).map((row) => row.id);
      await db.outboxEvent.deleteMany({ where: { aggregateId: { in: [...ids, ...draftIds] } } });
      await db.auditEvent.deleteMany({ where: { userId: { in: Object.values(users) } } });
      await db.notification.deleteMany({ where: { userId: { in: Object.values(users) } } });
      await db.disputeNotificationPreference.deleteMany({
        where: { userId: { in: Object.values(users) } },
      });
      await db.disputePrivateDraft.deleteMany({ where: { bookingId: { startsWith: prefix } } });
      await db.disputeCommandReceipt.deleteMany({ where: { disputeId: { in: ids } } });
      await db.disputeWorkspaceEvent.deleteMany({ where: { disputeId: { in: ids } } });
      await db.disputeAppealRecord.deleteMany({ where: { disputeId: { in: ids } } });
      await db.disputeDecisionRecord.deleteMany({ where: { disputeId: { in: ids } } });
      await db.disputeResolutionConsent.deleteMany({
        where: { proposal: { disputeId: { in: ids } } },
      });
      await db.disputeResolutionProposal.deleteMany({ where: { disputeId: { in: ids } } });
      await db.disputeStatement.deleteMany({ where: { disputeId: { in: ids } } });
      await db.disputeInformationRequest.deleteMany({ where: { disputeId: { in: ids } } });
      await db.disputeEvidence.deleteMany({ where: { disputeId: { in: ids } } });
      await db.disputeWorkspace.deleteMany({ where: { disputeId: { in: ids } } });
      await db.dispute.deleteMany({ where: { id: { in: ids } } });
      await db.booking.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.bid.deleteMany({ where: { id: { startsWith: prefix } } });
      await db.serviceRequest.deleteMany({ where: { id: { startsWith: prefix } } });
    }
    await clear();
    for (const id of Object.values(users))
      await db.user.upsert({
        where: { id },
        create: {
          id,
          email: `${id}@example.test`,
          firstName: 'Synthetic',
          lastName: 'Test',
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
        },
        update: { status: 'ACTIVE', isActive: true, deletedAt: null },
      });
    for (const person of ['reviewer', 'independent', 'reader'] as const) {
      const role = await db.role.upsert({
        where: { name: users[person] },
        create: { id: users[person] + '-role', name: users[person] },
        update: { deletedAt: null },
      });
      await db.rolePermission.deleteMany({ where: { roleId: role.id } });
      for (const key of person === 'reader' ? [P.READ] : Object.values(P)) {
        const permission = await db.permission.findUniqueOrThrow({ where: { key } });
        await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
      await db.userRole.upsert({
        where: { userId_roleId: { userId: users[person], roleId: role.id } },
        create: { userId: users[person], roleId: role.id },
        update: {},
      });
    }
    const authRoles: string[] = [];
    const password = options.authentication ? `T!${randomBytes(24).toString('base64url')}a7` : null;
    if (password) {
      const passwordHash = await hashPassword(password);
      await db.user.updateMany({
        where: { id: { in: Object.values(users) } },
        data: { passwordHash },
      });
      for (const [name, id] of Object.entries(users)) {
        const roleName = ['reviewer', 'independent', 'reader'].includes(name)
          ? 'admin'
          : name === 'provider'
            ? 'provider'
            : 'seeker';
        let role = await db.role.findUnique({ where: { name: roleName } });
        if (!role) {
          role = await db.role.create({ data: { name: roleName, isSystem: true } });
          authRoles.push(role.id);
        }
        await db.userRole.upsert({
          where: { userId_roleId: { userId: id, roleId: role.id } },
          create: { userId: id, roleId: role.id },
          update: {},
        });
      }
    }
    const profileId = prefix + 'profile';
    await db.providerProfile.upsert({
      where: { id: profileId },
      create: {
        id: profileId,
        userId: users.provider,
        displayName: 'Synthetic professional',
        initials: 'SP',
      },
      update: {},
    });
    const intakePolicy = {
      version: 'ci-intake-workspace',
      enabled: true,
      pilotUserIds: policy.pilotUserIds,
      allowedBookingStates: ['SCHEDULED'],
      terminalWindowHours: 24,
    };
    for (const [key, value] of [
      [settings[0], intakePolicy],
      [WORKSPACE_SETTING, policy],
    ] as const)
      await db.platformSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    async function booking() {
      const id = prefix + randomUUID();
      const requestId = id + '-request',
        bidId = id + '-bid';
      await db.serviceRequest.create({
        data: {
          id: requestId,
          seekerUserId: users.seeker,
          scheduleType: 'ASAP',
          addressSnapshot: {},
          status: 'BID_ACCEPTED',
        },
      });
      await db.bid.create({
        data: {
          id: bidId,
          requestId,
          providerId: profileId,
          amount: 100,
          pricingType: 'FIXED',
          status: 'ACCEPTED',
        },
      });
      await db.booking.create({
        data: {
          id,
          requestId,
          bidId,
          seekerUserId: users.seeker,
          providerId: profileId,
          priceAmount: 100,
          status: 'SCHEDULED',
        },
      });
      return id;
    }
    async function create() {
      const bookingId = await booking();
      const context = await intake.context(users.seeker, bookingId);
      const input = {
        bookingId,
        idempotencyKey: randomUUID(),
        policyVersion: context.policyVersion!,
        issueCode: 'SERVICE_QUALITY' as const,
        requestedOutcome: 'REPERFORM' as const,
        statement: 'Private original statement: the agreed service was not completed.',
      };
      const response = await intake.create(users.seeker, input);
      return { id: response.dispute.id, bookingId, input };
    }
    async function command(disputeId: string, actorId: string, command: Record<string, unknown>) {
      const w = await db.disputeWorkspace.findUniqueOrThrow({ where: { disputeId } });
      return commands.execute(
        actorId,
        disputeId,
        { idempotencyKey: randomUUID(), expectedRevision: w.revision, command },
        ![users.seeker, users.provider].includes(actorId),
      );
    }
    async function assigned() {
      const c = await create();
      await command(c.id, users.reviewer, { action: 'ASSIGN', reviewerId: users.reviewer });
      return c;
    }
    async function dispose() {
      try {
        await clear();
        await db.providerProfile.deleteMany({ where: { id: profileId } });
        await db.session.deleteMany({ where: { userId: { in: Object.values(users) } } });
        await db.user.deleteMany({ where: { id: { in: Object.values(users) } } });
        await db.rolePermission.deleteMany({ where: { roleId: { startsWith: prefix } } });
        await db.role.deleteMany({ where: { id: { startsWith: prefix } } });
        await db.role.deleteMany({ where: { id: { in: authRoles } } });
        for (const key of settings) {
          const old = previous.find((s) => s.key === key);
          if (old)
            await db.platformSetting.upsert({
              where: { key },
              create: { ...old, value: old.value as Prisma.InputJsonValue },
              update: { ...old, value: old.value as Prisma.InputJsonValue },
            });
          else await db.platformSetting.deleteMany({ where: { key } });
        }
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
        await db.$disconnect();
        await lock.release();
      }
    }
    return {
      db,
      prefix,
      users,
      password,
      configValues,
      config,
      database,
      root: fixtureRoot,
      cipher,
      repository,
      transactions,
      outbox,
      events,
      cases,
      drafts,
      commands,
      evidence,
      maintenance,
      privacy,
      preferences,
      storage,
      scanner,
      intake,
      policy,
      booking,
      create,
      assigned,
      command,
      clear,
      dispose,
    };
  } catch (error) {
    // Initialization failures must not retain cross-suite advisory locks.
    if (root) await rm(root, { recursive: true, force: true });
    await db.$disconnect();
    await lock.release();
    throw error;
  }
}
export type WorkspaceFixture = Awaited<ReturnType<typeof workspaceFixture>>;
