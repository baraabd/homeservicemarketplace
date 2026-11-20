import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@homeservicemarketplace/database';

import {
  AUTH_OTP_CHANNEL_SETTING,
  AuthChannelService,
} from '../../src/infrastructure/auth-channel/auth-channel.service';
import type { WhatsAppAuthAdapter } from '../../src/infrastructure/auth-channel/whatsapp-auth.adapter';
import { AuditEventRepository } from '../../src/infrastructure/persistence/iam/audit-event.repository';
import { PlatformSettingRepository } from '../../src/infrastructure/persistence/settings/platform-setting.repository';
import { PlatformSettingHistoryRepository } from '../../src/infrastructure/persistence/settings/platform-setting-history.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../src/infrastructure/prisma/transaction.runner';
import { AdminAuditService } from '../../src/modules/admin/admin-audit.service';
import { AdminSettingsService } from '../../src/modules/admin/settings/admin-settings.service';
import { createIsolatedDatabase, type IsolatedDatabase } from '../support/isolated-database';

const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

// Policy persistence, live administrator/contact checks, account locks and audit
// use the real services and PostgreSQL transactions. Only the sender capability
// is controlled here; this suite never sends a message. Other email journeys
// select email explicitly instead of depending on the product's default.
suite('authentication channel policy (isolated real PostgreSQL)', () => {
  let isolated: IsolatedDatabase | undefined;
  let prisma: PrismaClient;
  let settings: PlatformSettingRepository;
  let audit: AdminAuditService;
  let channels: AuthChannelService;
  let adminSettings: AdminSettingsService;
  let adminRoleId: string;
  let adminUserId: string;
  let phoneSequence = 0;
  let whatsappConfigured = false;
  const whatsapp = {
    isConfigured: () => whatsappConfigured,
  } as unknown as WhatsAppAuthAdapter;

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
      throw new Error('Authentication policy integration requires local disposable services.');
    isolated = await createIsolatedDatabase('auth_channel_policy');
    prisma = isolated.prisma;
    const database = { client: prisma } as PrismaService;
    settings = new PlatformSettingRepository(database);
    audit = new AdminAuditService(new AuditEventRepository(database));
    channels = new AuthChannelService(settings, whatsapp);
    adminSettings = new AdminSettingsService(
      settings,
      new PlatformSettingHistoryRepository(database),
      audit,
      new TransactionRunner(database),
      channels,
    );
    adminRoleId = (await prisma.role.create({ data: { name: 'admin' } })).id;
  });

  beforeEach(async () => {
    whatsappConfigured = false;
    // The singleton policy exists only in this suite's disposable database.
    // Keep every history/audit entry and use a fresh synthetic actor per case.
    await prisma.platformSetting.deleteMany({ where: { key: AUTH_OTP_CHANNEL_SETTING } });
    adminUserId = `auth-policy-${randomUUID()}`;
    phoneSequence += 1;
    await prisma.user.create({
      data: {
        id: adminUserId,
        email: `${adminUserId}@example.test`,
        phoneNumber: `+9665${String(phoneSequence).padStart(8, '0')}`,
        firstName: 'Synthetic',
        lastName: 'Policy administrator',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
        userRoles: { create: { roleId: adminRoleId } },
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await isolated?.dispose();
  });

  async function history() {
    return prisma.platformSettingHistory.findMany({
      where: { key: AUTH_OTP_CHANNEL_SETTING, changedBy: adminUserId },
      orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async function auditEvents() {
    return prisma.auditEvent.findMany({
      where: { userId: adminUserId, type: 'ADMIN_SETTING_UPDATED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  it('uses WhatsApp for a missing setting while keeping delivery readiness separate', async () => {
    await expect(channels.getPublicConfig()).resolves.toEqual({
      otpChannel: 'whatsapp',
      whatsappAvailable: false,
    });
    await expect(channels.getChannel()).rejects.toMatchObject({ status: 503 });
    const bulk = await adminSettings.getBulk();
    expect(bulk.values[AUTH_OTP_CHANNEL_SETTING]).toBe('whatsapp');
    expect(bulk.defaults[AUTH_OTP_CHANNEL_SETTING]).toBe('whatsapp');

    whatsappConfigured = true;
    await expect(channels.getChannel()).resolves.toBe('whatsapp');
    expect(await settings.findByKey(AUTH_OTP_CHANNEL_SETTING)).toBeNull();
    expect(await history()).toEqual([]);
    expect(await auditEvents()).toEqual([]);
  });

  it('keeps an explicit email choice after reloading policy while WhatsApp is unavailable', async () => {
    await adminSettings.updateBulk(adminUserId, { [AUTH_OTP_CHANNEL_SETTING]: 'email' });
    const reloaded = new AuthChannelService(settings, whatsapp);

    await expect(reloaded.getPublicConfig()).resolves.toEqual({
      otpChannel: 'email',
      whatsappAvailable: false,
    });
    await expect(reloaded.getChannel()).resolves.toBe('email');
    expect(await settings.findByKey(AUTH_OTP_CHANNEL_SETTING)).toMatchObject({
      value: 'email',
      updatedBy: adminUserId,
    });
    expect(await history()).toEqual([
      expect.objectContaining({ previousValue: null, newValue: 'email', changedBy: adminUserId }),
    ]);
    expect(await auditEvents()).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ newValue: 'email', source: 'bulk', changed: true }),
      }),
    ]);
  });

  it('preserves the email override on unsafe reset and audits a verified reset to WhatsApp', async () => {
    await adminSettings.upsert(adminUserId, AUTH_OTP_CHANNEL_SETTING, 'email');
    await expect(adminSettings.remove(adminUserId, AUTH_OTP_CHANNEL_SETTING)).rejects.toMatchObject(
      {
        status: 503,
      },
    );
    expect((await settings.findByKey(AUTH_OTP_CHANNEL_SETTING))?.value).toBe('email');
    expect(await history()).toHaveLength(1);
    expect(await auditEvents()).toHaveLength(1);

    whatsappConfigured = true;
    await prisma.user.update({ where: { id: adminUserId }, data: { phoneVerifiedAt: null } });
    await expect(adminSettings.remove(adminUserId, AUTH_OTP_CHANNEL_SETTING)).rejects.toMatchObject(
      {
        status: 400,
      },
    );
    await expect(channels.getChannel()).resolves.toBe('email');
    expect(await history()).toHaveLength(1);
    expect(await auditEvents()).toHaveLength(1);

    await prisma.user.update({ where: { id: adminUserId }, data: { phoneVerifiedAt: new Date() } });
    await adminSettings.remove(adminUserId, AUTH_OTP_CHANNEL_SETTING);

    expect(await settings.findByKey(AUTH_OTP_CHANNEL_SETTING)).toBeNull();
    await expect(channels.getChannel()).resolves.toBe('whatsapp');
    expect(await history()).toEqual([
      expect.objectContaining({ previousValue: null, newValue: 'email' }),
      expect.objectContaining({ previousValue: 'email', newValue: null, reason: 'deleted' }),
    ]);
    expect(await auditEvents()).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ newValue: 'email' }) }),
      expect.objectContaining({
        metadata: {
          key: AUTH_OTP_CHANNEL_SETTING,
          action: 'deleted',
          previousValue: 'email',
          newValue: null,
          source: 'keyed',
        },
      }),
    ]);
  });

  it('refuses all policy write paths after live admin membership is revoked', async () => {
    await adminSettings.upsert(adminUserId, AUTH_OTP_CHANNEL_SETTING, 'email');
    await prisma.userRole.delete({
      where: { userId_roleId: { userId: adminUserId, roleId: adminRoleId } },
    });
    whatsappConfigured = true;

    await expect(
      adminSettings.updateBulk(adminUserId, { [AUTH_OTP_CHANNEL_SETTING]: 'whatsapp' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      adminSettings.upsert(adminUserId, AUTH_OTP_CHANNEL_SETTING, 'whatsapp'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(adminSettings.remove(adminUserId, AUTH_OTP_CHANNEL_SETTING)).rejects.toMatchObject(
      {
        status: 403,
      },
    );
    await expect(channels.getChannel()).resolves.toBe('email');
    expect(await history()).toHaveLength(1);
    expect(await auditEvents()).toHaveLength(1);
  });

  it('rolls back the reset and its history if the audit write fails', async () => {
    await adminSettings.upsert(adminUserId, AUTH_OTP_CHANNEL_SETTING, 'email');
    whatsappConfigured = true;
    jest.spyOn(audit, 'record').mockRejectedValueOnce(new Error('synthetic audit write failure'));

    await expect(adminSettings.remove(adminUserId, AUTH_OTP_CHANNEL_SETTING)).rejects.toThrow(
      'synthetic audit write failure',
    );
    await expect(channels.getChannel()).resolves.toBe('email');
    expect((await settings.findByKey(AUTH_OTP_CHANNEL_SETTING))?.value).toBe('email');
    expect(await history()).toHaveLength(1);
    expect(await auditEvents()).toHaveLength(1);
  });
});
