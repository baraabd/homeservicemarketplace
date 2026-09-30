import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { lockAuthAccount } from '../../../../infrastructure/persistence/iam/auth-account-lock';
import type { User } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../../config/app-config.service';
import { MAIL_PORT, MailPort } from '../../../../infrastructure/mail/mail.port';
import { RoleRepository } from '../../../../infrastructure/persistence/iam/role.repository';
import { UserRepository } from '../../../../infrastructure/persistence/iam/user.repository';
import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import { SecurityEventsBus } from '../../../../shared/security-events/security-events.bus';
import { AuditService } from '../../audit/audit.service';
import { isInGoodStanding } from '../helpers/account-standing';
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
  private readonly logger = new Logger(AuthenticationService.name);

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
    // D-2/D-4: post-commit notification so already-connected sockets are torn
    // down when a session dies. Publishing through a bus rather than injecting
    // the gateway keeps IAM free of a dependency on the realtime transport.
    private readonly securityEvents: SecurityEventsBus,
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
        try {
          await this.sendOtpEmail(result.email, result.challenge.rawCode, 'REGISTRATION_OTP');
        } catch {
          // The committed challenge remains usable through resend. Do not
          // expose account existence through a mail-provider error response.
          this.logger.error({ msg: 'registration.delivery.failed', requestId: ctx.requestId });
        }
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
    } catch (error) {
      // A concurrent registration or a reserved soft-deleted email can reach
      // the unique constraint after the initial lookup. Only that precise
      // constraint has the neutral duplicate response; other failures propagate.
      if (isDuplicateEmail(error)) return fakeOtpEnvelope();
      throw error;
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
      if (!user || user.deletedAt || !user.isActive ||
          !['PENDING_VERIFICATION', 'ACTIVE'].includes(user.status)) {
        throw new BadRequestException({ code: 'AUTH_INVALID_CREDENTIALS' });
      }
      if (user.emailVerifiedAt) return; // idempotent
      const activated = await trx.user.updateMany({
        where: { id: user.id, deletedAt: null, isActive: true, status: { in: ['PENDING_VERIFICATION', 'ACTIVE'] } },
        data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      });
      if (activated.count !== 1) throw new BadRequestException({ code: 'AUTH_INVALID_CREDENTIALS' });
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
      // Commit the token and audit before contacting SMTP. An email must not
      // escape a transaction that subsequently rolls its token back.
      const delivery = await this.tx.run(async (trx) => {
        const user = await this.users.findByEmail(normalized, trx);
        if (!user || user.emailVerifiedAt || user.deletedAt || !user.isActive ||
            !['PENDING_VERIFICATION', 'ACTIVE'].includes(user.status)) return null;
        const token = await this.verification.issue(user.id, 'EMAIL_VERIFICATION', trx);
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
        return { email: user.email, raw: token.raw };
      });
      if (delivery) await this.sendVerificationEmail(delivery.email, delivery.raw);
    } catch {
      // Keep the same public response for unknown accounts and delivery/DB
      // failures. Driver errors can contain tokens/DSNs and are not logged.
      this.logger.error({ msg: 'email-verification.resend.failed', requestId: ctx.requestId });
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

    const result = await this.tx.run(async (trx) => {
      let found = await this.users.findByEmail(email, trx);
      if (found) {
        const accountId = found.id;
        await lockAuthAccount(trx, accountId);
        found = await this.users.findByEmail(email, trx);
        // Email reassignment while waiting must not redirect the locked operation.
        if (found?.id !== accountId) found = null;
      }

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
        // Return a verdict so the failure counter and audit COMMIT. Throwing
        // here would roll back both and silently disable account lockout.
        return null;
      }

      if (found.deletedAt) throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      if (found.status === 'SUSPENDED')
        throw new ForbiddenException({ code: 'AUTH_ACCOUNT_SUSPENDED' });
      if (this.attempts.isLocked(found))
        throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_LOCKED' });
      if (!found.emailVerifiedAt) throw new ForbiddenException({ code: 'AUTH_ACCOUNT_UNVERIFIED' });
      if (!isInGoodStanding(found)) throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });

      // Credentials are valid: reset the failure counter NOW so a legitimate
      // user isn't locked out by having typed the password correctly but
      // fumbling the OTP. The session is not yet issued.
      await this.attempts.recordSuccess(found.id, trx);

      const challenge = await this.otp.issue(found.id, 'LOGIN_OTP', trx);
      await this.audit.record({
        type: 'LOGIN_FAILED', // challenge issued, not an authenticated login
        userId: found.id,
        ipAddress: ctx.device.ipAddress,
        userAgent: ctx.device.userAgent,
        requestId: ctx.requestId,
        metadata: { reason: 'otp_challenge_issued' },
      }, trx);
      return { user: found, otpChallenge: challenge };
    });

    if (!result) throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    const { user, otpChallenge } = result;
    try {
      await this.sendOtpEmail(user.email, otpChallenge.rawCode, 'LOGIN_OTP');
    } catch {
      // The challenge is committed. Keep its ID available for the resend UI;
      // this response does not claim delivery or successful authentication.
      this.logger.error({ msg: 'login.delivery.failed', requestId: ctx.requestId });
    }

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
    // Token consumption, permitted account activation, session insertion and
    // success audit are one atomic unit. A failed session/audit leaves the
    // code retryable instead of consuming it without creating a usable login.
    const result = await this.tx.run(async (trx) => {
      const verdict = await this.otp.verifyForLogin(challengeId, rawCode, trx);
      if ('rejection' in verdict) return verdict;
      const { consumed } = verdict;
      let user = await this.users.findById(consumed.userId, trx);
      if (!user || user.deletedAt || !user.isActive) {
        throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      }
      if (user.status === 'SUSPENDED') {
        throw new ForbiddenException({ code: 'AUTH_ACCOUNT_SUSPENDED' });
      }
      if (this.attempts.isLocked(user) || user.status === 'LOCKED') {
        throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_LOCKED' });
      }

      if (!['PENDING_VERIFICATION', 'ACTIVE'].includes(user.status)) {
        throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      }
      if (consumed.purpose === 'REGISTRATION_OTP') {
        // The conditional write also fences suspension/deactivation between
        // the read above and activation. Verification never grants work access.
        const activated = await trx.user.updateMany({
          where: { id: user.id, deletedAt: null, isActive: true, status: { in: ['PENDING_VERIFICATION', 'ACTIVE'] } },
          data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
        });
        if (activated.count !== 1) throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
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
        user = await this.users.findById(consumed.userId, trx);
      }
      if (!user || !user.emailVerifiedAt || !isInGoodStanding(user)) {
        throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      }
      const roleRows = await this.users.listRoles(user.id, trx);
      const roles = roleRows.map((r) => r.role.name);
      const issued = await this.sessions.createForLogin({
        userId: user.id,
        roles,
        device: ctx.device,
        requestId: ctx.requestId,
      }, trx);
      await this.audit.record({
        type: 'LOGIN_SUCCESS',
        userId: user.id,
        ipAddress: ctx.device.ipAddress,
        userAgent: ctx.device.userAgent,
        requestId: ctx.requestId,
        metadata: { sessionId: issued.session.id, via: 'otp' },
      }, trx);
      return { value: { user, roles, issued } };
    });
    // A negative OTP verdict committed its attempt counter on this connection.
    // Do not throw inside that transaction and silently discard the ceiling.
    if ('rejection' in result) throw result.rejection;
    return result.value;
  }

  // --- Resend OTP --------------------------------------------------------
  // Rotates the code behind the SAME challengeId so the client doesn't
  // lose UI context. Throttled by OTP_MAX_RESENDS on the row itself.
  async resendOtp(challengeId: string, ctx: ClientContext): Promise<{ expiresInSeconds: number }> {
    const startedAt = Date.now();
    try {
      const delivery = await this.tx.run(async (trx) => {
        const challenge = await this.otp.resend(challengeId, trx);
        const user = await this.users.findById(challenge.userId, trx);
        if (!user || user.deletedAt || !user.isActive ||
            !['PENDING_VERIFICATION', 'ACTIVE'].includes(user.status)) {
          throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
        }
        await this.audit.record({
          type: 'EMAIL_VERIFICATION_RESENT',
          userId: user.id,
          ipAddress: ctx.device.ipAddress,
          userAgent: ctx.device.userAgent,
          requestId: ctx.requestId,
          metadata: { channel: 'email-otp', purpose: challenge.purpose },
        }, trx);
        return { ...challenge, email: user.email };
      });
      try {
        await this.sendOtpEmail(delivery.email, delivery.rawCode, delivery.purpose);
      } catch {
        this.logger.error({ msg: 'otp-resend.delivery.failed', requestId: ctx.requestId });
      }
      return { expiresInSeconds: delivery.expiresInSeconds };
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

    // Sprint 01 hardening: load the current user and reject any account
    // that is no longer in good standing BEFORE minting a new access
    // token. Rotating roles alone let a still-live refresh token keep
    // issuing access tokens for a user who was since deleted,
    // deactivated, suspended, or locked. All bad states collapse to the
    // same AUTH_REFRESH_INVALID code so refresh never leaks the reason —
    // the client re-authenticates and login surfaces the precise state.
    const currentUser = await this.users.findById(peek.userId);
    if (!isInGoodStanding(currentUser)) {
      throw new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID' });
    }

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

  // Logout ends only this device's refresh lineage, not other devices. The
  // lineage lock closes a concurrent refresh/logout race. Revocation + audit
  // commit together; every affected socket is notified only after commit.
  async logout(userId: string, sessionId: string, ctx: ClientContext): Promise<void> {
    const revokedIds = await this.tx.run(async (trx) => {
      const revoked = await this.sessions.revokeById(sessionId, trx);
      await this.audit.record({
        type: 'LOGOUT', userId,
        ipAddress: ctx.device.ipAddress,
        userAgent: ctx.device.userAgent,
        requestId: ctx.requestId,
        metadata: { sessionId },
      }, trx);
      return revoked;
    });
    for (const revokedId of revokedIds) this.securityEvents.emitSessionRevoked({ userId, sessionId: revokedId });
  }

  // D-2 — logout-all kills EVERY session for the user, so every access token
  // and every refresh token the account holds is dead on the next request.
  async logoutAll(userId: string, ctx: ClientContext): Promise<number> {
    const count = await this.tx.run(async (trx) => {
      await lockAuthAccount(trx, userId);
      const revoked = await this.sessions.revokeAllForUser(userId, trx);
      await this.audit.record(
        {
          type: 'LOGOUT_ALL',
          userId,
          ipAddress: ctx.device.ipAddress,
          userAgent: ctx.device.userAgent,
          requestId: ctx.requestId,
          metadata: { revokedSessionCount: revoked },
        },
        trx,
      );
      return revoked;
    });
    this.securityEvents.emitAllSessionsRevoked({ userId, reason: 'logout-all' });
    return count;
  }

  // --- Password reset -----------------------------------------------------
  // Two hard boundaries here, both fixing production defects:
  //
  //  1. SMTP delivery happens strictly AFTER the DB transaction commits.
  //     Sending inside the transaction produced "phantom" reset emails: the
  //     ~8s SMTP round trip blew past Prisma's 5s interactive-transaction
  //     timeout, the trailing audit write threw P2028, and the token row
  //     rolled back — while the email (with a now-nonexistent token) had
  //     already been delivered. Result: forgot-password 500 + reset-password
  //     400 on the emailed link. Network I/O never belongs in a DB tx.
  //
  //  2. Anti-enumeration: known and unknown emails must return the SAME
  //     public 202. A DB or SMTP failure on the known-email path must not
  //     surface as a 500 while an unknown email returns 202 — that gap is an
  //     account-existence oracle. Internal failures are logged (redacted)
  //     and swallowed so the public contract is identical either way.
  async forgotPassword(email: string, ctx: ClientContext): Promise<void> {
    const startedAt = Date.now();
    const normalized = normalizeEmail(email);
    try {
      // Phase 1 — DB only, no external I/O. Returns the minimum delivery
      // payload (recipient + raw token) needed AFTER commit, or null for the
      // unknown-email / anti-enum path.
      const delivery = await this.tx.run(async (trx) => {
        const user = await this.users.findByEmail(normalized, trx);
        if (!user) return null; // silent anti-enum
        const token = await this.verification.issue(user.id, 'PASSWORD_RESET', trx);
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
        return { email: user.email, rawToken: token.raw };
      });

      // Phase 2 — deliver the (now committed) token out-of-transaction. A
      // delivery failure here leaves a valid committed token behind, so a
      // retry can re-send; it must not change the public response.
      if (delivery) {
        try {
          await this.sendPasswordResetEmail(delivery.email, delivery.rawToken);
        } catch {
          this.logger.error({
            msg: 'password-reset.delivery.failed',
            requestId: ctx.requestId ?? undefined,
          });
        }
      }
    } catch {
      // The DB transaction failed (e.g. Postgres unavailable). Do NOT leak
      // existence via a 500 on the known-email path — log and fall through to
      // the same 202 the unknown-email path returns.
      this.logger.error({
        msg: 'password-reset.request.failed',
        requestId: ctx.requestId ?? undefined,
      });
    } finally {
      await this.padAntiEnum(startedAt);
    }
  }

  // Token consumption, password rewrite, lockout reset, session revocation and
  // the completion audit are ONE atomic PostgreSQL transaction. Previously
  // session revocation ran after commit: if it failed, the password was
  // already changed and the token already consumed while the endpoint
  // returned an error, so a retry hit "invalid/expired link". Argon2 hashing
  // (CPU-bound, no I/O) is done before the tx opens to keep the transaction
  // short and well inside the interactive-transaction timeout.
  async resetPassword(rawToken: string, newPassword: string, ctx: ClientContext): Promise<void> {
    const newHash = await this.passwords.hash(newPassword);

    const userId = await this.tx.run(async (trx) => {
      const id = await this.verification.consume(rawToken, 'PASSWORD_RESET', trx);
      if (!id) throw new BadRequestException({ code: 'AUTH_INVALID_CREDENTIALS' });
      await trx.user.update({
        where: { id },
        data: {
          passwordHash: newHash,
          passwordUpdatedAt: new Date(),
          // A password reset is the canonical recovery path for a user who
          // got locked out of their account. Leaving `lockedUntil` /
          // `failedLoginCount` set after a successful reset means the very
          // next login with the new password throws AUTH_ACCOUNT_LOCKED —
          // the user is told "wrong password / locked" immediately after
          // the reset succeeds, which is a confusing dead-end. Clear the
          // counter so the new password genuinely unlocks the account.
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      // Revoke every outstanding session in the SAME transaction — if this
      // (or the audit below) throws, the password change and token
      // consumption roll back together, so the link stays retryable.
      await this.sessions.revokeAllForUser(id, trx);
      // Credentials proved before recovery must not create a post-reset session.
      // The account lock acquired by token consumption serializes OTP issuance,
      // OTP verification and other recovery requests with this invalidation.
      await this.verification.revokeOutstandingForUser(id, trx);
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

    // D-2/D-4 — post-commit. Every session was revoked inside the transaction
    // above, so every access AND refresh token the account held is already
    // dead for REST. This additionally tears down any live WebSocket, which
    // has no per-message re-auth and would otherwise stay attached.
    this.securityEvents.emitAllSessionsRevoked({ userId, reason: 'password-reset' });
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

function isDuplicateEmail(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002' ||
      !('meta' in error) || !error.meta || typeof error.meta !== 'object' || !('target' in error.meta)) return false;
  const target = error.meta.target;
  return Array.isArray(target) && target.length === 1 && target[0] === 'email';
}
