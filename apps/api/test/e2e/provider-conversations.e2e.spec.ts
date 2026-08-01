// Route-level e2e for /v1/provider/conversations/* (Sprint 01 hardening).
// Boots a minimal Nest app with only the ProviderConversationsController;
// the service is replaced with an in-test fake. Real HTTP stack
// (cookie-parser, ValidationPipe, exception filter) without booting
// Prisma. JwtAuthGuard, CsrfGuard, and ProviderActiveGuard are
// overridden with fakes; RolesGuard runs unchanged so the role-gate
// behaviour matches production.
//
// What these tests pin:
//   - endpoints are auth-gated (no session ⇒ 401)
//   - endpoints are role-gated (non-provider ⇒ 403)
//   - endpoints are gated by ProviderActiveGuard (non-ACTIVE ⇒ 403).
//     THIS is the regression the sprint closes: before the guard was
//     mounted, a DRAFT / PENDING_REVIEW / SUSPENDED provider could open
//     and post in booking chats. The overrideGuard below is inert unless
//     the controller actually mounts ProviderActiveGuard.

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppConfigService } from '../../src/config/app-config.service';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { ProviderConversationsController } from '../../src/modules/conversations/provider-conversations.controller';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { ProviderActiveGuard } from '../../src/modules/provider/guards/provider-active.guard';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';

jest.setTimeout(15_000);

function makeConfig(): AppConfigService {
  return {
    get: () => undefined,
    get isProduction() {
      return false;
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
let fakeProviderActive = true;

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
  canActivate(): boolean {
    return true;
  }
}

class FakeProviderActiveGuard implements CanActivate {
  canActivate(): boolean {
    if (!fakeProviderActive) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    return true;
  }
}

async function bootApp(): Promise<INestApplication> {
  const config = makeConfig();
  @Module({
    controllers: [ProviderConversationsController],
    providers: [
      Reflector,
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
    .overrideGuard(ProviderActiveGuard)
    .useClass(FakeProviderActiveGuard)
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

describe('ProviderConversationsController (e2e) — /v1/provider/conversations/*', () => {
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
    fakeProviderActive = true;
  });

  describe('auth gating', () => {
    it('GET /v1/provider/conversations → 401 when unauthenticated', async () => {
      const res = await request(app.getHttpServer()).get('/v1/provider/conversations');
      expect(res.status).toBe(401);
      expect(res.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(conversationsService.list).not.toHaveBeenCalled();
    });
  });

  describe('role gating', () => {
    it('list → 403 for a non-provider session', async () => {
      fakeAuthedUser = { id: 'user-1', sessionId: 's', jti: 'j', roles: ['customer'] };
      const res = await request(app.getHttpServer()).get('/v1/provider/conversations');
      expect(res.status).toBe(403);
      expect(conversationsService.list).not.toHaveBeenCalled();
    });
  });

  describe('provider-active gating', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-prov-1', sessionId: 's', jti: 'j', roles: ['provider'] };
      fakeProviderActive = false;
    });

    it('list → 403 when the provider profile is not ACTIVE', async () => {
      const res = await request(app.getHttpServer()).get('/v1/provider/conversations');
      expect(res.status).toBe(403);
      expect(res.body?.error?.code).toBe('FORBIDDEN');
      expect(conversationsService.list).not.toHaveBeenCalled();
    });

    it('sendMessage → 403 when the provider profile is not ACTIVE', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/provider/conversations/conv-1/messages')
        .send({ body: 'hello' });
      expect(res.status).toBe(403);
      expect(res.body?.error?.code).toBe('FORBIDDEN');
      expect(conversationsService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('happy-path (ACTIVE provider)', () => {
    beforeEach(() => {
      fakeAuthedUser = { id: 'user-prov-1', sessionId: 's', jti: 'j', roles: ['provider'] };
    });

    it('list → 200 and forwards the userId', async () => {
      conversationsService.list.mockResolvedValue({ items: [], nextCursor: null });
      const res = await request(app.getHttpServer()).get('/v1/provider/conversations');
      expect(res.status).toBe(200);
      expect(conversationsService.list).toHaveBeenCalledWith('user-prov-1');
    });
  });
});
