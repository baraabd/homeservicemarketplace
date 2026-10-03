/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * R13 is DB-gated, so the generated Prisma client is loaded lazily only when
 * RUN_DB_INTEGRATION=1. The HTTP handles use supertest's dynamic shape.
 */
export {};

import { APP_FILTER, Reflector } from '@nestjs/core';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const named = req.headers['x-test-user'];
    if (typeof named !== 'string' || !named) throw new UnauthorizedException();
    req.user = { id: named };
    return true;
  }
}

class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

d('R13 - durable help and support (real HTTP, real Postgres)', () => {
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let locks: HeldLock | undefined;

  const P = fixturePrefix('r13support');
  const REQUESTER = `${P}requester`;
  const OTHER = `${P}other`;
  const ADMIN = `${P}admin`;
  const NO_ADMIN = `${P}no-admin`;
  const ROLE_ID = `${P}role`;
  const ROLE_NAME = `${P}support-operator`;
  const USERS = [REQUESTER, OTHER, ADMIN, NO_ADMIN];

  const createKey = (suffix: string) => `r13_create_${suffix.padEnd(16, 'x')}`;
  const sendKey = (suffix: string) => `r13_send_${suffix.padEnd(16, 'y')}`;

  const as = (userId: string, method: 'get' | 'post', url: string) =>
    request(http)[method](url).set('x-test-user', userId);

  const createTicket = (
    userId: string,
    key: string,
    subject = 'Need platform help',
    message = 'Please help with my account.',
  ) =>
    as(userId, 'post', '/v1/me/support/tickets').send({
      subject,
      message,
      idempotencyKey: key,
    });

  const sendMessage = (userId: string, ticketId: string, key: string, body: string) =>
    as(userId, 'post', `/v1/me/support/tickets/${ticketId}/messages`).send({
      body,
      idempotencyKey: key,
    });

  async function wipe() {
    await prisma.supportMessage.deleteMany({
      where: { ticket: { requesterUserId: { in: USERS } } },
    });
    await prisma.supportTicket.deleteMany({ where: { requesterUserId: { in: USERS } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: ROLE_ID } });
    await prisma.role.deleteMany({ where: { id: ROLE_ID } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([{ resource: 'seed', mode: 'shared' }]);

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const prismaSvc = { client: prisma, isReady: () => true };

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      SupportRepository,
    } = require('../../src/infrastructure/persistence/support/support.repository');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { SupportService } = require('../../src/modules/support/support.service');
    const {
      AdminSupportController,
      SupportController,
    } = require('../../src/modules/support/support.controller');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      PermissionResolverService,
    } = require('../../src/modules/iam/authorization/services/permission-resolver.service');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { RolesGuard } = require('../../src/modules/iam/authorization/guards/roles.guard');
    const {
      PermissionsGuard,
    } = require('../../src/modules/iam/authorization/guards/permissions.guard');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { RedisService } = require('../../src/infrastructure/redis/redis.service');

    const flags: Record<string, unknown> = {
      JWT_ACCESS_SECRET: makeTestSecret('r13-support'),
      PERMISSION_CACHE_TTL_SECONDS: 300,
    };
    const config = { get: (key: string) => flags[key], isProduction: false };
    const noRedis = {
      getClient: () => {
        throw new Error('R13 support authority uses fresh database permissions');
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SupportController, AdminSupportController],
      providers: [
        SupportService,
        SupportRepository,
        RoleRepository,
        PermissionResolverService,
        AuditService,
        AuditEventRepository,
        TransactionRunner,
        Reflector,
        { provide: PrismaService, useValue: prismaSvc },
        { provide: AppConfigService, useValue: config },
        { provide: RedisService, useValue: noRedis },
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
      .useClass(PassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    await wipe();
    for (const id of USERS) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@r13-support.test`,
          firstName: 'R13',
          lastName: 'Fixture',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }

    const permission = await prisma.permission.upsert({
      where: { key: 'user:read:any' },
      update: {},
      create: { key: 'user:read:any', description: 'R13 support acceptance permission' },
    });
    await prisma.role.create({
      data: {
        id: ROLE_ID,
        name: ROLE_NAME,
        description: 'R13 isolated support test role',
        isSystem: false,
      },
    });
    await prisma.rolePermission.create({
      data: { roleId: ROLE_ID, permissionId: permission.id },
    });
    await prisma.userRole.create({ data: { userId: ADMIN, roleId: ROLE_ID } });
  });

  afterAll(async () => {
    try {
      if (prisma) await wipe();
    } finally {
      try {
        await app?.close();
      } finally {
        await locks?.release();
      }
    }
  });

  beforeEach(async () => {
    await prisma.supportMessage.deleteMany({
      where: { ticket: { requesterUserId: { in: USERS } } },
    });
    await prisma.supportTicket.deleteMany({ where: { requesterUserId: { in: USERS } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: ADMIN, roleId: ROLE_ID } },
      update: {},
      create: { userId: ADMIN, roleId: ROLE_ID },
    });
  });

  it('creates one durable ticket and first message, then reloads them', async () => {
    const key = createKey('durable');
    const created = await createTicket(
      REQUESTER,
      key,
      'مشكلة في التطبيق',
      '<script>alert(1)</script> نص عربي stays text',
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      replayed: false,
      ticket: {
        id: expect.any(String),
        subject: 'مشكلة في التطبيق',
        status: 'OPEN',
        messages: [
          {
            authorRole: 'REQUESTER',
            body: '<script>alert(1)</script> نص عربي stays text',
          },
        ],
      },
    });

    const ticketId = created.body.ticket.id;
    expect(
      await prisma.supportTicket.count({ where: { id: ticketId, requesterUserId: REQUESTER } }),
    ).toBe(1);
    expect(await prisma.supportMessage.count({ where: { ticketId } })).toBe(1);

    const list = await as(REQUESTER, 'get', '/v1/me/support/tickets');
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: ticketId, subject: 'مشكلة في التطبيق', status: 'OPEN' }),
    ]);

    const detail = await as(REQUESTER, 'get', `/v1/me/support/tickets/${ticketId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(created.body.ticket);

    const audit = await prisma.auditEvent.findFirst({
      where: { userId: REQUESTER, type: 'SUPPORT_TICKET_CREATED' },
    });
    expect(audit.metadata).toEqual({
      supportTicketId: ticketId,
      supportMessageId: created.body.ticket.messages[0].id,
    });
    expect(JSON.stringify(audit)).not.toContain('مشكلة');
    expect(JSON.stringify(audit)).not.toContain('script');
  });

  it('replays the same ticket-create key and rejects changed content', async () => {
    const key = createKey('replay');
    const first = await createTicket(REQUESTER, key);
    const replay = await createTicket(REQUESTER, key);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.body).toMatchObject({
      replayed: true,
      ticket: { id: first.body.ticket.id },
    });
    expect(await prisma.supportTicket.count({ where: { requesterUserId: REQUESTER } })).toBe(1);

    const changed = await createTicket(REQUESTER, key, 'Changed subject', 'Different content');
    expect(changed.status).toBe(409);
    expect(await prisma.supportTicket.count({ where: { requesterUserId: REQUESTER } })).toBe(1);
  });

  it('concurrent ticket retries create exactly one ticket', async () => {
    const key = createKey('race');
    const [a, b] = await Promise.all([
      createTicket(REQUESTER, key, 'One logical ticket', 'same message'),
      createTicket(REQUESTER, key, 'One logical ticket', 'same message'),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(new Set([a.body.ticket.id, b.body.ticket.id]).size).toBe(1);
    expect(await prisma.supportTicket.count({ where: { requesterUserId: REQUESTER } })).toBe(1);
    expect(await prisma.supportMessage.count({ where: { ticketId: a.body.ticket.id } })).toBe(1);
  });

  it('enforces ownership and does not expose another user ticket', async () => {
    const created = await createTicket(REQUESTER, createKey('owner'));
    const ticketId = created.body.ticket.id;

    const peek = await as(OTHER, 'get', `/v1/me/support/tickets/${ticketId}`);
    expect(peek.status).toBe(404);

    const intrude = await sendMessage(OTHER, ticketId, sendKey('intrude'), 'not mine');
    expect(intrude.status).toBe(404);
    expect(await prisma.supportMessage.count({ where: { ticketId } })).toBe(1);

    const anonymous = await request(http).get(`/v1/me/support/tickets/${ticketId}`);
    expect(anonymous.status).toBe(401);
  });

  it('makes message retry idempotent but preserves two intentional equal messages', async () => {
    const created = await createTicket(REQUESTER, createKey('send'));
    const ticketId = created.body.ticket.id;
    const key = sendKey('same-logical');

    const first = await sendMessage(REQUESTER, ticketId, key, 'hello support');
    const replay = await sendMessage(REQUESTER, ticketId, key, 'hello support');
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(first.body.replayed).toBe(false);
    expect(replay.body).toMatchObject({ replayed: true, message: { id: first.body.message.id } });

    const changed = await sendMessage(REQUESTER, ticketId, key, 'changed');
    expect(changed.status).toBe(409);

    const intentional = await sendMessage(
      REQUESTER,
      ticketId,
      sendKey('second-intent'),
      'hello support',
    );
    expect(intentional.status).toBe(201);
    expect(intentional.body.message.id).not.toBe(first.body.message.id);
    expect(await prisma.supportMessage.count({ where: { ticketId } })).toBe(3);
  });

  it('serializes concurrent duplicate message sends to one stored message', async () => {
    const created = await createTicket(REQUESTER, createKey('send-race'));
    const ticketId = created.body.ticket.id;
    const key = sendKey('send-race');

    const [a, b] = await Promise.all([
      sendMessage(REQUESTER, ticketId, key, 'only once'),
      sendMessage(REQUESTER, ticketId, key, 'only once'),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(new Set([a.body.message.id, b.body.message.id]).size).toBe(1);
    expect(
      await prisma.supportMessage.count({ where: { ticketId, body: 'only once' } }),
    ).toBe(1);
  });

  it('requires a fresh support permission for admin read/write and revocation is immediate', async () => {
    const created = await createTicket(REQUESTER, createKey('admin'));
    const ticketId = created.body.ticket.id;

    const denied = await as(NO_ADMIN, 'get', '/v1/admin/support/tickets');
    expect(denied.status).toBe(403);

    const list = await as(ADMIN, 'get', '/v1/admin/support/tickets');
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({
        id: ticketId,
        requester: expect.objectContaining({ id: REQUESTER }),
      }),
    ]);

    const reply = await as(ADMIN, 'post', `/v1/admin/support/tickets/${ticketId}/messages`).send({
      body: 'A persisted support reply',
      idempotencyKey: sendKey('admin-reply'),
    });
    expect(reply.status).toBe(201);

    const audit = await prisma.auditEvent.findFirst({
      where: { userId: ADMIN, type: 'ADMIN_SUPPORT_REPLIED' },
    });
    expect(audit.metadata).toEqual({
      supportTicketId: ticketId,
      supportMessageId: reply.body.message.id,
    });
    expect(JSON.stringify(audit)).not.toContain('persisted support reply');

    await prisma.userRole.delete({
      where: { userId_roleId: { userId: ADMIN, roleId: ROLE_ID } },
    });
    const revoked = await as(
      ADMIN,
      'post',
      `/v1/admin/support/tickets/${ticketId}/messages`,
    ).send({ body: 'must fail', idempotencyKey: sendKey('revoked') });
    expect(revoked.status).toBe(403);
    expect(
      await prisma.supportMessage.count({ where: { ticketId, body: 'must fail' } }),
    ).toBe(0);
  });

  it('closes and reopens atomically and a closed ticket refuses messages', async () => {
    const created = await createTicket(REQUESTER, createKey('close'));
    const ticketId = created.body.ticket.id;

    const closed = await as(ADMIN, 'post', `/v1/admin/support/tickets/${ticketId}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ id: ticketId, status: 'CLOSED' });
    expect(closed.body.closedAt).toEqual(expect.any(String));

    const refused = await sendMessage(REQUESTER, ticketId, sendKey('while-closed'), 'hello?');
    expect(refused.status).toBe(409);
    expect(
      await prisma.supportMessage.count({ where: { ticketId, body: 'hello?' } }),
    ).toBe(0);

    const duplicateClose = await as(
      ADMIN,
      'post',
      `/v1/admin/support/tickets/${ticketId}/close`,
    );
    expect(duplicateClose.status).toBe(409);

    const reopened = await as(
      ADMIN,
      'post',
      `/v1/admin/support/tickets/${ticketId}/reopen`,
    );
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ id: ticketId, status: 'OPEN', closedAt: null });

    const sent = await sendMessage(REQUESTER, ticketId, sendKey('after-reopen'), 'back again');
    expect(sent.status).toBe(201);

    const events = await prisma.auditEvent.findMany({
      where: {
        userId: ADMIN,
        type: { in: ['ADMIN_SUPPORT_CLOSED', 'ADMIN_SUPPORT_REOPENED'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((event: any) => event.type)).toEqual([
      'ADMIN_SUPPORT_CLOSED',
      'ADMIN_SUPPORT_REOPENED',
    ]);
  });

  it('rejects malformed or oversized writes without storing them', async () => {
    const malformed = await as(REQUESTER, 'post', '/v1/me/support/tickets').send({
      subject: '',
      message: '',
      idempotencyKey: 'short',
      requesterUserId: OTHER,
    });
    expect(malformed.status).toBe(400);
    expect(await prisma.supportTicket.count({ where: { requesterUserId: REQUESTER } })).toBe(0);

    const tooLong = await createTicket(
      REQUESTER,
      createKey('long'),
      'x'.repeat(161),
      'y'.repeat(4001),
    );
    expect(tooLong.status).toBe(400);
    expect(await prisma.supportTicket.count({ where: { requesterUserId: REQUESTER } })).toBe(0);
  });
});
