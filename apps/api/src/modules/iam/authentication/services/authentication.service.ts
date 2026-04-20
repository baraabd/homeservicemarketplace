import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../../config/app-config.service';
import { MAIL_PORT, MailPort } from '../../../../infrastructure/mail/mail.port';
import { RoleRepository } from '../../../../infrastructure/persistence/iam/role.repository';
import { UserRepository } from '../../../../infrastructure/persistence/iam/user.repository';
import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import { AuditService } from '../../audit/audit.service';
import { LoginAttemptService } from './login-attempt.service';
import { OTP_CODE_LENGTH, OTP_TTL_MINUTES, OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { SessionService, type DeviceMetadata, type IssuedSession } from './session.service';
import { VerificationService } from './verification.service';

export interface RegistrationInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ClientContext {
  device: DeviceMetadata;
  requestId: string | null;
}

export interface LoginResult {
  user: User;
  roles: string[];
  issued: IssuedSession;
}

// Shape returned by register()/login() when OTP gating is in effect and the
// endpoint produced a challenge to the client. The caller (controller) then
// serialises this to the OtpChallengeResponse DTO.
export interface OtpChallengeIssuance {
  challengeId: string;
  expiresInSeconds: number;
  codeLength: number;
}

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly passwords: PasswordService,
    private readonly verification: VerificationService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptService,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  // --- Registration -------------------------------------------------------
  // Always returns an OTP challenge envelope. The challengeId is opaque
  // (cryptographic random) in BOTH the real and the duplicate-email path —
  // an attacker cannot distinguish the two from the response alone. Only
  // the new-user path actually issues a DB row and sends email. The duplicate
  // path returns a fake challengeId that will never verify (just like a
  // wrong code), and no email is sent.
  //
  // The user is NOT marked ACTIVE at this step — that only happens when the
  // REGISTRATION_OTP is successfully consumed at /verify-otp, which ALSO
  // issues the session cookies. Registration alone never produces an
  // authenticated session.
  async register(input: RegistrationInput, ctx: ClientContext): Promise<OtpChallengeIssuance> {
    const startedAt = Date.now();
    const email = normalizeEmail(input.email);
    const requireVerification = this.config.get('AUTH_REQUIRE_EMAIL_VERIFICATION');

    try {
      const result = await this.tx.run(async (trx) => {
        const existing = await this.users.findByEmail(email, trx);
        if (existing) {
          await this.audit.record(
            {
              type: 'USER_REGISTERED',
              userId: existing.id,
              ipAddress: ctx.device.ipAddress,
              userAgent: ctx.device.userAgent,
              requestId: ctx.requestId,
              metadata: { outcome: 'duplicate' },
            },
            trx,
          );
          return null; // duplicate — fall through to fake envelope
        }

        const passwordHash = await this.passwords.hash(input.password);
        const user = await this.users.create(
          {
            email,
            passwordHash,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
          },
          trx,
        );
        const customer = await this.roles.findByName('customer', trx);
        if (customer) {
          await this.users.assignRole(user.id, customer.id, trx);
        }

        if (!requireVerification) {
          // Dev/QA shortcut — bypass the OTP round-trip entirely. The flag
          // MUST be true in production; see env.schema.ts.
          await trx.user.update({
            where: { id: user.id },
            data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
          });
          await this.audit.record(
            {
              type: 'USER_REGISTERED',
              userId: user.id,
              ipAddress: ctx.device.ipAddress,
              userAgent: ctx.device.userAgent,
              requestId: ctx.requestId,
              metadata: { outcome: 'created-autoverified' },
            },
            trx,
          );
          return null;
        }

        const challenge = await this.otp.issue(user.id, 'REGISTRATION_OTP', trx);
        await this.audit.record(
          {
            type: 'USER_REGISTERED',
            userId: user.id,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
            metadata: { outcome: 'created' },
          },
          trx,
        );
        return { challenge, email: user.email };
      });

      if (result) {
        await this.sendOtpEmail(result.email, result.challenge.rawCode, 'REGISTRATION_OTP');
        return {
          challengeId: result.challenge.challengeId,
          expiresInSeconds: result.challenge.expiresInSeconds,
          codeLength: OTP_CODE_LENGTH,
        };
      }

      // Either duplicate email OR dev-mode auto-verify. Return an opaque
      // challengeId that will never verify so the client UX is identical
      // to the new-user path.
      return fakeOtpEnvelope();
    } finally {
      await this.padAntiEnum(startedAt);
    }
  }

  // --- Email verification -------------------------------------------------
  async verifyEmail(rawToken: string, ctx: ClientContext): Promise<void> {
    await this.tx.run(async (trx) => {
      const userId = await this.verification.consume(rawToken, 'EMAIL_VERIFICATION', trx);
      if (!userId) throw new BadRequestException({ code: 'AUTH_INVALID_CREDENTIALS' });
      const user = await this.users.findById(userId, trx);
      if (!user) throw new BadRequestException({ code: 'AUTH_INVALID_CREDENTIALS' });
      if (user.emailVerifiedAt) return; // idempotent
      await trx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      });
      await this.audit.record(
        {
          type: 'EMAIL_VERIFIED',
          userId: user.id,
          ipAddress: ctx.device.ipAddress,
          userAgent: ctx.device.userAgent,
          requestId: ctx.requestId,
        },
        trx,
      );
    });
  }

  async resendVerification(email: string, ctx: ClientContext): Promise<void> {
    const startedAt = Date.now();
    const normalized = normalizeEmail(email);
    try {
      await this.tx.run(async (trx) => {
        const user = await this.users.findByEmail(normalized, trx);
        if (!user || user.emailVerifiedAt) return; // silent anti-enum
        const token = await this.verification.issue(user.id, 'EMAIL_VERIFICATION', trx);
        await this.sendVerificationEmail(user.email, token.raw);
        await this.audit.record(
          {
            type: 'EMAIL_VERIFICATION_RESENT',
            userId: user.id,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
          },
          trx,
        );
      });
    } finally {
      await this.padAntiEnum(startedAt);
    }
  }

  // --- Login (OTP challenge only) ---------------------------------------
  // Successful credential check produces a LOGIN_OTP challenge and returns
  // an opaque challengeId to the client. No cookies are set here, no
  // session row is created. The actual session is issued only when the
  // user successfully verifies the OTP via /v1/auth/verify-otp.
  //
  // Every credential-failure path still returns AUTH_INVALID_CREDENTIALS,
  // and lockout / suspended / unverified semantics are unchanged.
  async login(input: LoginInput, ctx: ClientContext): Promise<OtpChallengeIssuance> {
    const email = normalizeEmail(input.email);

    const { user, otpChallenge } = await this.tx.run(async (trx) => {
      const found = await this.users.findByEmail(email, trx);

      // Constant-time: run verify even if user is null.
      const passwordOk = await this.passwords.verify(found?.passwordHash ?? null, input.password);

      if (!found || !passwordOk) {
        if (found) {
          const { locked } = await this.attempts.recordFailure(found.id, trx);
          await this.audit.record(
            {
              type: locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
              userId: found.id,
              ipAddress: ctx.device.ipAddress,
              userAgent: ctx.device.userAgent,
              requestId: ctx.requestId,
            },
            trx,
          );
        } else {
          await this.audit.record(
            {
              type: 'LOGIN_FAILED',
              ipAddress: ctx.device.ipAddress,
              userAgent: ctx.device.userAgent,
              requestId: ctx.requestId,
              metadata: { reason: 'unknown_user' },
            },
            trx,
          );
        }
        throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      }

      if (found.deletedAt) throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      if (found.status === 'SUSPENDED')
        throw new ForbiddenException({ code: 'AUTH_ACCOUNT_SUSPENDED' });
      if (this.attempts.isLocked(found))
        throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_LOCKED' });
      if (!found.emailVerifiedAt) throw new ForbiddenException({ code: 'AUTH_ACCOUNT_UNVERIFIED' });

      // Credentials are valid: reset the failure counter NOW so a legitimate
      // user isn't locked out by having typed the password correctly but
      // fumbling the OTP. The session is not yet issued.
      await this.attempts.recordSuccess(found.id, trx);

      const challenge = await this.otp.issue(found.id, 'LOGIN_OTP', trx);
      return { user: found, otpChallenge: challenge };
    });

    await this.sendOtpEmail(user.email, otpChallenge.rawCode, 'LOGIN_OTP');

    // Audit: challenge created, NOT a full login success yet. Reusing the
    // LOGIN_FAILED/LOGIN_SUCCESS pair would be misleading; log a distinct
    // sub-state via metadata instead.
    await this.audit.record({
      type: 'LOGIN_FAILED', // pre-OTP, not yet authenticated
      userId: user.id,
      ipAddress: ctx.device.ipAddress,
      userAgent: ctx.device.userAgent,
      requestId: ctx.requestId,
      metadata: { reason: 'otp_challenge_issued' },
    });

    return {
      challengeId: otpChallenge.challengeId,
      expiresInSeconds: otpChallenge.expiresInSeconds,
      codeLength: OTP_CODE_LENGTH,
    };
  }

  // --- Verify OTP + issue session ---------------------------------------
  // Consumes the OTP atomically. On success, issues the real web/mobile
  // session via SessionService — identical to the old login() output so
  // the controller's shapeAuthResponse works unchanged.
  //
  // REGISTRATION_OTP success additionally marks the user ACTIVE + sets
  // emailVerifiedAt. LOGIN_OTP success has no user-row side effects.
  async verifyOtp(challengeId: string, rawCode: string, ctx: ClientContext): Promise<LoginResult> {
    const { user, roles } = await this.tx.run(async (trx) => {
      const consumed = await this.otp.verify(challengeId, rawCode, trx);

      if (consumed.purpose === 'REGISTRATION_OTP') {
        const updated = await trx.user.update({
          where: { id: consumed.userId },
          data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
        });
        await this.audit.record(
          {
            type: 'EMAIL_VERIFIED',
            userId: updated.id,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
          },
          trx,
        );
      }

      const found = await this.users.findById(consumed.userId, trx);
      if (!found || found.deletedAt) {
        throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      }
      if (found.status === 'SUSPENDED') {
        throw new ForbiddenException({ code: 'AUTH_ACCOUNT_SUSPENDED' });
      }

      const roleRows = await this.users.listRoles(found.id, trx);
      return { user: found, roles: roleRows.map((r) => r.role.name) };
    });

    const issued = await this.sessions.createForLogin({
      userId: user.id,
      roles,
      device: ctx.device,
      requestId: ctx.requestId,
    });

    await this.audit.record({
      type: 'LOGIN_SUCCESS',
      userId: user.id,
      ipAddress: ctx.device.ipAddress,
      userAgent: ctx.device.userAgent,
      requestId: ctx.requestId,
      metadata: { sessionId: issued.session.id, via: 'otp' },
    });

    return { user, roles, issued };
  }

  // --- Resend OTP --------------------------------------------------------
  // Rotates the code behind the SAME challengeId so the client doesn't
  // lose UI context. Throttled by OTP_MAX_RESENDS on the row itself.
  async resendOtp(challengeId: string, ctx: ClientContext): Promise<{ expiresInSeconds: number }> {
    const startedAt = Date.now();
    try {
      const { rawCode, userId, purpose, expiresInSeconds } = await this.tx.run((trx) =>
        this.otp.resend(challengeId, trx),
      );
      const user = await this.users.findById(userId);
      if (!user) {
        // Extremely unlikely: challenge exists but user is gone. Keep the
        // error neutral so we don't leak internal inconsistency.
        throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
      }
      await this.sendOtpEmail(user.email, rawCode, purpose);
      await this.audit.record({
        type: 'EMAIL_VERIFICATION_RESENT',
        userId: user.id,
        ipAddress: ctx.device.ipAddress,
        userAgent: ctx.device.userAgent,
        requestId: ctx.requestId,
        metadata: { channel: 'email-otp', purpose },
      });
      return { expiresInSeconds };
    } finally {
      await this.padAntiEnum(startedAt);
    }
  }

  // --- Refresh ------------------------------------------------------------
  // Two-step: peek to discover userId (so we can resolve current roles),
  // then rotate atomically with those roles baked into the new access token.
  // Roles are re-resolved on every refresh — revokes propagate within one
  // refresh cycle regardless of access-token cache state.
  async refresh(params: {
    refreshTokenRaw: string;
    device: DeviceMetadata;
    requestId: string | null;
  }): Promise<{ issued: IssuedSession; roles: string[]; userId: string }> {
    const peek = await this.sessions.peekByRefreshRaw(params.refreshTokenRaw);
    if (!peek) throw new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' });

    const roleRows = await this.users.listRoles(peek.userId);
    const roles = roleRows.map((r) => r.role.name);

    const issued = await this.sessions.rotate({
      presentedRefreshRaw: params.refreshTokenRaw,
      roles,
      device: params.device,
      requestId: params.requestId,
    });
    return { issued, roles, userId: issued.session.userId };
  }

  async logout(sessionId: string, ctx: ClientContext): Promise<void> {
    await this.sessions.revokeById(sessionId);
    await this.audit.record({
      type: 'LOGOUT',
      ipAddress: ctx.device.ipAddress,
      userAgent: ctx.device.userAgent,
      requestId: ctx.requestId,
      metadata: { sessionId },
    });
  }

  async logoutAll(userId: string, ctx: ClientContext): Promise<number> {
    const count = await this.sessions.revokeAllForUser(userId);
    await this.audit.record({
      type: 'LOGOUT_ALL',
      userId,
      ipAddress: ctx.device.ipAddress,
      userAgent: ctx.device.userAgent,
      requestId: ctx.requestId,
    });
    return count;
  }

  // --- Password reset -----------------------------------------------------
  async forgotPassword(email: string, ctx: ClientContext): Promise<void> {
    const startedAt = Date.now();
    const normalized = normalizeEmail(email);
    try {
      await this.tx.run(async (trx) => {
        const user = await this.users.findByEmail(normalized, trx);
        if (!user) return; // silent anti-enum
        const token = await this.verification.issue(user.id, 'PASSWORD_RESET', trx);
        await this.sendPasswordResetEmail(user.email, token.raw);
        await this.audit.record(
          {
            type: 'PASSWORD_RESET_REQUESTED',
            userId: user.id,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
          },
          trx,
        );
      });
    } finally {
      await this.padAntiEnum(startedAt);
    }
  }

  async resetPassword(rawToken: string, newPassword: string, ctx: ClientContext): Promise<void> {
    const userId = await this.tx.run(async (trx) => {
      const id = await this.verification.consume(rawToken, 'PASSWORD_RESET', trx);
      if (!id) throw new BadRequestException({ code: 'AUTH_INVALID_CREDENTIALS' });
      const hash = await this.passwords.hash(newPassword);
      await trx.user.update({
        where: { id },
        data: { passwordHash: hash, passwordUpdatedAt: new Date() },
      });
      await this.audit.record(
        {
          type: 'PASSWORD_RESET_COMPLETED',
          userId: id,
          ipAddress: ctx.device.ipAddress,
          userAgent: ctx.device.userAgent,
          requestId: ctx.requestId,
        },
        trx,
      );
      return id;
    });

    // Security: completing a password reset revokes every outstanding session.
    await this.sessions.revokeAllForUser(userId);
  }

  // --- Helpers ------------------------------------------------------------
  private async sendVerificationEmail(to: string, rawToken: string): Promise<void> {
    const base = this.config.get('FRONTEND_URL') ?? '';
    const link = base ? `${base}/verify-email?token=${rawToken}` : `token=${rawToken}`;
    await this.mail.send({
      to,
      subject: 'Verify your email',
      text: `Confirm your address: ${link}`,
    });
  }

  private async sendOtpEmail(
    to: string,
    rawCode: string,
    purpose: 'REGISTRATION_OTP' | 'LOGIN_OTP',
  ): Promise<void> {
    const minutes = OTP_TTL_MINUTES;
    const subject =
      purpose === 'REGISTRATION_OTP'
        ? 'Confirm your email to finish signing up'
        : 'Your sign-in code';
    const text =
      purpose === 'REGISTRATION_OTP'
        ? `Your registration code is ${rawCode}. It expires in ${minutes} minutes.`
        : `Your sign-in code is ${rawCode}. It expires in ${minutes} minutes.`;
    await this.mail.send({ to, subject, text });
  }

  private async sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
    const base = this.config.get('FRONTEND_URL') ?? '';
    const link = base ? `${base}/reset-password?token=${rawToken}` : `token=${rawToken}`;
    await this.mail.send({
      to,
      subject: 'Reset your password',
      text: `Reset link (valid briefly): ${link}`,
    });
  }

  // Sleep until the elapsed time since `startedAt` reaches the configured
  // floor. Closes the timing side-channel between the existing-user and
  // unknown-user paths in register / forgot-password / resend-verification.
  private async padAntiEnum(startedAt: number): Promise<void> {
    const floor = this.config.get('AUTH_ANTI_ENUM_DELAY_MS');
    if (!floor || floor <= 0) return;
    const remaining = floor - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  }
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Opaque challenge envelope for the duplicate-email / auto-verify paths.
// The id is cryptographically random so an attacker cannot distinguish it
// from a real one by shape, and the verify-otp endpoint will return
// AUTH_OTP_INVALID (same as any bad code) when they try to consume it.
function fakeOtpEnvelope(): OtpChallengeIssuance {
  return {
    challengeId: randomBytes(24).toString('base64url'),
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    codeLength: OTP_CODE_LENGTH,
  };
}
