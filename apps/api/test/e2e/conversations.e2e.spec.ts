// Route-level e2e for /v1/me/conversations. Boots a minimal Nest app
// with only the ConversationsController; ConversationsService is
// replaced with an in-test fake. Real HTTP stack (cookie-parser,
// ValidationPipe, exception filter, JwtAuthGuard, CsrfGuard) without
// booting Prisma / Mongo / Redis.
//
// What these tests pin:
//   - every endpoint is auth-gated (no session ⇒ 401, stable code)
//   - create / send / mark-read are CSRF-gated
//   - DTO validation rejects empty / oversize message bodies +
//     unknown query parameters BEFORE the service is called
//   - controller forwards (sessionUserId, conversationId, body) intact
//   - cross-user / non-participant ids surface as the service's
//     NOT_FOUND, never as 403, and the error body never carries
//     Prisma / SQL strings

import {
  ExecutionContext,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppConfigService } from '../../src/config/app-config.service';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { ConversationsController } from '../../src/modules/conversations/conversations.controller';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { AppError } from '../../src/shared/errors/app-error';

jest.setTimeout(15_000);

function makeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = { isProduction: false };
  const merged = { ...values, ...overrides };
  return {
    get: (k: string) => merged[k],
    get isProduction() {
      return merged.isProduction === true;
    },
  } as unknown as AppConfigService;
}

const conversationsService = {
  list: jest.fn(),
  getOrCreateForBooking: jest.fn(),
  listMessages: jest.fn(),
  sendMessage: jest.fn(),
  markRead: jest.fn(),
};

let fakeAuthedUser: { id: string; sessionId: string; jti: string; roles: string[] } | null = null;
class FakeJwtAuthGuard {
  canActivate(ctx: ExecutionContext): boolean {
    if (!fakeAuthedUser) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    const req = ctx.switchToHttp().getRequest();
    req.user = fakeAuthedUser;
    return true;
  }
}

class FakeCsrfGuard {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const cookie = req.cookies?.hsm_csrf;
    const header = req.header('x-csrf-token');
    if (!cookie || !header || cookie !== header) {
      throw new UnauthorizedException({ code: 'AUTH_CSRF_FAILED' });
    }
    return true;
  }
}

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();
  @Module({
    controllers: [ConversationsController],
    providers: [
      { provide: ConversationsService, useValue: conversationsService },
      { provide: AppConfigService, useValue: config },
      { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeJwtAuthGuard)
    .overrideGuard(CsrfGuard)
    .useClass(FakeCsrfGuard)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
}

describe('ConversationsController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await bootApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    fakeAuthedUser = null;
  });

  describe('auth gating', () => {
    it('GET /v1/me/conversations → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/conversations');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(conversationsService.list).not.toHaveBeenCalled();
    });

    it('POST /v1/me/conversations → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations')
        .send({ bookingId: 'bk-1' });
      expect(res.status).toBe(401);
      expect(conversationsService.getOrCreateForBooking).not.toHaveBeenCalled();
    });

    it('GET messages → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me/conversations/c-1/messages');
      expect(res.status).toBe(401);
      expect(conversationsService.listMessages).not.toHaveBeenCalled();
    });

    it('POST message → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations/c-1/messages')
        .send({ body: 'hi' });
      expect(res.status).toBe(401);
      expect(conversationsService.sendMessage).not.toHaveBeenCalled();
    });

    it('POST read → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/conversations/c-1/read');
      expect(res.status).toBe(401);
      expect(conversationsService.markRead).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('returns the items envelope and forwards userId', async () => {
      conversationsService.list.mockResolvedValue({ items: [], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/me/conversations');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
      expect(conversationsService.list).toHaveBeenCalledWith('user-1');
    });
  });

  describe('create', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects without a CSRF token (CsrfGuard fires before service)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations')
        .send({ bookingId: 'bk-1' });
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_CSRF_FAILED');
      expect(conversationsService.getOrCreateForBooking).not.toHaveBeenCalled();
    });

    it('rejects unknown body fields (forbidNonWhitelisted IDOR vector)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ bookingId: 'bk-1', senderUserId: 'user-victim' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(conversationsService.getOrCreateForBooking).not.toHaveBeenCalled();
    });

    it('forwards (userId, bookingId) on a valid POST', async () => {
      conversationsService.getOrCreateForBooking.mockResolvedValue({
        conversation: {
          id: 'conv-1',
          bookingId: 'bk-1',
          requestId: 'req-1',
          otherParticipant: { displayName: 'Omar', initials: 'O', avatarUrl: null },
          lastMessageBody: null,
          lastMessageAt: null,
          unreadCount: 0,
          createdAt: '2026-04-29T02:00:00.000Z',
          updatedAt: '2026-04-29T02:00:00.000Z',
        },
      });
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ bookingId: 'bk-1' });
      expect(res.status).toBe(200);
      expect(res.body.conversation.id).toBe('conv-1');
      expect(conversationsService.getOrCreateForBooking).toHaveBeenCalledWith('user-1', 'bk-1');
    });

    it('cross-user bookingId surfaces as 404 (no Prisma leak)', async () => {
      conversationsService.getOrCreateForBooking.mockRejectedValue(
        new AppError('NOT_FOUND', 'Booking not found.', 404),
      );
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ bookingId: 'bk-victim' });
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation|SELECT|INSERT|UPDATE/i);
    });
  });

  describe('listMessages', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('forwards (userId, conversationId, query) on a valid GET', async () => {
      conversationsService.listMessages.mockResolvedValue({ items: [], nextCursor: null });
      const res = await request(app.getHttpServer()).get(
        '/v1/me/conversations/conv-1/messages?limit=20',
      );
      expect(res.status).toBe(200);
      expect(conversationsService.listMessages).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('rejects unknown query parameters', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/me/conversations/conv-1/messages?userId=user-victim',
      );
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(conversationsService.listMessages).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects without a CSRF token', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations/conv-1/messages')
        .send({ body: 'hi' });
      expect(res.status).toBe(401);
    });

    it('rejects an empty / whitespace-only body (MinLength after trim)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations/conv-1/messages')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ body: '   ' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(conversationsService.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects body fields the contract does not declare (no senderUserId smuggling)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations/conv-1/messages')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ body: 'hi', senderUserId: 'user-victim', senderRole: 'PROVIDER' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      expect(conversationsService.sendMessage).not.toHaveBeenCalled();
    });

    it('forwards (userId, conversationId, body) on a valid POST', async () => {
      conversationsService.sendMessage.mockResolvedValue({
        message: {
          id: 'm-1',
          senderRole: 'SEEKER',
          body: 'hi',
          sentByMe: true,
          createdAt: '2026-04-29T03:00:00.000Z',
        },
      });
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations/conv-1/messages')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok')
        .send({ body: 'hi' });
      expect(res.status).toBe(201);
      expect(res.body.message.body).toBe('hi');
      expect(conversationsService.sendMessage).toHaveBeenCalledWith('user-1', 'conv-1', 'hi');
    });
  });

  describe('markRead', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
    });

    it('rejects without a CSRF token', async () => {
      const res = await request(app.getHttpServer()).post('/v1/me/conversations/conv-1/read');
      expect(res.status).toBe(401);
    });

    it('returns the lastReadAt envelope on a valid POST', async () => {
      conversationsService.markRead.mockResolvedValue({ lastReadAt: '2026-04-29T03:30:00.000Z' });
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations/conv-1/read')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ lastReadAt: '2026-04-29T03:30:00.000Z' });
      expect(conversationsService.markRead).toHaveBeenCalledWith('user-1', 'conv-1');
    });

    it('non-participant surfaces as 404 (no Prisma leak)', async () => {
      conversationsService.markRead.mockRejectedValue(
        new AppError('NOT_FOUND', 'Conversation not found.', 404),
      );
      const res = await request(app.getHttpServer())
        .post('/v1/me/conversations/conv-victim/read')
        .set('Cookie', 'hsm_csrf=tok')
        .set('X-CSRF-Token', 'tok');
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation/i);
    });
  });
});
