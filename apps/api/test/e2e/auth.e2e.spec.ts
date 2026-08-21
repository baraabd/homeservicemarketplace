// Route-level e2e for the /v1/auth surface. Boots a minimal Nest app with
// only the AuthenticationController; AuthenticationService, TokenService,
// and UserRepository are substituted with in-test fakes. This gives us a
// real HTTP layer (real cookie-parser, real ValidationPipe, real exception
// filter) without booting Prisma/Mongo/Redis.
//
// What these tests pin:
//  - hybrid transport: web response sets cookies; mobile response carries tokens in body
//  - cookie flags: HttpOnly, Secure, SameSite, Path on refresh
//  - CSRF double-submit on /refresh cookie flows
//  - ambiguous transport (cookie + bearer) → 400
//  - anti-enumeration: register/forgot-password/resend-verification return 202 generic
//  - /me requires auth
//  - exception filter: no stack traces leak on internal errors (prod path)
//  - validation failures are normalized through the existing filter

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
import { UserRepository } from '../../src/infrastructure/persistence/iam/user.repository';
import { AuthenticationController } from '../../src/modules/iam/authentication/controllers/authentication.controller';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import {
  RegistrationThrottleService,
  RegistrationThrottledError,
} from '../../src/infrastructure/throttle/registration-throttle.service';
import { AuthenticationService } from '../../src/modules/iam/authentication/services/authentication.service';
import { TokenService } from '../../src/modules/iam/authentication/services/token.service';

jest.setTimeout(30_000);

function makeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    FRONTEND_URL: 'http://localhost:5173',
    COOKIE_SECURE: false, // supertest runs over plain HTTP
    COOKIE_SAMESITE: 'lax',
    COOKIE_DOMAIN: undefined,
    JWT_ACCESS_TTL_SECONDS: 600,
    isProduction: false,
  };
  const merged = { ...values, ...overrides };
  return {
    get: (k: string) => merged[k],
    get isProduction() {
      return merged.isProduction === true;
    },
  } as unknown as AppConfigService;
}

// Controllable doubles. Each test sets its own behavior.
const authService = {
  register: jest.fn(),
  resendVerification: jest.fn(),
  verifyEmail: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
  logoutAll: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  // Added in the email-otp phase.
  verifyOtp: jest.fn(),
  resendOtp: jest.fn(),
};

const userRepo = { findById: jest.fn(), listRoles: jest.fn() };

// D-1 registration limiter double. Default behaviour is "within budget" so the
// pre-existing register assertions are unchanged; the dedicated D-1 suite
// (registration-throttle.*.spec.ts) exercises the real limiter, and the
// throttled-response test below makes this double reject.
const registrationThrottle = { assertWithinBudget: jest.fn() };

// Minimal JwtAuthGuard double: honors a test-controlled toggle.
let fakeAuthedUser: { id: string; sessionId: string; jti: string; roles: string[] } | null = null;
class FakeJwtAuthGuard {
  canActivate(ctx: ExecutionContext): boolean {
    if (!fakeAuthedUser) {
      // Throw the same normalized 401 the real guard emits.
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    const req = ctx.switchToHttp().getRequest();
    req.user = fakeAuthedUser;
    return true;
  }
}

async function bootApp(configOverrides: Record<string, unknown> = {}): Promise<INestApplication> {
  const config = makeConfig(configOverrides);

  @Module({
    controllers: [AuthenticationController],
    providers: [
      { provide: AuthenticationService, useValue: authService },
      { provide: TokenService, useValue: {} },
      { provide: UserRepository, useValue: userRepo },
      { provide: RegistrationThrottleService, useValue: registrationThrottle },
      { provide: AppConfigService, useValue: config },
      { provide: JwtAuthGuard, useClass: FakeJwtAuthGuard },
      { provide: APP_FILTER, useFactory: () => new AllExceptionsFilter(config) },
    ],
  })
  class TestModule {}

  const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeJwtAuthGuard)
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

function issuedSession(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 'u-1' },
    roles: ['customer'],
    issued: {
      session: { id: 'sess-1' },
      access: { token: 'signed.jwt.token', jti: 'j-1', ttlSeconds: 600, expiresAt: new Date() },
      refresh: {
        raw: 'refresh-raw-value',
        hash: 'h',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    },
    ...overrides,
  };
}

describe('Authentication controller (e2e)', () => {
  let app: INestApplication;

  beforeEach(() => {
    Object.values(authService).forEach((m) => (m as jest.Mock).mockReset());
    userRepo.findById.mockReset();
    userRepo.listRoles.mockReset();
    fakeAuthedUser = null;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // --- Registration -------------------------------------------------------
  describe('POST /v1/auth/register', () => {
    const issuedChallenge = (overrides: Record<string, unknown> = {}) => ({
      challengeId: 'chal-reg-xyz',
      expiresInSeconds: 300,
      codeLength: 6,
      ...overrides,
    });

    it('returns 202 with an opaque OTP challenge envelope (no user id leaked)', async () => {
      app = await bootApp();
      authService.register.mockResolvedValueOnce(issuedChallenge());
      const res = await request(app.getHttpServer()).post('/v1/auth/register').send({
        email: 'ada@example.com',
        password: 'strong-password',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        otpRequired: true,
        challengeId: 'chal-reg-xyz',
        expiresInSeconds: 300,
        codeLength: 6,
      });
      // No session cookies issued by register.
      const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(setCookie.join('\n')).not.toMatch(/hsm_at|hsm_rt|hsm_csrf/);
    });

    it('returns 400 via ValidationPipe when payload is invalid', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'not-an-email', password: 'short', firstName: '', lastName: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(authService.register).not.toHaveBeenCalled();
    });

    // Auth security audit: the register surface accepts only email +
    // password + firstName + lastName. Every other field — and especially
    // anything that could grant a privileged role — must be rejected by
    // the global ValidationPipe before the service is called. Pinning each
    // vector individually means a future DTO change that accidentally
    // whitelists one of them will fail loudly here.
    it.each([
      { isAdmin: true },
      { admin: true },
      { role: 'admin' },
      { roles: ['admin'] },
      { roleName: 'admin' },
      { status: 'ACTIVE' },
      { providerProfile: { status: 'ACTIVE' } },
      { permissions: ['user:write:any'] },
      { userId: 'someone-else' },
      { id: 'someone-else' },
    ])('rejects forbidden field on register: %p', async (extra) => {
      app = await bootApp();
      authService.register.mockResolvedValue({
        challengeId: 'chal-reg-xyz',
        expiresInSeconds: 300,
        codeLength: 6,
      });
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({
          email: 'ada@example.com',
          password: 'strong-password',
          firstName: 'Ada',
          lastName: 'Lovelace',
          ...extra,
        });
      expect(res.status).toBe(400);
      expect(res.body?.error?.code).toBe('VALIDATION_ERROR');
      // The service is never called — the rejection happens at the pipe
      // layer, so a bad payload cannot create even a partial user.
      expect(authService.register).not.toHaveBeenCalled();
    });

    it('rejects passwords below the policy minimum (12 chars), accepts at the boundary', async () => {
      app = await bootApp();
      authService.register.mockResolvedValue({
        challengeId: 'chal-reg-xyz',
        expiresInSeconds: 300,
        codeLength: 6,
      });
      // 11 characters → policy violation (DTO @Length(12, 128))
      const tooShort = await request(app.getHttpServer()).post('/v1/auth/register').send({
        email: 'ada@example.com',
        password: 'short-pass1',
        firstName: 'Ada',
        lastName: 'X',
      });
      expect(tooShort.status).toBe(400);
      expect(tooShort.body.error.code).toBe('VALIDATION_ERROR');
      expect(authService.register).not.toHaveBeenCalled();

      // 12 characters → accepted
      const atBoundary = await request(app.getHttpServer()).post('/v1/auth/register').send({
        email: 'ada@example.com',
        password: 'twelve-chars',
        firstName: 'Ada',
        lastName: 'X',
      });
      expect(atBoundary.status).toBe(202);
    });

    it('returns 400 on a malformed JSON body without leaking parser internals', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"email": "ada@example.com", "password":'); // truncated JSON
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/at JSON\.parse|node_modules|body-parser/);
      expect(authService.register).not.toHaveBeenCalled();
    });

    // D-1 — over-budget submissions must be rejected at the wire with a
    // stable envelope and an actionable Retry-After, and must never reach the
    // service (so they cost nothing and cannot be used to probe for accounts).
    it('returns a stable 429 + Retry-After when the registration budget is exhausted', async () => {
      app = await bootApp();
      registrationThrottle.assertWithinBudget.mockRejectedValueOnce(
        new RegistrationThrottledError(1800),
      );

      const res = await request(app.getHttpServer()).post('/v1/auth/register').send({
        email: 'ada@example.com',
        password: 'Str0ng!Passw0rd',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      // Retry-After must be a positive integer number of seconds — a client
      // that reads 0 retries immediately and hammers the endpoint.
      expect(res.headers['retry-after']).toBe('1800');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      // No framework artefact ("ThrottlerException") on the wire.
      expect(JSON.stringify(res.body)).not.toMatch(/ThrottlerException|node_modules/);
      expect(authService.register).not.toHaveBeenCalled();
    });

    // Anti-enumeration: the limiter charges its buckets before the service
    // knows whether the address exists, so a known and an unknown address are
    // rejected identically once the budget is gone.
    it('throttles a known and an unknown email indistinguishably', async () => {
      app = await bootApp();
      const send = (email: string) =>
        request(app.getHttpServer()).post('/v1/auth/register').send({
          email,
          password: 'Str0ng!Passw0rd',
          firstName: 'Ada',
          lastName: 'Lovelace',
        });

      registrationThrottle.assertWithinBudget.mockRejectedValue(
        new RegistrationThrottledError(1800),
      );
      const known = await send('existing@example.com');
      const unknown = await send('nobody@example.com');

      expect(known.status).toBe(unknown.status);
      expect(known.body.error.code).toBe(unknown.body.error.code);
      expect(known.headers['retry-after']).toBe(unknown.headers['retry-after']);
    });
  });

  // --- Login: OTP challenge (no session yet) ----------------------------
  // Behavior changed in the email-otp phase: /login no longer issues a
  // session on success. It returns an OTP challenge and sets NO cookies
  // regardless of client kind. Session cookies/tokens are issued ONLY by
  // /verify-otp after the user proves possession of the emailed code.
  describe('POST /v1/auth/login — OTP challenge', () => {
    const issuedChallenge = (overrides: Record<string, unknown> = {}) => ({
      challengeId: 'chal-abc',
      expiresInSeconds: 300,
      codeLength: 6,
      ...overrides,
    });

    it('WEB client: returns { otpRequired, challengeId, ... } and sets NO auth cookies', async () => {
      app = await bootApp();
      authService.login.mockResolvedValueOnce(issuedChallenge());
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .set('X-Client-Kind', 'web')
        .send({ email: 'ada@example.com', password: 'pw' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        otpRequired: true,
        challengeId: 'chal-abc',
        expiresInSeconds: 300,
        codeLength: 6,
      });
      const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(setCookie.join('\n')).not.toMatch(/hsm_at|hsm_rt|hsm_csrf/);
    });

    it('MOBILE client: identical response shape, no cookies, no tokens leaked yet', async () => {
      app = await bootApp();
      authService.login.mockResolvedValueOnce(issuedChallenge());
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .set('X-Client-Kind', 'mobile')
        .send({ email: 'ada@example.com', password: 'pw' });

      expect(res.status).toBe(200);
      expect(res.body.otpRequired).toBe(true);
      expect(res.body.challengeId).toBe('chal-abc');
      expect(res.body.tokens).toBeUndefined();
      const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(setCookie.join('\n')).not.toMatch(/hsm_at|hsm_rt|hsm_csrf/);
    });
  });

  // --- Verify OTP: THIS is where sessions are now issued -----------------
  describe('POST /v1/auth/verify-otp', () => {
    it('WEB client: sets hsm_at, hsm_rt, hsm_csrf cookies with correct flags; body contains NO tokens', async () => {
      app = await bootApp();
      authService.verifyOtp.mockResolvedValueOnce(issuedSession());
      const res = await request(app.getHttpServer())
        .post('/v1/auth/verify-otp')
        .set('X-Client-Kind', 'web')
        .send({ challengeId: 'chal-16-plus-chars', code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.tokens).toBeNull();
      expect(res.body.userId).toBe('u-1');
      expect(res.body.roles).toEqual(['customer']);

      const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      const joined = setCookie.join('\n');
      expect(joined).toMatch(/hsm_at=.*HttpOnly/i);
      expect(joined).toMatch(/hsm_at=.*SameSite=Lax/i);
      expect(joined).toMatch(/hsm_rt=.*HttpOnly/i);
      expect(joined).toMatch(/hsm_rt=.*Path=\/v1\/auth\/refresh/i);
      expect(joined).toMatch(/hsm_rt=.*SameSite=Strict/i);
      expect(joined).toMatch(/hsm_csrf=/);
      expect(joined).not.toMatch(/hsm_csrf=.*HttpOnly/i);
      expect(joined).toMatch(/hsm_csrf=.*SameSite=Strict/i);
    });

    it('MOBILE client: returns tokens in body and sets NO auth cookies', async () => {
      app = await bootApp();
      authService.verifyOtp.mockResolvedValueOnce(issuedSession());
      const res = await request(app.getHttpServer())
        .post('/v1/auth/verify-otp')
        .set('X-Client-Kind', 'mobile')
        .send({ challengeId: 'chal-16-plus-chars', code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.tokens).toEqual({
        accessToken: 'signed.jwt.token',
        refreshToken: 'refresh-raw-value',
        expiresIn: 600,
      });
      const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(setCookie.join('\n')).not.toMatch(/hsm_at|hsm_rt|hsm_csrf/);
    });

    it('rejects malformed codes before calling the service (ValidationPipe)', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/verify-otp')
        .send({ challengeId: 'chal-16-plus-chars', code: 'abcde6' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(authService.verifyOtp).not.toHaveBeenCalled();
    });
  });

  // --- Refresh: cookie XOR header, CSRF ----------------------------------
  describe('POST /v1/auth/refresh', () => {
    it('rejects when BOTH cookie and Authorization-style refresh header are present (ambiguous transport)', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set('Cookie', ['hsm_rt=from-cookie', 'hsm_csrf=abc'])
        .set('X-CSRF-Token', 'abc')
        .set('X-Refresh-Token', 'from-header');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AUTH_AMBIGUOUS_TRANSPORT');
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('web cookie flow: requires X-CSRF-Token to match hsm_csrf cookie', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set('Cookie', ['hsm_rt=the-refresh', 'hsm_csrf=secret'])
        .set('X-CSRF-Token', 'wrong');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AUTH_CSRF_FAILED');
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('web cookie flow: proceeds when CSRF header matches cookie, re-sets cookies', async () => {
      app = await bootApp();
      authService.refresh.mockResolvedValueOnce({
        issued: {
          session: { id: 'new-sess' },
          access: { token: 'new.jwt', jti: 'j2', ttlSeconds: 600, expiresAt: new Date() },
          refresh: { raw: 'new-refresh', hash: 'h', expiresAt: new Date(Date.now() + 60_000) },
        },
        roles: ['customer'],
        userId: 'u-1',
      });
      const res = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set('X-Client-Kind', 'web')
        .set('Cookie', ['hsm_rt=the-refresh', 'hsm_csrf=secret'])
        .set('X-CSRF-Token', 'secret');
      expect(res.status).toBe(200);
      expect(res.body.tokens).toBeNull();
      expect(authService.refresh).toHaveBeenCalledWith(
        expect.objectContaining({ refreshTokenRaw: 'the-refresh' }),
      );
    });

    it('mobile header flow: no CSRF required; returns tokens in body', async () => {
      app = await bootApp();
      authService.refresh.mockResolvedValueOnce({
        issued: {
          session: { id: 'new-sess' },
          access: { token: 'new.jwt', jti: 'j2', ttlSeconds: 600, expiresAt: new Date() },
          refresh: { raw: 'new-refresh', hash: 'h', expiresAt: new Date(Date.now() + 60_000) },
        },
        roles: ['customer'],
        userId: 'u-1',
      });
      const res = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set('X-Client-Kind', 'mobile')
        .set('X-Refresh-Token', 'mobile-refresh');
      expect(res.status).toBe(200);
      expect(res.body.tokens.refreshToken).toBe('new-refresh');
    });

    it('rejects when no refresh token is presented at all', async () => {
      app = await bootApp();
      const res = await request(app.getHttpServer()).post('/v1/auth/refresh');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REFRESH_INVALID');
    });

    it('normalizes a service UnauthorizedException (e.g., replay) into AUTH_REFRESH_INVALID', async () => {
      app = await bootApp();
      authService.refresh.mockRejectedValueOnce(
        new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' }),
      );
      const res = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set('X-Client-Kind', 'mobile')
        .set('X-Refresh-Token', 'bad');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REFRESH_INVALID');
    });
  });

  // --- Anti-enumeration ---------------------------------------------------
  describe('anti-enumeration', () => {
    it('resend-verification always returns 202 with {success:true}, regardless of email existence', async () => {
      app = await bootApp();
      authService.resendVerification.mockResolvedValueOnce(undefined);
      const a = await request(app.getHttpServer())
        .post('/v1/auth/resend-verification')
        .send({ email: 'real@example.com' });
      expect(a.status).toBe(202);
      expect(a.body).toEqual({ success: true });

      authService.resendVerification.mockResolvedValueOnce(undefined);
      const b = await request(app.getHttpServer())
        .post('/v1/auth/resend-verification')
        .send({ email: 'nobody@example.com' });
      expect(b.status).toBe(202);
      expect(b.body).toEqual(a.body);
    });

    it('forgot-password always returns 202 with {success:true}, even for unknown emails', async () => {
      app = await bootApp();
      authService.forgotPassword.mockResolvedValue(undefined);
      const res = await request(app.getHttpServer())
        .post('/v1/auth/forgot-password')
        .send({ email: 'nobody@example.com' });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ success: true });
    });
  });

  // --- /me + logout -------------------------------------------------------
  describe('authenticated endpoints', () => {
    it('GET /v1/auth/me → 401 when no token (normalized error, no stack)', async () => {
      app = await bootApp();
      fakeAuthedUser = null;
      const res = await request(app.getHttpServer()).get('/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(JSON.stringify(res.body)).not.toMatch(/stack|at Function|at Object/);
    });

    it('GET /v1/auth/me → 200 with safe shape (no passwordHash, no mfaSecret) when authenticated', async () => {
      app = await bootApp();
      fakeAuthedUser = { id: 'u-1', sessionId: 'sess-1', jti: 'j', roles: ['customer'] };
      userRepo.findById.mockResolvedValueOnce({
        id: 'u-1',
        email: 'ada@example.com',
        passwordHash: '$argon2id$leaky',
        firstName: 'Ada',
        lastName: 'Lovelace',
        status: 'ACTIVE',
        emailVerifiedAt: new Date('2024-01-01T00:00:00Z'),
        mfaEnabled: false,
        mfaSecret: Buffer.from('secret-must-not-leak'),
      });
      userRepo.listRoles.mockResolvedValueOnce([{ role: { name: 'customer' } }]);

      const res = await request(app.getHttpServer()).get('/v1/auth/me');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: 'u-1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        status: 'ACTIVE',
        emailVerifiedAt: '2024-01-01T00:00:00.000Z',
        mfaEnabled: false,
        roles: ['customer'],
      });
      expect(JSON.stringify(res.body)).not.toContain('argon2');
      expect(JSON.stringify(res.body)).not.toContain('secret-must-not-leak');
    });

    it('POST /v1/auth/logout clears auth cookies', async () => {
      app = await bootApp();
      fakeAuthedUser = { id: 'u-1', sessionId: 'sess-1', jti: 'j', roles: [] };
      authService.logout.mockResolvedValueOnce(undefined);
      const res = await request(app.getHttpServer()).post('/v1/auth/logout');
      expect(res.status).toBe(204);
      const setCookie = ((res.headers['set-cookie'] as unknown as string[]) ?? []).join('\n');
      // clearCookie emits cookies with Expires in the past / Max-Age=0
      expect(setCookie).toMatch(/hsm_at=;/);
      expect(setCookie).toMatch(/hsm_rt=;/);
      expect(setCookie).toMatch(/hsm_csrf=;/);
    });

    it('POST /v1/auth/logout-all revokes all sessions and clears cookies', async () => {
      app = await bootApp();
      fakeAuthedUser = { id: 'u-1', sessionId: 'sess-1', jti: 'j', roles: [] };
      authService.logoutAll.mockResolvedValueOnce(3);
      const res = await request(app.getHttpServer()).post('/v1/auth/logout-all');
      expect(res.status).toBe(204);
      expect(authService.logoutAll).toHaveBeenCalledWith('u-1', expect.anything());
    });
  });

  // --- Stack trace / PII leakage ------------------------------------------
  describe('error hygiene', () => {
    it('in production, internal service errors return generic 500 — no stack, no message leak', async () => {
      app = await bootApp({ isProduction: true });
      authService.login.mockRejectedValueOnce(new Error('internal: db secret 12345'));
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .set('X-Client-Kind', 'mobile')
        .send({ email: 'ada@example.com', password: 'pw' });
      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Internal server error');
      expect(JSON.stringify(res.body)).not.toContain('db secret 12345');
      expect(JSON.stringify(res.body)).not.toMatch(/stack|at /);
    });
  });
});
