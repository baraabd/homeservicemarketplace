/* eslint-disable @typescript-eslint/no-require-imports -- Real database services load only inside the established DB gate. */
import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@homeservicemarketplace/database';
import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';
import type { CreateParticipantDisputeRequest } from '@homeservicemarketplace/contracts';

const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);
dbDescribe('Sprint 12A intake — real PostgreSQL transactions and privacy', () => {
  const prefix = fixturePrefix('dispute-intake');
  const seeker = `${prefix}seeker`; const provider = `${prefix}provider-user`; const outsider = `${prefix}outsider`;
  const bookingId = `${prefix}booking`; const profileId = `${prefix}profile`; const requestId = `${prefix}request`; const bidId = `${prefix}bid`;
  const settingKey = 'disputes.self_service.intake';
  let prisma: PrismaClient; let locks: HeldLock | undefined;
  let service: import('../../src/modules/disputes/dispute-intake.service').DisputeIntakeService;
  let repository: import('../../src/modules/disputes/dispute-intake.repository').DisputeIntakeRepository;
  let outbox: import('../../src/infrastructure/outbox/outbox.repository').OutboxRepository;
  let originalSetting: Awaited<ReturnType<PrismaClient['platformSetting']['findUnique']>>;
  const policy = { version: 'sprint12-ci', enabled: true, pilotUserIds: [seeker, provider], allowedBookingStates: ['SCHEDULED', 'COMPLETED'], terminalWindowHours: 24 };
  async function clearCases() {
    const rows = await prisma.dispute.findMany({ where: { bookingId }, select: { id: true } });
    await prisma.outboxEvent.deleteMany({ where: { aggregateType: 'Dispute', aggregateId: { in: rows.map((row) => row.id) } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [seeker, provider] } } });
    await prisma.dispute.deleteMany({ where: { bookingId } });
    await prisma.bookingEvent.deleteMany({ where: { bookingId } });
  }
  async function command(patch: Partial<CreateParticipantDisputeRequest> = {}) {
    const context = await service.context(seeker, bookingId);
    return { bookingId, idempotencyKey: randomUUID(), policyVersion: context.policyVersion!, issueCode: 'SERVICE_QUALITY' as const, requestedOutcome: 'REPERFORM' as const, statement: 'Private original statement which must never enter a notification.', ...patch };
  }
  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([{ resource: 'providerLifecycle', mode: 'shared' }, { resource: 'outbox', mode: 'shared' }, { resource: 'serviceRequests', mode: 'shared' }]);
    prisma = (require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database')).prisma;
    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { PlatformSettingRepository } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const { DisputeIntakeRepository } = require('../../src/modules/disputes/dispute-intake.repository');
    const { DisputeIntakeService } = require('../../src/modules/disputes/dispute-intake.service');
    const database = { client: prisma } as InstanceType<typeof PrismaService>;
    repository = new DisputeIntakeRepository(database);
    outbox = new OutboxRepository(database);
    service = new DisputeIntakeService(repository, new PlatformSettingRepository(database), new TransactionRunner(database), outbox);
    originalSetting = await prisma.platformSetting.findUnique({ where: { key: settingKey } });
    await clearCases();
    await prisma.booking.deleteMany({ where: { id: bookingId } });
    await prisma.bid.deleteMany({ where: { id: bidId } });
    await prisma.serviceRequest.deleteMany({ where: { id: requestId } });
    await prisma.providerProfile.deleteMany({ where: { id: profileId } });
    await prisma.user.deleteMany({ where: { id: { in: [seeker, provider, outsider] } } });
    for (const id of [seeker, provider, outsider]) await prisma.user.create({ data: { id, email: `${id}@example.test`, firstName: 'Test', lastName: 'Participant', status: 'ACTIVE', isActive: true } });
    await prisma.providerProfile.create({ data: { id: profileId, userId: provider, displayName: 'Test Provider', initials: 'TP' } });
    await prisma.serviceRequest.create({ data: { id: requestId, seekerUserId: seeker, scheduleType: 'ASAP', addressSnapshot: {}, status: 'BID_ACCEPTED' } });
    await prisma.bid.create({ data: { id: bidId, requestId, providerId: profileId, amount: 100, pricingType: 'FIXED', status: 'ACCEPTED' } });
    await prisma.booking.create({ data: { id: bookingId, requestId, bidId, seekerUserId: seeker, providerId: profileId, priceAmount: 100, status: 'SCHEDULED' } });
  });
  beforeEach(async () => {
    await clearCases();
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'SCHEDULED' } });
    await prisma.platformSetting.upsert({ where: { key: settingKey }, create: { key: settingKey, value: policy }, update: { value: policy } });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      if (!prisma) return;
      await clearCases();
      await prisma.booking.deleteMany({ where: { id: bookingId } });
      await prisma.bid.deleteMany({ where: { id: bidId } });
      await prisma.serviceRequest.deleteMany({ where: { id: requestId } });
      await prisma.providerProfile.deleteMany({ where: { id: profileId } });
      await prisma.user.deleteMany({ where: { id: { in: [seeker, provider, outsider] } } });
      if (originalSetting) await prisma.platformSetting.upsert({ where: { key: settingKey }, create: { ...originalSetting, value: originalSetting.value as Prisma.InputJsonValue }, update: { ...originalSetting, value: originalSetting.value as Prisma.InputJsonValue } });
      else await prisma.platformSetting.deleteMany({ where: { key: settingKey } });
    } finally { await locks?.release(); }
  });
  it('returns no foreign booking or case information', async () => {
    await expect(service.context(outsider, bookingId)).rejects.toMatchObject({ status: 404 });
    expect((await service.bookings(outsider, {})).items).toHaveLength(0);
    await expect(service.create(outsider, await command())).rejects.toMatchObject({ status: 404 });
  });
  it('commits one dispute, event, notification and outbox event under simultaneous same-intent retries', async () => {
    const input = await command(); const results = await Promise.all([service.create(seeker, input), service.create(seeker, input)]);
    expect(new Set(results.map((result) => result.dispute.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    const id = results[0].dispute.id;
    expect(await prisma.dispute.count({ where: { bookingId } })).toBe(1);
    expect(await prisma.disputeEvent.count({ where: { disputeId: id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: provider } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: id } })).toBe(1);
    const notifications = await prisma.notification.findMany({ where: { userId: provider } });
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: id } });
    expect(JSON.stringify([notifications, events])).not.toContain(input.statement);
    expect(JSON.stringify([notifications, events])).not.toContain(input.idempotencyKey);
  });
  it('collapses different-tab intents and rejects changed payload under a reused key', async () => {
    const first = await command(); const second = await command();
    const results = await Promise.all([service.create(seeker, first), service.create(seeker, second)]);
    expect(new Set(results.map((result) => result.dispute.id)).size).toBe(1);
    const winner = results[0].created ? first : second;
    await expect(service.create(seeker, { ...winner, statement: 'A changed statement for the same retry key.' })).rejects.toMatchObject({ status: 409 });
  });
  it('allows either legitimate participant and hides private narratives and raw Admin events', async () => {
    const result = await service.create(seeker, await command()); const id = result.dispute.id;
    await prisma.dispute.update({ where: { id }, data: { description: 'INTERNAL_ADMIN_SECRET' } });
    await prisma.disputeEvent.create({ data: { disputeId: id, actorUserId: seeker, type: 'COMMENTED', message: 'INTERNAL_EVENT_SECRET', after: { rawKey: 'SECRET_STORAGE_KEY' } } });
    const ownerView = await service.detail(seeker, id); const providerView = await service.detail(provider, id);
    expect(ownerView.statement).toContain('Private original'); expect(providerView.statement).toBeNull();
    expect(JSON.stringify([ownerView, providerView])).not.toMatch(/INTERNAL_|SECRET_STORAGE_KEY|actorUserId/);
    expect(providerView.events).toHaveLength(1);
    expect((await service.list(provider, {})).items[0].id).toBe(id);
    await expect(service.detail(outsider, id)).rejects.toMatchObject({ status: 404 });
    await expect(service.detail(outsider, 'di_nonexistent')).rejects.toMatchObject({ status: 404 });
  });
  it('can be opened by the provider without granting work access', async () => {
    const context = await service.context(provider, bookingId); const input = await command({ policyVersion: context.policyVersion! });
    const result = await service.create(provider, input);
    expect(result.dispute.role).toBe('PROVIDER'); expect(result.dispute.openedByYou).toBe(true);
    expect((await service.detail(seeker, result.dispute.id)).statement).toBeNull();
  });
  it('rolls back the entire creation when outbox persistence fails', async () => {
    jest.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('forced failure'));
    await expect(service.create(seeker, await command())).rejects.toThrow('forced failure');
    expect(await prisma.dispute.count({ where: { bookingId } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: provider } })).toBe(0);
  });
  it('closes intake without a valid policy, but keeps existing case reads available', async () => {
    const input = await command(); const created = await service.create(seeker, input);
    await prisma.platformSetting.delete({ where: { key: settingKey } });
    expect((await service.detail(seeker, created.dispute.id)).id).toBe(created.dispute.id);
    await clearCases();
    expect((await service.context(seeker, bookingId)).canOpen).toBe(false);
    await expect(service.create(seeker, input)).rejects.toMatchObject({ status: 404 });
  });
  it('uses real terminal events, never updatedAt, to enforce the reporting window', async () => {
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'COMPLETED' } });
    expect((await service.context(seeker, bookingId)).blocker).toBe('TIMESTAMP_UNAVAILABLE');
    await prisma.bookingEvent.create({ data: { bookingId, type: 'BOOKING_STATUS_CHANGED', metadata: { from: 'IN_PROGRESS', to: 'COMPLETED' }, createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    // A newer unrelated status event must not extend the completion clock.
    await prisma.bookingEvent.create({ data: { bookingId, type: 'BOOKING_STATUS_CHANGED', metadata: { from: 'SCHEDULED', to: 'IN_PROGRESS' } } });
    expect((await service.context(seeker, bookingId)).blocker).toBe('WINDOW_ELAPSED');
  });
  it('the database invariant also rejects a competing legacy Admin create', async () => {
    await service.create(seeker, await command());
    await expect(prisma.dispute.create({ data: { bookingId, openedById: seeker, reason: 'legacy', status: 'OPEN' } })).rejects.toMatchObject({ code: 'P2002' });
  });
});
