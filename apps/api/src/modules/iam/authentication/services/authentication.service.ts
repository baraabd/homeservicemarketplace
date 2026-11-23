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
import type { PrismaTx, User } from '@homeservicemarketplace/database';

import { AuthChannelService } from '../../../../infrastructure/auth-channel/auth-channel.service';
import { OtpDeliveryService } from '../../../../infrastructure/auth-channel/otp-delivery.service';
import {
  contactIdentity,
  hasVerifiedContact,
  maskContact,
  ownsContact,
  type ContactIdentityInput,
} from '../helpers/contact-identity';
import { AppConfigService } from '../../../../config/app-config.service';
import { MAIL_PORT, MailPort, type MailTicket } from '../../../../infrastructure/mail/mail.port';
import { RoleRepository } from '../../../../infrastructure/persistence/iam/role.repository';
import { UserRepository } from '../../../../infrastructure/persistence/iam/user.repository';
import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../../shared/errors/app-error';
import { SecurityEventsBus } from '../../../../shared/security-events/security-events.bus';
import type { LegalAcceptanceInput } from '@homeservicemarketplace/contracts';

import { AuditService } from '../../audit/audit.service';
import { LegalAcceptanceService } from '../../legal/legal-acceptance.service';
import { isInGoodStanding } from '../helpers/account-standing';
import { isWhatsAppLoginChallenge, WHATSAPP_LOGIN_CHALLENGE_PREFIX } from '../helpers/otp-codec';
import { LoginAttemptService } from './login-attempt.service';
import {
  OTP_CODE_LENGTH,
  OTP_TTL_MINUTES,
  OtpService,
  type OtpDeliveryBinding,
  type ConsumedOtp,
} from './otp.service';
import { PasswordService } from './password.service';
import { SessionService, type DeviceMetadata, type IssuedSession } from './session.service';
import { VerificationService } from './verification.service';

export interface RegistrationInput extends ContactIdentityInput {
  password: string;
  firstName: string;
  lastName: string;
  /** K02 — exact policy versions the user accepted; validated before lookup. */
  legalAcceptance: LegalAcceptanceInput;
}

export interface LoginInput extends ContactIdentityInput {
  password?: string;
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
  channel?: 'email' | 'whatsapp';
  maskedDestination?: string;
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
    private readonly legal: LegalAcceptanceService,
    private readonly channels: AuthChannelService,
    private readonly delivery: OtpDeliveryService,
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
    const contact = contactIdentity(input);
    const requireVerification = this.config.get('AUTH_REQUIRE_EMAIL_VERIFICATION');
    // K02 — before any account lookup: a stale or closed policy version is
    // refused identically for new and existing emails.
    this.legal.assertAcceptable(input.legalAcceptance);
    if (contact.channel !== (await this.channels.getChannel()))
      throw new BadRequestException({ code: 'AUTH_CHANNEL_CHANGED' });

    try {
      // Perform the added OTP KDF once before identity lookup on both the real
      // and neutral paths; a duplicate or suppressed delivery cannot skip it.
      const prepared = requireVerification ? await this.otp.prepare() : undefined;
      const result = await this.tx.run(async (trx) => {
        const customer = await this.roles.findByName('customer', trx);
        if (!customer) {
          throw new AppError(
            'DEPENDENCY_UNAVAILABLE',
            'Registration is temporarily unavailable.',
            503,
          );
        }
        const existing = await this.findByContact(contact, trx);
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
            email: contact.channel === 'email' ? contact.destination : null,
            phoneNumber: contact.channel === 'whatsapp' ? contact.destination : null,
            passwordHash,
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
          },
          trx,
        );
        await this.legal.recordSignupAcceptance(user.id, input.legalAcceptance, trx);
        await this.users.assignRole(user.id, customer.id, trx);

        if (!requireVerification) {
          // Dev/QA shortcut — bypass the OTP round-trip entirely. The flag
          // MUST be true in production; see env.schema.ts.
          await trx.user.update({
            where: { id: user.id },
            data: { ...verifiedContactData(contact), status: 'ACTIVE' },
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

        const challenge = await this.otp.issue(user.id, 'REGISTRATION_OTP', trx, contact, prepared);
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
        // R21 — the mail intent commits with the account and challenge; a
        // rollback leaves no message behind.
        const mail = await this.delivery.enqueue(
          {
            ...contact,
            userId: user.id,
            rawCode: challenge.rawCode,
            purpose: 'REGISTRATION_OTP',
            expiresAt: challenge.expiresAt,
          },
          trx,
        );
        assertOtpTicket(mail);
        return { challenge, mail };
      });

      if (result) {
        this.dispatchAfterCommit(result.mail, ctx, 'registration');
        return {
          challengeId: result.challenge.challengeId,
          expiresInSeconds: result.challenge.expiresInSeconds,
          codeLength: OTP_CODE_LENGTH,
          channel: contact.channel,
          maskedDestination: maskContact(contact),
        };
      }

      // Either duplicate email OR dev-mode auto-verify. Return an opaque
      // challengeId that will never verify so the client UX is identical
      // to the new-user path.
      return fakeOtpEnvelope(contact);
    } catch (error) {
      // A concurrent registration or a reserved soft-deleted email can reach
      // the unique constraint after the initial lookup. Only that precise
      // constraint has the neutral duplicate response; other failures propagate.
      if (isDuplicateIdentity(error) || error instanceof OtpDeliverySuppressedError)
        return fakeOtpEnvelope(contact);
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
      if (
        !user ||
        !user.email ||
        user.deletedAt ||
        !user.isActive ||
        !['PENDING_VERIFICATION', 'ACTIVE'].includes(user.status)
      ) {
        throw new BadRequestException({ code: 'AUTH_INVALID_CREDENTIALS' });
      }
      if (user.emailVerifiedAt) return; // idempotent
      const activated = await trx.user.updateMany({
        where: {
          id: user.id,
          deletedAt: null,
          isActive: true,
          status: { in: ['PENDING_VERIFICATION', 'ACTIVE'] },
        },
        data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      });
      if (activated.count !== 1)
        throw new BadRequestException({ code: 'AUTH_INVALID_CREDENTIALS' });
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
        const user = await this.findLockedEmailAccount(normalized, trx);
        if (
          !user ||
          user.emailVerifiedAt ||
          !user.email ||
          user.deletedAt ||
          !user.isActive ||
          !['PENDING_VERIFICATION', 'ACTIVE'].includes(user.status)
        )
          return null;
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
        return this.mail.enqueue(
          {
            template: 'auth.email_verification',
            to: user.email,
            userId: user.id,
            vars: { token: token.raw },
            expiresAt: token.expiresAt,
          },
          trx,
        );
      });
      if (delivery) this.dispatchAfterCommit(delivery, ctx, 'email-verification', this.mail);
    } catch {
      // Keep the same public response for unknown accounts and delivery/DB
      // failures. Driver errors can contain tokens/DSNs and are not logged.
      this.logger.error({ msg: 'email-verification.resend.failed', requestId: ctx.requestId });
    } finally {
      await this.padAntiEnum(startedAt);
    }
  }

  // --- Login (OTP challenge only) ---------------------------------------
  // Email password proof or a passwordless WhatsApp request produces a challenge and returns
  // an opaque challengeId to the client. No cookies are set here, no
  // session row is created. The actual session is issued only when the
  // user successfully verifies the OTP via /v1/auth/verify-otp.
  //
  // Only the administrator-selected method can start a new sign-in. Existing
  // challenges keep their bound channel through their original validity window.
  async login(input: LoginInput, ctx: ClientContext): Promise<OtpChallengeIssuance> {
    const contact = contactIdentity(input);
    if (contact.channel !== (await this.channels.getChannel()))
      throw new BadRequestException({ code: 'AUTH_CHANNEL_CHANGED' });
    if (contact.channel === 'whatsapp') return this.loginByVerifiedPhone(contact, ctx);
    const password = input.password;
    if (typeof password !== 'string' || password.length < 1 || password.length > 128)
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });

    const result = await this.tx.run(async (trx) => {
      if (contact.channel !== (await this.channels.getChannel(trx)))
        throw new BadRequestException({ code: 'AUTH_CHANNEL_CHANGED' });
      let found = await this.findByContact(contact, trx);
      if (found) {
        const accountId = found.id;
        await lockAuthAccount(trx, accountId);
        found = await this.findByContact(contact, trx);
        // Email reassignment while waiting must not redirect the locked operation.
        if (found?.id !== accountId) found = null;
      }

      // Constant-time: run verify even if user is null.
      const passwordOk = await this.passwords.verify(found?.passwordHash ?? null, password);

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

      if (found.deletedAt || !found.isActive)
        throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      if (found.status === 'SUSPENDED')
        throw new ForbiddenException({ code: 'AUTH_ACCOUNT_SUSPENDED' });
      if (this.attempts.isLocked(found))
        throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_LOCKED' });
      const recoveringRegistration = found.status === 'PENDING_VERIFICATION';
      if (!recoveringRegistration && !hasVerifiedContact(found, contact))
        throw new ForbiddenException({ code: 'AUTH_ACCOUNT_UNVERIFIED' });
      if (!recoveringRegistration && !isInGoodStanding(found))
        throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });

      // Credentials are valid: reset the failure counter NOW so a legitimate
      // user isn't locked out by having typed the password correctly but
      // fumbling the OTP. The session is not yet issued.
      await this.attempts.recordSuccess(found.id, trx);

      const purpose = recoveringRegistration ? 'REGISTRATION_OTP' : 'LOGIN_OTP';
      const challenge = await this.otp.issue(found.id, purpose, trx, contact);
      await this.audit.record(
        {
          type: 'LOGIN_FAILED', // challenge issued, not an authenticated login
          userId: found.id,
          ipAddress: ctx.device.ipAddress,
          userAgent: ctx.device.userAgent,
          requestId: ctx.requestId,
          metadata: { reason: 'otp_challenge_issued' },
        },
        trx,
      );
      const mail = await this.delivery.enqueue(
        {
          ...contact,
          userId: found.id,
          rawCode: challenge.rawCode,
          purpose,
          expiresAt: challenge.expiresAt,
        },
        trx,
      );
      assertOtpTicket(mail);
      return { otpChallenge: challenge, mail, contact };
    });

    if (!result) throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    const { otpChallenge, mail, contact: issuedContact } = result;
    try {
      await this.delivery.dispatch(mail);
    } catch {
      // The challenge is committed. Keep its ID available for the resend UI;
      // this response does not claim delivery or successful authentication.
      this.logger.error({ msg: 'login.delivery.failed', requestId: ctx.requestId });
    }

    return {
      challengeId: otpChallenge.challengeId,
      expiresInSeconds: otpChallenge.expiresInSeconds,
      codeLength: OTP_CODE_LENGTH,
      channel: issuedContact.channel,
      maskedDestination: maskContact(issuedContact),
    };
  }

  /** Requesting a code is not proof of identity. Unknown and ineligible phone
   * numbers receive the same opaque envelope without creating accounts, OTPs
   * or sessions. Delivery latency never becomes an account-existence signal. */
  private async loginByVerifiedPhone(
    contact: OtpDeliveryBinding,
    ctx: ClientContext,
  ): Promise<OtpChallengeIssuance> {
    const startedAt = Date.now();
    const neutral = fakeOtpEnvelope(contact, WHATSAPP_LOGIN_CHALLENGE_PREFIX);
    try {
      const prepared = await this.otp.prepare('LOGIN_OTP', contact);
      const result = await this.tx.run(async (trx) => {
        if (contact.channel !== (await this.channels.getChannel(trx)))
          throw new BadRequestException({ code: 'AUTH_CHANNEL_CHANGED' });
        let user = await this.findByContact(contact, trx);
        if (!user) return null;
        const accountId = user.id;
        // The unique phone owner serializes challenge issuance and its recipient
        // delivery budget, including competing requests from different replicas.
        await lockAuthAccount(trx, accountId);
        user = await this.findByContact(contact, trx);
        if (
          !user ||
          user.id !== accountId ||
          !hasVerifiedContact(user, contact) ||
          !isInGoodStanding(user) ||
          this.attempts.isLocked(user)
        )
          return null;

        const challenge = await this.otp.issue(user.id, 'LOGIN_OTP', trx, contact, prepared);
        const ticket = await this.delivery.enqueue(
          {
            ...contact,
            userId: user.id,
            rawCode: challenge.rawCode,
            purpose: 'LOGIN_OTP',
            expiresAt: challenge.expiresAt,
          },
          trx,
        );
        // A suppressed request must roll back issuance/invalidation, leaving
        // the previously delivered code and its attempt counter intact.
        assertOtpTicket(ticket);
        await this.audit.record(
          {
            type: 'LOGIN_FAILED', // a challenge request is not a successful sign-in
            userId: user.id,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
            metadata: { reason: 'otp_challenge_issued', channel: 'whatsapp' },
          },
          trx,
        );
        return { challenge, ticket };
      });
      if (!result) return neutral;
      this.dispatchAfterCommit(result.ticket, ctx, 'login-otp');
      return {
        ...neutral,
        challengeId: result.challenge.challengeId,
        expiresInSeconds: result.challenge.expiresInSeconds,
      };
    } catch (error) {
      if (error instanceof OtpDeliverySuppressedError) return neutral;
      throw error;
    } finally {
      await this.padAntiEnum(startedAt);
    }
  }

  // --- Verify OTP + issue session ---------------------------------------
  // Consumes the OTP atomically. On success, issues the real web/mobile
  // session via SessionService — identical to the old login() output so
  // the controller's shapeAuthResponse works unchanged.
  //
  // REGISTRATION_OTP success additionally marks the user ACTIVE + sets
  // emailVerifiedAt. WhatsApp LOGIN_OTP success clears failed-login counters.
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
      const contact = boundContact(consumed, user);
      if (!ownsContact(user, contact)) throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
      if (consumed.purpose === 'REGISTRATION_OTP') {
        // The conditional write also fences suspension/deactivation between
        // the read above and activation. Verification never grants work access.
        const activated = await trx.user.updateMany({
          where: {
            id: user.id,
            deletedAt: null,
            isActive: true,
            status: { in: ['PENDING_VERIFICATION', 'ACTIVE'] },
          },
          data: { ...verifiedContactData(contact), status: 'ACTIVE' },
        });
        if (activated.count !== 1)
          throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
        await this.audit.record(
          {
            type: contact.channel === 'whatsapp' ? 'PHONE_VERIFIED' : 'EMAIL_VERIFIED',
            metadata: { channel: contact.channel },
            userId: user.id,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
          },
          trx,
        );
        user = await this.users.findById(consumed.userId, trx);
      }
      if (!user || !hasVerifiedContact(user, contact) || !isInGoodStanding(user)) {
        throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      }
      // A phone-only request cannot clear account lockout. The first credential
      // proof in passwordless sign-in is this atomically consumed OTP.
      if (consumed.purpose === 'LOGIN_OTP' && contact.channel === 'whatsapp')
        await this.attempts.recordSuccess(user.id, trx);
      const roleRows = await this.users.listRoles(user.id, trx);
      const roles = roleRows.map((r) => r.role.name);
      const issued = await this.sessions.createForLogin(
        {
          userId: user.id,
          roles,
          device: ctx.device,
          requestId: ctx.requestId,
        },
        trx,
      );
      await this.audit.record(
        {
          type: 'LOGIN_SUCCESS',
          userId: user.id,
          ipAddress: ctx.device.ipAddress,
          userAgent: ctx.device.userAgent,
          requestId: ctx.requestId,
          metadata: { sessionId: issued.session.id, via: 'otp' },
        },
        trx,
      );
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
        if (
          !user ||
          user.deletedAt ||
          !user.isActive ||
          !['PENDING_VERIFICATION', 'ACTIVE'].includes(user.status)
        ) {
          throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
        }
        await this.audit.record(
          {
            type: challenge.channel === 'whatsapp' ? 'OTP_RESENT' : 'EMAIL_VERIFICATION_RESENT',
            userId: user.id,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
            metadata: { channel: challenge.channel ?? 'email', purpose: challenge.purpose },
          },
          trx,
        );
        const contact = boundContact(challenge, user);
        if (
          !['PHONE_VERIFICATION_OTP', 'EMAIL_CONTACT_OTP'].includes(challenge.purpose) &&
          !ownsContact(user, contact)
        ) {
          throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
        }
        const mail = await this.delivery.enqueue(
          {
            ...contact,
            userId: user.id,
            rawCode: challenge.rawCode,
            purpose: challenge.purpose,
            expiresAt: new Date(Date.now() + challenge.expiresInSeconds * 1000),
          },
          trx,
        );
        assertOtpTicket(mail);
        return { expiresInSeconds: challenge.expiresInSeconds, mail };
      });
      if (isWhatsAppLoginChallenge(challengeId)) {
        this.dispatchAfterCommit(delivery.mail, ctx, 'otp-resend');
      } else {
        try {
          await this.delivery.dispatch(delivery.mail);
        } catch {
          this.logger.error({ msg: 'otp-resend.delivery.failed', requestId: ctx.requestId });
        }
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
      await this.audit.record(
        {
          type: 'LOGOUT',
          userId,
          ipAddress: ctx.device.ipAddress,
          userAgent: ctx.device.userAgent,
          requestId: ctx.requestId,
          metadata: { sessionId },
        },
        trx,
      );
      return revoked;
    });
    for (const revokedId of revokedIds)
      this.securityEvents.emitSessionRevoked({ userId, sessionId: revokedId });
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
      // Phase 1 — DB only, no external I/O. Records the sealed mail intent
      // with the token (R21), or returns null for the unknown-email /
      // anti-enum path.
      const delivery = await this.tx.run(async (trx) => {
        const user = await this.findLockedEmailAccount(normalized, trx);
        if (!user?.email) return null; // silent anti-enum
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
        return this.mail.enqueue(
          {
            template: 'auth.password_reset',
            to: user.email,
            userId: user.id,
            vars: { token: token.raw },
            expiresAt: token.expiresAt,
          },
          trx,
        );
      });

      // Phase 2 — first delivery attempt for the (now committed) intent,
      // out-of-transaction. A failure leaves it queued for the dispatcher; it
      // must not change the public response.
      if (delivery) this.dispatchAfterCommit(delivery, ctx, 'password-reset', this.mail);
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
      await this.applyPasswordReset(id, newHash, ctx, trx);
      return id;
    });

    // D-2/D-4 — post-commit. Every session was revoked inside the transaction
    // above, so every access AND refresh token the account held is already
    // dead for REST. This additionally tears down any live WebSocket, which
    // has no per-message re-auth and would otherwise stay attached.
    this.securityEvents.emitAllSessionsRevoked({ userId, reason: 'password-reset' });
  }

  /** Recovery codes never enter the login verifier or create an authenticated session. */
  async forgotPasswordOtp(phoneNumber: string, ctx: ClientContext): Promise<OtpChallengeIssuance> {
    const startedAt = Date.now();
    const contact = contactIdentity({ phoneNumber });
    const neutral = fakeOtpEnvelope(contact);
    try {
      // Account existence, verification and recipient suppression must not
      // decide whether this anonymous request performs the OTP KDF.
      const prepared = await this.otp.prepare();
      const result = await this.tx.run(async (trx) => {
        let user = await this.findByContact(contact, trx);
        if (!user) return null;
        const accountId = user.id;
        await lockAuthAccount(trx, accountId);
        user = await this.findByContact(contact, trx);
        if (
          !user ||
          user.id !== accountId ||
          !hasVerifiedContact(user, contact) ||
          user.deletedAt ||
          !user.isActive ||
          user.status !== 'ACTIVE'
        )
          return null;
        const challenge = await this.otp.issue(
          user.id,
          'PASSWORD_RESET_OTP',
          trx,
          contact,
          prepared,
        );
        const ticket = await this.delivery.enqueue(
          {
            ...contact,
            userId: user.id,
            rawCode: challenge.rawCode,
            purpose: 'PASSWORD_RESET_OTP',
            expiresAt: challenge.expiresAt,
          },
          trx,
        );
        await this.audit.record(
          {
            type: 'PASSWORD_RESET_REQUESTED',
            userId: user.id,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
            metadata: { channel: contact.channel },
          },
          trx,
        );
        assertOtpTicket(ticket);
        return { challenge, ticket };
      });
      if (!result) return neutral;
      this.dispatchAfterCommit(result.ticket, ctx, 'password-reset-otp');
      return {
        ...neutral,
        challengeId: result.challenge.challengeId,
        expiresInSeconds: result.challenge.expiresInSeconds,
      };
    } catch {
      this.logger.error({ msg: 'password-reset-otp.request.failed', requestId: ctx.requestId });
      return neutral;
    } finally {
      await this.padAntiEnum(startedAt);
    }
  }

  async resetPasswordOtp(
    challengeId: string,
    rawCode: string,
    newPassword: string,
    ctx: ClientContext,
  ): Promise<void> {
    const newHash = await this.passwords.hash(newPassword);
    const result = await this.tx.run(async (trx) => {
      const verdict = await this.otp.verifyForPasswordReset(challengeId, rawCode, trx);
      if ('rejection' in verdict) return verdict;
      const user = await this.users.findById(verdict.consumed.userId, trx);
      if (
        !user ||
        !hasVerifiedContact(user, boundContact(verdict.consumed, user)) ||
        user.deletedAt ||
        !user.isActive ||
        user.status !== 'ACTIVE'
      ) {
        throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
      }
      await this.applyPasswordReset(user.id, newHash, ctx, trx);
      return { userId: user.id };
    });
    if ('rejection' in result) throw result.rejection;
    this.securityEvents.emitAllSessionsRevoked({ userId: result.userId, reason: 'password-reset' });
  }

  requestPhoneEnrollment(
    userId: string,
    phoneNumber: string,
    password: string,
    ctx: ClientContext,
  ): Promise<OtpChallengeIssuance> {
    return this.requestContactEnrollment(userId, contactIdentity({ phoneNumber }), password, ctx);
  }

  requestEmailEnrollment(
    userId: string,
    email: string,
    password: string,
    ctx: ClientContext,
  ): Promise<OtpChallengeIssuance> {
    return this.requestContactEnrollment(userId, contactIdentity({ email }), password, ctx);
  }

  /** A pending contact is stored only on the challenge, never trusted as a login identifier. */
  private async requestContactEnrollment(
    userId: string,
    contact: OtpDeliveryBinding,
    password: string,
    ctx: ClientContext,
  ): Promise<OtpChallengeIssuance> {
    const startedAt = Date.now();
    const purpose = contact.channel === 'whatsapp' ? 'PHONE_VERIFICATION_OTP' : 'EMAIL_CONTACT_OTP';
    try {
      const result = await this.tx.run(async (trx) => {
        await lockAuthAccount(trx, userId);
        const user = await this.users.findById(userId, trx);
        const passwordOk = await this.passwords.verify(user?.passwordHash ?? null, password);
        if (!user || !isInGoodStanding(user) || this.attempts.isLocked(user))
          return { rejected: true as const };
        if (!passwordOk) {
          await this.attempts.recordFailure(user.id, trx);
          await this.audit.record(
            {
              type: 'LOGIN_FAILED',
              userId: user.id,
              ipAddress: ctx.device.ipAddress,
              userAgent: ctx.device.userAgent,
              requestId: ctx.requestId,
              metadata: { reason: 'contact-link-password', channel: contact.channel },
            },
            trx,
          );
          return { rejected: true as const };
        }
        await this.attempts.recordSuccess(user.id, trx);
        const owner = await this.findByContact(contact, trx);
        if (owner && owner.id !== user.id) return null;
        const challenge = await this.otp.issue(user.id, purpose, trx, contact);
        const ticket = await this.delivery.enqueue(
          {
            ...contact,
            userId: user.id,
            rawCode: challenge.rawCode,
            purpose,
            expiresAt: challenge.expiresAt,
          },
          trx,
        );
        assertOtpTicket(ticket);
        await this.audit.record(
          {
            type:
              contact.channel === 'whatsapp'
                ? 'PHONE_VERIFICATION_REQUESTED'
                : 'EMAIL_VERIFICATION_RESENT',
            userId: user.id,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
            metadata: { channel: contact.channel, purpose, reason: 'contact-link-requested' },
          },
          trx,
        );
        return { challenge, ticket };
      });
      if (result && 'rejected' in result)
        throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
      if (!result) return fakeOtpEnvelope(contact);
      try {
        await this.delivery.dispatch(result.ticket);
      } catch {
        this.logger.error({ msg: 'contact-enrollment.delivery.failed', requestId: ctx.requestId });
      }
      return {
        ...fakeOtpEnvelope(contact),
        challengeId: result.challenge.challengeId,
        expiresInSeconds: result.challenge.expiresInSeconds,
      };
    } finally {
      await this.padAntiEnum(startedAt);
    }
  }

  verifyPhoneEnrollment(
    userId: string,
    challengeId: string,
    rawCode: string,
    ctx: ClientContext,
  ): Promise<void> {
    return this.verifyContactEnrollment(userId, challengeId, rawCode, 'whatsapp', ctx);
  }

  verifyEmailEnrollment(
    userId: string,
    challengeId: string,
    rawCode: string,
    ctx: ClientContext,
  ): Promise<void> {
    return this.verifyContactEnrollment(userId, challengeId, rawCode, 'email', ctx);
  }

  private async verifyContactEnrollment(
    userId: string,
    challengeId: string,
    rawCode: string,
    channel: OtpDeliveryBinding['channel'],
    ctx: ClientContext,
  ): Promise<void> {
    try {
      const result = await this.tx.run(async (trx) => {
        const verdict =
          channel === 'whatsapp'
            ? await this.otp.verifyForPhoneEnrollment(challengeId, rawCode, trx)
            : await this.otp.verifyForEmailEnrollment(challengeId, rawCode, trx);
        if ('rejection' in verdict) return verdict;
        const { consumed } = verdict;
        if (consumed.userId !== userId || consumed.channel !== channel || !consumed.destination)
          throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
        const user = await this.users.findById(userId, trx);
        if (!user || !isInGoodStanding(user))
          throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
        const contact = { channel, destination: consumed.destination };
        await trx.user.update({
          where: { id: userId },
          data: {
            ...(channel === 'whatsapp'
              ? { phoneNumber: consumed.destination }
              : { email: consumed.destination }),
            ...verifiedContactData(contact),
          },
        });
        await this.verification.revokeOutstandingForUser(userId, trx);
        await this.audit.record(
          {
            type: channel === 'whatsapp' ? 'PHONE_VERIFIED' : 'EMAIL_VERIFIED',
            userId,
            ipAddress: ctx.device.ipAddress,
            userAgent: ctx.device.userAgent,
            requestId: ctx.requestId,
            metadata: { channel, reason: 'contact-linked' },
          },
          trx,
        );
        return { success: true as const };
      });
      if ('rejection' in result) throw result.rejection;
    } catch (error) {
      if (isDuplicateIdentity(error)) throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
      throw error;
    }
  }

  private async applyPasswordReset(
    id: string,
    newHash: string,
    ctx: ClientContext,
    trx: PrismaTx,
  ): Promise<void> {
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
  }

  private dispatchAfterCommit(
    ticket: MailTicket,
    ctx: ClientContext,
    scope:
      | 'registration'
      | 'email-verification'
      | 'password-reset'
      | 'password-reset-otp'
      | 'login-otp'
      | 'otp-resend',
    transport: Pick<MailPort, 'dispatch'> = this.delivery,
  ): void {
    // Anonymous responses must not include provider latency in their timing.
    // The committed durable outbox owns retries even if this process stops.
    void transport.dispatch(ticket).catch(() => {
      this.logger.error({ msg: `${scope}.delivery.failed`, requestId: ctx.requestId });
    });
  }

  /** Contact enrollment can reassign email. Re-read after the account lock so
   * a request that began against the old address cannot mint a new recovery
   * token after enrollment invalidates the old credentials. */
  private async findLockedEmailAccount(email: string, trx: PrismaTx): Promise<User | null> {
    const before = await this.users.findByEmail(email, trx);
    if (!before) return null;
    await lockAuthAccount(trx, before.id);
    const current = await this.users.findByEmail(email, trx);
    return current?.id === before.id ? current : null;
  }

  private findByContact(contact: OtpDeliveryBinding, trx?: PrismaTx) {
    return contact.channel === 'whatsapp'
      ? this.users.findByPhoneNumber(contact.destination, trx)
      : this.users.findByEmail(contact.destination, trx);
  }

  // --- Helpers ------------------------------------------------------------
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

function verifiedContactData(contact: OtpDeliveryBinding) {
  return contact.channel === 'whatsapp'
    ? { phoneVerifiedAt: new Date() }
    : { emailVerifiedAt: new Date() };
}

function boundContact(
  challenge: Pick<ConsumedOtp, 'channel' | 'destination'>,
  user: User,
): OtpDeliveryBinding {
  if (challenge.channel && challenge.destination)
    return { channel: challenge.channel, destination: challenge.destination };
  // Challenges issued before this migration are email-only. Never switch them to a new channel.
  if (!user.email) throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
  return { channel: 'email', destination: user.email };
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Opaque challenge envelope for the duplicate-email / auto-verify paths.
// The id is cryptographically random so an attacker cannot distinguish it
// from a real one by shape, and the verify-otp endpoint will return
// AUTH_OTP_INVALID (same as any bad code) when they try to consume it.
function fakeOtpEnvelope(contact?: OtpDeliveryBinding, prefix = ''): OtpChallengeIssuance {
  return {
    challengeId: prefix + randomBytes(24).toString('base64url'),
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    codeLength: OTP_CODE_LENGTH,
    ...(contact ? { channel: contact.channel, maskedDestination: maskContact(contact) } : {}),
  };
}

function isDuplicateIdentity(error: unknown): boolean {
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    error.code !== 'P2002' ||
    !('meta' in error) ||
    !error.meta ||
    typeof error.meta !== 'object' ||
    !('target' in error.meta)
  )
    return false;
  const target = error.meta.target;
  return (
    Array.isArray(target) && target.length === 1 && ['email', 'phoneNumber'].includes(target[0])
  );
}

class OtpDeliverySuppressedError extends AppError {
  constructor() {
    super('RATE_LIMITED', 'Too many verification requests. Please try again later.', 429);
  }
}

function assertOtpTicket(ticket: MailTicket): void {
  // No delivery means no new guesses and no invalidation of the last delivered code.
  // Throw inside the owning transaction so token rotation and attempt counters roll back.
  if (ticket.deliveryId === null && ticket.intent === null) throw new OtpDeliverySuppressedError();
}
