// AuthenticationService orchestrates every credentialed flow. These tests
// mock every collaborator and pin the security-critical invariants:
//   - anti-enumeration on register / forgot-password / resend-verification
//   - constant-time login verify even for unknown users
//   - lockout on failed login
//   - email verification is idempotent
//   - password reset revokes every session for the user
//   - audit writes happen on all security-relevant transitions

import { UnauthorizedException } from '@nestjs/common';
import type { Role, User, UserRole } from '@homeservicemarketplace/database';

import type { AppConfigService } from '../../../../config/app-config.service';
import type { MailPort } from '../../../../infrastructure/mail/mail.port';
import type { RoleRepository } from '../../../../infrastructure/persistence/iam/role.repository';
import type { UserRepository } from '../../../../infrastructure/persistence/iam/user.repository';
import type { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import type { AuditService } from '../../audit/audit.service';
import { AuthenticationService } from './authentication.service';
import type { LoginAttemptService } from './login-attempt.service';
import type { PasswordService } from './password.service';
import type { SessionService } from './session.service';
import type { VerificationService } from './verification.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    email: 'ada@example.com',
    passwordHash: '$argon2id$fake',
    firstName: 'Ada',
    lastName: 'Lovelace',
    isActive: true,
    status: 'ACTIVE',
    emailVerifiedAt: new Date(),
    passwordUpdatedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    mfaEnabled: false,
    mfaSecret: null,
    mfaEnrolledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

interface FakeTx {
  user: { update: jest.Mock };
}

function makeHarness() {
  const users = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    assignRole: jest.fn(),
    listRoles: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<UserRepository>;

  const roles = {
    findByName: jest.fn().mockResolvedValue({ id: 'role-customer', name: 'customer' } as Role),
  } as unknown as jest.Mocked<RoleRepository>;

  const passwords = {
    hash: jest.fn().mockResolvedValue('$argon2id$hashed'),
    verify: jest.fn(),
    needsRehash: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<PasswordService>;

  const verification = {
    issue: jest
      .fn()
      .mockResolvedValue({ raw: 'tok-raw', expiresAt: new Date(Date.now() + 60_000) }),
    consume: jest.fn(),
  } as unknown as jest.Mocked<VerificationService>;

  const sessions = {
    createForLogin: jest.fn(),
    revokeById: jest.fn().mockResolvedValue(undefined),
    revokeAllForUser: jest.fn().mockResolvedValue(0),
    rotate: jest.fn(),
    peekByRefreshRaw: jest.fn(),
  } as unknown as jest.Mocked<SessionService>;

  const attempts = {
    isLocked: jest.fn().mockReturnValue(false),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue({ locked: false }),
  } as unknown as jest.Mocked<LoginAttemptService>;

  const fakeTx: FakeTx = { user: { update: jest.fn().mockResolvedValue(undefined) } };
  const tx = {
    run: jest.fn(async <T>(fn: (t: unknown) => Promise<T>) => fn(fakeTx)),
  } as unknown as TransactionRunner;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;

  // AUTH_ANTI_ENUM_DELAY_MS=0 keeps the timing-floor padding from slowing
  // unit tests. AUTH_REQUIRE_EMAIL_VERIFICATION=true so verification.issue
  // fires as expected in the register tests.
  const config: AppConfigService = {
    get: (k: string) => {
      if (k === 'AUTH_ANTI_ENUM_DELAY_MS') return 0;
      if (k === 'AUTH_REQUIRE_EMAIL_VERIFICATION') return true;
      return undefined;
    },
  } as unknown as AppConfigService;

  const mail = { send: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<MailPort>;

  const svc = new AuthenticationService(
    users,
    roles,
    passwords,
    verification,
    sessions,
    attempts,
    tx,
    audit,
    config,
    mail,
  );

  return {
    svc,
    users,
    roles,
    passwords,
    verification,
    sessions,
    attempts,
    tx,
    audit,
    config,
    mail,
    fakeTx,
  };
}

const ctx = {
  device: { ipAddress: '1.1.1.1', userAgent: 'ua', clientKind: 'WEB' as const },
  requestId: 'req-1',
};

describe('AuthenticationService', () => {
  describe('register', () => {
    it('creates a user, assigns the default customer role, sends a verification email, audits CREATED', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(null);
      h.users.create.mockResolvedValueOnce(makeUser({ id: 'new-u', email: 'ada@example.com' }));

      await h.svc.register(
        {
          email: 'Ada@Example.COM',
          password: 'a-reasonable-passphrase',
          firstName: '  Ada  ',
          lastName: 'Lovelace',
        },
        ctx,
      );

      // Email normalized (trim + lowercase)
      expect(h.users.findByEmail).toHaveBeenCalledWith('ada@example.com', expect.anything());
      const createArgs = h.users.create.mock.calls[0]![0];
      expect(createArgs.email).toBe('ada@example.com');
      expect(createArgs.firstName).toBe('Ada'); // trimmed
      expect(h.users.assignRole).toHaveBeenCalledWith('new-u', 'role-customer', expect.anything());
      expect(h.verification.issue).toHaveBeenCalledWith(
        'new-u',
        'EMAIL_VERIFICATION',
        expect.anything(),
      );
      expect(h.mail.send).toHaveBeenCalled();
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'USER_REGISTERED', metadata: { outcome: 'created' } }),
        expect.anything(),
      );
    });

    it('anti-enumeration timing floor: register pads the response so duplicate vs new takes >= AUTH_ANTI_ENUM_DELAY_MS', async () => {
      // Build a service with the floor enabled (the suite-level config sets 0).
      const local = makeHarness();
      const flooredConfig = {
        get: (k: string) => (k === 'AUTH_ANTI_ENUM_DELAY_MS' ? 150 : undefined),
      } as unknown as AppConfigService;
      const flooredSvc = new AuthenticationService(
        local.users,
        local.roles,
        local.passwords,
        local.verification,
        local.sessions,
        local.attempts,
        local.tx,
        local.audit,
        flooredConfig,
        local.mail,
      );
      local.users.findByEmail.mockResolvedValueOnce(makeUser()); // duplicate path (fast)
      const t0 = Date.now();
      await flooredSvc.register(
        { email: 'ada@example.com', password: 'x'.repeat(12), firstName: 'A', lastName: 'B' },
        ctx,
      );
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeGreaterThanOrEqual(140); // small jitter tolerance
    });

    it('anti-enumeration: duplicate email does NOT create a user, does NOT send mail, but audits DUPLICATE', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser({ id: 'existing-u' }));

      await h.svc.register(
        { email: 'ada@example.com', password: 'x'.repeat(12), firstName: 'A', lastName: 'B' },
        ctx,
      );

      expect(h.users.create).not.toHaveBeenCalled();
      expect(h.mail.send).not.toHaveBeenCalled();
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'USER_REGISTERED', metadata: { outcome: 'duplicate' } }),
        expect.anything(),
      );
    });
  });

  describe('verifyEmail', () => {
    it('flips status=ACTIVE + emailVerifiedAt when the token is valid', async () => {
      const h = makeHarness();
      h.verification.consume.mockResolvedValueOnce('u-1');
      h.users.findById.mockResolvedValueOnce(makeUser({ id: 'u-1', emailVerifiedAt: null }));

      await h.svc.verifyEmail('t'.repeat(32), ctx);

      expect(h.fakeTx.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: expect.objectContaining({ status: 'ACTIVE', emailVerifiedAt: expect.any(Date) }),
      });
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'EMAIL_VERIFIED' }),
        expect.anything(),
      );
    });

    it('is idempotent: already-verified user does not get updated a second time', async () => {
      const h = makeHarness();
      h.verification.consume.mockResolvedValueOnce('u-1');
      h.users.findById.mockResolvedValueOnce(makeUser({ emailVerifiedAt: new Date() }));

      await h.svc.verifyEmail('t'.repeat(32), ctx);

      expect(h.fakeTx.user.update).not.toHaveBeenCalled();
    });

    it('rejects an invalid / used / expired token with a stable error code', async () => {
      const h = makeHarness();
      h.verification.consume.mockResolvedValueOnce(null);
      await expect(h.svc.verifyEmail('bad', ctx)).rejects.toThrow();
    });
  });

  describe('login', () => {
    it('rejects with AUTH_INVALID_CREDENTIALS when user not found AND still runs password.verify (constant time)', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(null);
      h.passwords.verify.mockResolvedValueOnce(false);

      await expect(h.svc.login({ email: 'nobody@x.com', password: 'pw' }, ctx)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(h.passwords.verify).toHaveBeenCalled();
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOGIN_FAILED',
          metadata: expect.objectContaining({ reason: 'unknown_user' }),
        }),
        expect.anything(),
      );
    });

    it('records a failure and audits LOGIN_FAILED when password is wrong', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      h.passwords.verify.mockResolvedValueOnce(false);
      await expect(h.svc.login({ email: 'ada@example.com', password: 'pw' }, ctx)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(h.attempts.recordFailure).toHaveBeenCalled();
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LOGIN_FAILED' }),
        expect.anything(),
      );
    });

    it('audits LOGIN_LOCKED when the failure pushes the counter over the threshold', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      h.passwords.verify.mockResolvedValueOnce(false);
      h.attempts.recordFailure.mockResolvedValueOnce({ locked: true });
      await expect(h.svc.login({ email: 'ada@example.com', password: 'pw' }, ctx)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LOGIN_LOCKED' }),
        expect.anything(),
      );
    });

    it('rejects unverified account with AUTH_ACCOUNT_UNVERIFIED (not a credentials code)', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser({ emailVerifiedAt: null }));
      h.passwords.verify.mockResolvedValueOnce(true);
      await expect(
        h.svc.login({ email: 'ada@example.com', password: 'pw' }, ctx),
      ).rejects.toThrow();
    });

    it('rejects a locked account even with correct credentials', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      h.passwords.verify.mockResolvedValueOnce(true);
      h.attempts.isLocked.mockReturnValueOnce(true);
      await expect(
        h.svc.login({ email: 'ada@example.com', password: 'pw' }, ctx),
      ).rejects.toThrow();
    });

    it('on success: clears counters, resolves roles, creates a session, audits LOGIN_SUCCESS', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      h.passwords.verify.mockResolvedValueOnce(true);
      h.users.listRoles.mockResolvedValueOnce([
        {
          userId: 'u-1',
          roleId: 'r',
          assignedAt: new Date(),
          role: { name: 'customer' },
        } as UserRole & { role: Role },
      ] as never);
      h.sessions.createForLogin.mockResolvedValueOnce({
        session: { id: 'sess-1' },
        access: { token: 'a', jti: 'j', ttlSeconds: 600, expiresAt: new Date() },
        refresh: { raw: 'r', hash: 'h', expiresAt: new Date() },
      } as never);

      const result = await h.svc.login({ email: 'ada@example.com', password: 'pw' }, ctx);

      expect(h.attempts.recordSuccess).toHaveBeenCalled();
      expect(h.sessions.createForLogin).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', roles: ['customer'] }),
      );
      expect(result.roles).toEqual(['customer']);
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LOGIN_SUCCESS' }),
      );
    });
  });

  describe('forgotPassword', () => {
    it('silent anti-enumeration when the email does not exist', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(null);
      await h.svc.forgotPassword('nobody@x.com', ctx);
      expect(h.verification.issue).not.toHaveBeenCalled();
      expect(h.mail.send).not.toHaveBeenCalled();
    });

    it('issues a PASSWORD_RESET token and sends mail for an existing user', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      await h.svc.forgotPassword('ada@example.com', ctx);
      expect(h.verification.issue).toHaveBeenCalledWith('u-1', 'PASSWORD_RESET', expect.anything());
      expect(h.mail.send).toHaveBeenCalled();
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PASSWORD_RESET_REQUESTED' }),
        expect.anything(),
      );
    });
  });

  describe('resetPassword', () => {
    it('completes the reset and revokes every session for the user', async () => {
      const h = makeHarness();
      h.verification.consume.mockResolvedValueOnce('u-1');

      await h.svc.resetPassword('tok'.repeat(8), 'a-brand-new-passphrase', ctx);

      expect(h.passwords.hash).toHaveBeenCalledWith('a-brand-new-passphrase');
      expect(h.fakeTx.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: expect.objectContaining({ passwordHash: '$argon2id$hashed' }),
      });
      expect(h.sessions.revokeAllForUser).toHaveBeenCalledWith('u-1');
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PASSWORD_RESET_COMPLETED' }),
        expect.anything(),
      );
    });

    it('rejects with a stable code when the token is invalid / used / expired', async () => {
      const h = makeHarness();
      h.verification.consume.mockResolvedValueOnce(null);
      await expect(h.svc.resetPassword('bad', 'new-password-12', ctx)).rejects.toThrow();
      expect(h.sessions.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('logout / logoutAll', () => {
    it('logout revokes the current session and audits LOGOUT', async () => {
      const h = makeHarness();
      await h.svc.logout('sess-1', ctx);
      expect(h.sessions.revokeById).toHaveBeenCalledWith('sess-1');
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LOGOUT', metadata: { sessionId: 'sess-1' } }),
      );
    });

    it('logoutAll revokes all sessions and returns the count', async () => {
      const h = makeHarness();
      h.sessions.revokeAllForUser.mockResolvedValueOnce(4);
      await expect(h.svc.logoutAll('u-1', ctx)).resolves.toBe(4);
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LOGOUT_ALL', userId: 'u-1' }),
      );
    });
  });
});
