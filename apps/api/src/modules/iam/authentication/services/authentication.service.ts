import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { User } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../../config/app-config.service';
import { MAIL_PORT, MailPort } from '../../../../infrastructure/mail/mail.port';
import { RoleRepository } from '../../../../infrastructure/persistence/iam/role.repository';
import { UserRepository } from '../../../../infrastructure/persistence/iam/user.repository';
import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import { AuditService } from '../../audit/audit.service';
import { LoginAttemptService } from './login-attempt.service';
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

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly passwords: PasswordService,
    private readonly verification: VerificationService,
    private readonly sessions: SessionService,
    private readonly attempts: LoginAttemptService,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  // --- Registration -------------------------------------------------------
  // Always returns without leaking whether the address existed. A real email
  // is sent in either case (new user: verification link; existing user:
  // "someone tried to register with your email" — future phase). For now,
  // existing-email registration is silently accepted at the API layer and
  // no duplicate user is created.
  async register(input: RegistrationInput, ctx: ClientContext): Promise<void> {
    const startedAt = Date.now();
    const email = normalizeEmail(input.email);

    try {
      await this.tx.run(async (trx) => {
        const existing = await this.users.findByEmail(email, trx);
        if (existing) {
          // Anti-enumeration: do nothing user-visible different; skip token
          // issue. An audit row still fires for security telemetry.
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
          return;
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
        // Seed the default 'customer' role for every new registration.
        const customer = await this.roles.findByName('customer', trx);
        if (customer) {
          await this.users.assignRole(user.id, customer.id, trx);
        }

        const requireVerification = this.config.get('AUTH_REQUIRE_EMAIL_VERIFICATION');
        if (requireVerification) {
          const token = await this.verification.issue(user.id, 'EMAIL_VERIFICATION', trx);
          await this.sendVerificationEmail(user.email, token.raw);
        } else {
          // Dev/QA shortcut: auto-verify so login works immediately without a
          // mail provider. The flag MUST be true in production.
          await trx.user.update({
            where: { id: user.id },
            data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
          });
        }

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
      });
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

  // --- Login --------------------------------------------------------------
  async login(input: LoginInput, ctx: ClientContext): Promise<LoginResult> {
    const email = normalizeEmail(input.email);

    const result = await this.tx.run(async (trx) => {
      const user = await this.users.findByEmail(email, trx);

      // Constant-time: run verify even if user is null.
      const passwordOk = await this.passwords.verify(user?.passwordHash ?? null, input.password);

      if (!user || !passwordOk) {
        if (user) {
          const { locked } = await this.attempts.recordFailure(user.id, trx);
          await this.audit.record(
            {
              type: locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
              userId: user.id,
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

      if (user.deletedAt) throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      if (user.status === 'SUSPENDED')
        throw new ForbiddenException({ code: 'AUTH_ACCOUNT_SUSPENDED' });
      if (this.attempts.isLocked(user))
        throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_LOCKED' });
      if (!user.emailVerifiedAt) throw new ForbiddenException({ code: 'AUTH_ACCOUNT_UNVERIFIED' });

      await this.attempts.recordSuccess(user.id, trx);

      const roleRows = await this.users.listRoles(user.id, trx);
      const roles = roleRows.map((r) => r.role.name);
      return { user, roles };
    });

    const issued = await this.sessions.createForLogin({
      userId: result.user.id,
      roles: result.roles,
      device: ctx.device,
      requestId: ctx.requestId,
    });

    await this.audit.record({
      type: 'LOGIN_SUCCESS',
      userId: result.user.id,
      ipAddress: ctx.device.ipAddress,
      userAgent: ctx.device.userAgent,
      requestId: ctx.requestId,
      metadata: { sessionId: issued.session.id },
    });

    return { user: result.user, roles: result.roles, issued };
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
