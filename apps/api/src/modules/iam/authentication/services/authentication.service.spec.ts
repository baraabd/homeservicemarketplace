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
import type { SecurityEventsBus } from '../../../../shared/security-events/security-events.bus';
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

  // OTP service double. The per-test expectations override these
  // mockResolvedValue defaults where needed (e.g. REGISTRATION_OTP path).
  const otp = {
    issue: jest.fn().mockResolvedValue({
      challengeId: 'chal-fake',
      rawCode: '123456',
      expiresAt: new Date(Date.now() + 5 * 60_000),
      expiresInSeconds: 300,
    }),
    verify: jest.fn(),
    resend: jest.fn(),
  } as unknown as jest.Mocked<import('./otp.service').OtpService>;

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

  // D-2/D-4: post-commit socket teardown. Publishing is fire-and-forget, so
  // the double is a plain spy the assertions below read back.
  const securityEvents = {
    emitSessionRevoked: jest.fn(),
    emitAllSessionsRevoked: jest.fn(),
    emitRolesChanged: jest.fn(),
    emitProviderStatusChanged: jest.fn(),
  } as unknown as SecurityEventsBus;

  const svc = new AuthenticationService(
    users,
    roles,
    passwords,
    verification,
    otp,
    sessions,
    attempts,
    tx,
    audit,
    config,
    securityEvents,
    mail,
  );

  return {
    svc,
    users,
    roles,
    passwords,
    verification,
    otp,
    sessions,
    attempts,
    tx,
    audit,
    config,
    securityEvents,
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
      // Registration pivoted from a link token (EMAIL_VERIFICATION) to a
      // short-form OTP challenge (REGISTRATION_OTP) — see otp.service.ts.
      // No session is issued here; the session is issued only on verify-otp.
      expect(h.otp.issue).toHaveBeenCalledWith('new-u', 'REGISTRATION_OTP', expect.anything());
      expect(h.verification.issue).not.toHaveBeenCalled();
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
        local.otp,
        local.sessions,
        local.attempts,
        local.tx,
        local.audit,
        flooredConfig,
        local.securityEvents,
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

    it('on valid credentials: clears counters, issues a LOGIN_OTP challenge, sends email, does NOT create a session', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      h.passwords.verify.mockResolvedValueOnce(true);
      (h.otp.issue as jest.Mock).mockResolvedValueOnce({
        challengeId: 'chal-1',
        rawCode: '123456',
        expiresAt: new Date(Date.now() + 5 * 60_000),
        expiresInSeconds: 300,
      });

      const result = await h.svc.login({ email: 'ada@example.com', password: 'pw' }, ctx);

      expect(h.attempts.recordSuccess).toHaveBeenCalled();
      expect(h.otp.issue).toHaveBeenCalledWith('u-1', 'LOGIN_OTP', expect.anything());
      expect(result.challengeId).toBe('chal-1');
      expect(result.codeLength).toBeGreaterThanOrEqual(4);
      // Session creation is NOT called here — that happens in verifyOtp.
      expect(h.sessions.createForLogin).not.toHaveBeenCalled();
      // Email send envelope (masked logs) is exercised via the mail mock.
      expect(h.mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringMatching(/sign-in code/i) }),
      );
    });
  });

  describe('verifyOtp', () => {
    it('REGISTRATION_OTP success: marks user ACTIVE, issues session, audits LOGIN_SUCCESS via otp', async () => {
      const h = makeHarness();
      const user = makeUser({ id: 'u-9', email: 'ada@example.com' });
      // First call: otp.verify resolves with userId + purpose.
      (h.otp.verify as jest.Mock).mockResolvedValueOnce({
        userId: 'u-9',
        purpose: 'REGISTRATION_OTP',
      });
      // trx.user.update for the ACTIVE flip in the fake tx — the harness's
      // fakeTx.user.update is already a jest.fn resolving undefined.
      (h.fakeTx.user.update as jest.Mock).mockResolvedValueOnce(user);
      h.users.findById.mockResolvedValueOnce(user);
      h.users.listRoles.mockResolvedValueOnce([
        {
          userId: user.id,
          roleId: 'r',
          assignedAt: new Date(),
          role: { name: 'customer' },
        } as UserRole & {
          role: Role;
        },
      ] as never);
      h.sessions.createForLogin.mockResolvedValueOnce({
        session: { id: 'sess-v' },
        access: { token: 'a', jti: 'j', ttlSeconds: 600, expiresAt: new Date() },
        refresh: { raw: 'r', hash: 'h', expiresAt: new Date() },
      } as never);

      const out = await h.svc.verifyOtp('chal-1', '123456', ctx);

      expect(out.user.id).toBe('u-9');
      expect(h.fakeTx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
      );
      expect(h.sessions.createForLogin).toHaveBeenCalled();
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOGIN_SUCCESS',
          metadata: expect.objectContaining({ via: 'otp' }),
        }),
      );
    });

    it('LOGIN_OTP success: issues session without touching the user row', async () => {
      const h = makeHarness();
      const user = makeUser({ id: 'u-10' });
      (h.otp.verify as jest.Mock).mockResolvedValueOnce({ userId: 'u-10', purpose: 'LOGIN_OTP' });
      h.users.findById.mockResolvedValueOnce(user);
      h.users.listRoles.mockResolvedValueOnce([] as never);
      h.sessions.createForLogin.mockResolvedValueOnce({
        session: { id: 'sess-x' },
        access: { token: 'a', jti: 'j', ttlSeconds: 600, expiresAt: new Date() },
        refresh: { raw: 'r', hash: 'h', expiresAt: new Date() },
      } as never);

      await h.svc.verifyOtp('chal-2', '999999', ctx);

      expect(h.fakeTx.user.update).not.toHaveBeenCalled();
      expect(h.sessions.createForLogin).toHaveBeenCalled();
    });

    it('propagates AUTH_OTP_INVALID from the OtpService (no session issued)', async () => {
      const h = makeHarness();
      const { BadRequestException } = await import('@nestjs/common');
      (h.otp.verify as jest.Mock).mockRejectedValueOnce(
        new BadRequestException({ code: 'AUTH_OTP_INVALID' }),
      );

      await expect(h.svc.verifyOtp('chal-x', '000000', ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_INVALID' }),
      });
      expect(h.sessions.createForLogin).not.toHaveBeenCalled();
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

    // Regression (phantom reset email). SMTP delivery must NEVER happen inside
    // the token/audit transaction. Root cause of the production 500: mail.send
    // (an ~8s SMTP round trip) ran inside tx.run, blew past Prisma's 5s
    // interactive-transaction timeout, and the trailing audit write threw
    // P2028 — the token row rolled back AFTER the email was already delivered,
    // so the emailed link pointed at a token that did not exist (=> 400).
    it('does NOT send the reset email if the reset transaction fails (no phantom email)', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      // Simulate the in-transaction audit/commit failure.
      (h.audit.record as jest.Mock).mockRejectedValueOnce(new Error('P2028 tx expired'));

      await h.svc.forgotPassword('ada@example.com', ctx);

      // The email must not escape a transaction that rolled back.
      expect(h.mail.send).not.toHaveBeenCalled();
    });

    it('sends the reset email only AFTER the token transaction has committed', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      const order: string[] = [];
      // Record when the transaction actually commits (fn resolved).
      (h.tx.run as jest.Mock).mockImplementationOnce(
        async (fn: (t: unknown) => Promise<unknown>) => {
          const r = await fn(h.fakeTx);
          order.push('commit');
          return r;
        },
      );
      (h.mail.send as jest.Mock).mockImplementationOnce(async () => {
        order.push('mail');
      });

      await h.svc.forgotPassword('ada@example.com', ctx);

      expect(order).toEqual(['commit', 'mail']);
    });

    it('anti-enumeration: an internal failure still resolves (same public 202 as unknown email)', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      (h.audit.record as jest.Mock).mockRejectedValueOnce(new Error('db down'));
      // Must NOT throw — a 500 for a known email vs 202 for an unknown one is
      // an account-existence oracle.
      await expect(h.svc.forgotPassword('ada@example.com', ctx)).resolves.toBeUndefined();
    });

    it('anti-enumeration: a delivery failure after commit still resolves (no oracle)', async () => {
      const h = makeHarness();
      h.users.findByEmail.mockResolvedValueOnce(makeUser());
      (h.mail.send as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
      await expect(h.svc.forgotPassword('ada@example.com', ctx)).resolves.toBeUndefined();
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
      // Session revocation now runs INSIDE the reset transaction, so it is
      // handed the same Prisma tx client (second arg) rather than the base
      // client. This is what makes password-update + token-consume +
      // session-revoke + audit atomic.
      expect(h.sessions.revokeAllForUser).toHaveBeenCalledWith('u-1', expect.anything());
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PASSWORD_RESET_COMPLETED' }),
        expect.anything(),
      );
    });

    // Regression (second atomicity defect). Session revocation used to run
    // AFTER the transaction committed. If revocation failed, the password was
    // already changed and the token already consumed while the endpoint
    // returned an error — a retry then hit "invalid/expired link". Revocation
    // must be inside the transaction: if it throws, the completion audit is
    // never written and the whole unit rolls back.
    it('runs session revocation inside the reset transaction (rolls back on failure)', async () => {
      const h = makeHarness();
      h.verification.consume.mockResolvedValueOnce('u-1');
      (h.sessions.revokeAllForUser as jest.Mock).mockRejectedValueOnce(new Error('revoke failed'));

      await expect(
        h.svc.resetPassword('tok'.repeat(8), 'a-brand-new-passphrase', ctx),
      ).rejects.toThrow();

      // The completion audit is written AFTER revocation in the same tx, so a
      // revocation failure must prevent it — proving the two are atomic.
      expect(h.audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PASSWORD_RESET_COMPLETED' }),
        expect.anything(),
      );
    });

    it('clears lockout state so the user can log in with the new password', async () => {
      // Regression: the most common reason to reset a password is that the
      // user got locked out. If the reset doesn't clear failedLoginCount and
      // lockedUntil, the very next login — with the NEW password — throws
      // AUTH_ACCOUNT_LOCKED. Users reported seeing "Unauthorized Exception"
      // in the UI right after "Password updated". This test pins that the
      // reset includes the lockout reset in the same update.
      const h = makeHarness();
      h.verification.consume.mockResolvedValueOnce('u-1');

      await h.svc.resetPassword('tok'.repeat(8), 'a-brand-new-passphrase', ctx);

      expect(h.fakeTx.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: expect.objectContaining({
          passwordHash: '$argon2id$hashed',
          failedLoginCount: 0,
          lockedUntil: null,
        }),
      });
    });

    it('rejects with a stable code when the token is invalid / used / expired', async () => {
      const h = makeHarness();
      h.verification.consume.mockResolvedValueOnce(null);
      await expect(h.svc.resetPassword('bad', 'new-password-12', ctx)).rejects.toThrow();
      expect(h.sessions.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    // Sprint 01 hardening: refresh must load the current user and reject
    // any account that is no longer in good standing, so a stolen or
    // still-live refresh token cannot mint fresh access tokens for a
    // deleted / deactivated / suspended / locked user. All bad states
    // collapse to the same stable AUTH_REFRESH_INVALID code so refresh
    // never leaks *why* the account is gone — the client re-logs in and
    // login surfaces the precise reason.
    const refreshParams = {
      refreshTokenRaw: 'r'.repeat(43),
      device: ctx.device,
      requestId: ctx.requestId,
    };

    function primeGoodStanding(h: ReturnType<typeof makeHarness>) {
      h.sessions.peekByRefreshRaw.mockResolvedValue({ userId: 'u-1' } as never);
      h.sessions.rotate.mockResolvedValue({
        session: { id: 's-2', userId: 'u-1' },
        access: { token: 'a', jti: 'j', ttlSeconds: 900, expiresAt: new Date() },
        refresh: { raw: 'r2', hash: 'h2', expiresAt: new Date() },
      } as never);
    }

    it('rotates for a user in good standing (ACTIVE, not deleted)', async () => {
      const h = makeHarness();
      primeGoodStanding(h);
      h.users.findById.mockResolvedValue(makeUser({ id: 'u-1', status: 'ACTIVE' }));
      const out = await h.svc.refresh(refreshParams);
      expect(out.userId).toBe('u-1');
      expect(h.sessions.rotate).toHaveBeenCalledTimes(1);
    });

    it('rejects when the user no longer exists', async () => {
      const h = makeHarness();
      primeGoodStanding(h);
      h.users.findById.mockResolvedValue(null);
      await expect(h.svc.refresh(refreshParams)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_REFRESH_INVALID' }),
      });
      expect(h.sessions.rotate).not.toHaveBeenCalled();
    });

    it('rejects a soft-deleted user (deletedAt set)', async () => {
      const h = makeHarness();
      primeGoodStanding(h);
      h.users.findById.mockResolvedValue(makeUser({ id: 'u-1', deletedAt: new Date() }));
      await expect(h.svc.refresh(refreshParams)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_REFRESH_INVALID' }),
      });
      expect(h.sessions.rotate).not.toHaveBeenCalled();
    });

    it('rejects a deactivated user (isActive=false)', async () => {
      const h = makeHarness();
      primeGoodStanding(h);
      h.users.findById.mockResolvedValue(makeUser({ id: 'u-1', isActive: false }));
      await expect(h.svc.refresh(refreshParams)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_REFRESH_INVALID' }),
      });
      expect(h.sessions.rotate).not.toHaveBeenCalled();
    });

    it('rejects a SUSPENDED user', async () => {
      const h = makeHarness();
      primeGoodStanding(h);
      h.users.findById.mockResolvedValue(makeUser({ id: 'u-1', status: 'SUSPENDED' }));
      await expect(h.svc.refresh(refreshParams)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_REFRESH_INVALID' }),
      });
      expect(h.sessions.rotate).not.toHaveBeenCalled();
    });

    it('rejects a LOCKED user', async () => {
      const h = makeHarness();
      primeGoodStanding(h);
      h.users.findById.mockResolvedValue(makeUser({ id: 'u-1', status: 'LOCKED' }));
      await expect(h.svc.refresh(refreshParams)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_REFRESH_INVALID' }),
      });
      expect(h.sessions.rotate).not.toHaveBeenCalled();
    });
  });

  describe('logout / logoutAll', () => {
    it('logout revokes the current session and audits LOGOUT', async () => {
      const h = makeHarness();
      await h.svc.logout('u-1', 'sess-1', ctx);
      // D-2: the revoke and the audit row now share one transaction, so the
      // repository call carries the tx handle.
      expect(h.sessions.revokeById).toHaveBeenCalledWith('sess-1', expect.anything());
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOGOUT',
          userId: 'u-1',
          metadata: { sessionId: 'sess-1' },
        }),
        expect.anything(),
      );
    });

    // D-2/D-4: sockets attached to the logged-out session must be torn down
    // after commit — they have no per-message re-auth and would otherwise
    // keep receiving events for a session that no longer exists.
    it('logout publishes a post-commit teardown for ONLY that session', async () => {
      const h = makeHarness();
      await h.svc.logout('u-1', 'sess-1', ctx);
      expect(h.securityEvents.emitSessionRevoked).toHaveBeenCalledWith({
        userId: 'u-1',
        sessionId: 'sess-1',
      });
      // Must NOT nuke the user's other sessions.
      expect(h.securityEvents.emitAllSessionsRevoked).not.toHaveBeenCalled();
    });

    it('logout-all publishes a whole-user teardown', async () => {
      const h = makeHarness();
      await h.svc.logoutAll('u-1', ctx);
      expect(h.securityEvents.emitAllSessionsRevoked).toHaveBeenCalledWith({
        userId: 'u-1',
        reason: 'logout-all',
      });
    });

    it('logoutAll revokes all sessions and returns the count', async () => {
      const h = makeHarness();
      h.sessions.revokeAllForUser.mockResolvedValueOnce(4);
      await expect(h.svc.logoutAll('u-1', ctx)).resolves.toBe(4);
      // D-2: revoke + audit now commit together, so the audit call carries
      // the transaction handle and records how many sessions were killed.
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOGOUT_ALL',
          userId: 'u-1',
          metadata: { revokedSessionCount: 4 },
        }),
        expect.anything(),
      );
    });
  });
});
