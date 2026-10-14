import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EmailDelivery, PrismaTx } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { nextAttemptAt, type RetryPolicy } from '../outbox/outbox.retry';
import { EmailDeliveryRepository } from './email-delivery.repository';
import { MailEnvelopeCipher, recipientHash } from './mail-envelope.cipher';
import { classifyMailFailure } from './mail-errors';
import { MailMetrics } from './mail.metrics';
import {
  MAIL_TRANSPORT,
  MailPort,
  type MailIntent,
  type MailMessage,
  type MailSendResult,
  type MailTicket,
} from './mail.port';
import { MAIL_ENVELOPE_CIPHER } from './mail.tokens';
import type { MailRenderContext } from './templates/mail-templates';
import {
  isMailTemplateId,
  renderMail,
  templateCategory,
  validateTemplateVars,
} from './templates/mail-templates';

/** Per recipient, per template, per window — for the templates an ANONYMOUS
 *  caller can trigger for someone else's address. A second line of defence
 *  behind the route throttles, which are per client: this one is per
 *  ADDRESS, so rotating IPs cannot turn the platform into a mail cannon
 *  aimed at one inbox. Over the limit nothing is recorded or sent, and the
 *  caller's public response is unchanged (no enumeration signal).
 *
 *  OTP mail is not listed: a login code needs the account password, a
 *  registration code is sent once per new account, and OTP resends are
 *  already capped per challenge — throttling them here would only lock out
 *  the account owner. */
export const AUTH_THROTTLE = { limit: 6, windowMs: 15 * 60_000 } as const;
const THROTTLED_TEMPLATES: ReadonlySet<string> = new Set([
  'auth.password_reset',
  'auth.email_verification',
]);

const MAX_ATTEMPTS = { AUTH: 6, NOTIFICATION: 8 } as const;

const RETRY_POLICY: RetryPolicy = { baseMs: 5_000, capMs: 300_000, jitter: 0.2 };

/**
 * R21 — durable outbound mail.
 *
 *   enqueue()  inside the producer's transaction: validate, throttle, seal the
 *              envelope, insert EmailDelivery. Rolled back with the producer.
 *   dispatch() after commit: one immediate attempt (ADR 0004 keeps OTP and
 *              reset mail synchronous because the user is waiting). Never
 *              throws; a failure leaves the row QUEUED for the dispatcher.
 *   process()  one attempt on a claimed row, shared with MailDispatcher.
 *
 * Provider ACCEPTANCE (status ACCEPTED) is the most this class can know.
 * DELIVERED / BOUNCED / COMPLAINED come only from verified feedback.
 */
@Injectable()
export class DurableMailService extends MailPort {
  private readonly log = new Logger(DurableMailService.name);
  private readonly instanceId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailPort,
    @Inject(MAIL_ENVELOPE_CIPHER) private readonly cipher: MailEnvelopeCipher,
    private readonly repo: EmailDeliveryRepository,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metrics: MailMetrics,
  ) {
    super();
  }

  /** Raw transport passthrough for any caller that renders its own message. */
  send(message: MailMessage): Promise<MailSendResult | void> {
    return this.transport.send(message);
  }

  protected override renderContext(): MailRenderContext {
    return { frontendUrl: this.config.get('FRONTEND_URL') ?? null };
  }

  override async enqueue(intent: MailIntent, tx?: PrismaTx): Promise<MailTicket> {
    const vars = validateTemplateVars(intent.template, intent.vars);
    const category = templateCategory(intent.template);
    const hash = recipientHash(intent.to);
    const db = tx ?? (this.prisma.client as unknown as PrismaTx);

    if (THROTTLED_TEMPLATES.has(intent.template)) {
      const since = new Date(Date.now() - AUTH_THROTTLE.windowMs);
      const recent = await this.repo.countRecent(hash, intent.template, since, db);
      if (recent >= AUTH_THROTTLE.limit) {
        this.metrics.attemptsTotal.inc({ category, outcome: 'throttled' });
        this.log.warn({ msg: 'mail.delivery.throttled', template: intent.template });
        return { deliveryId: null, intent: null };
      }
    }

    const messageKey = intent.messageKey ?? `${intent.template}:${randomUUID()}`;
    const row = await this.repo.insertIfAbsent(
      {
        messageKey,
        category,
        template: intent.template,
        userId: intent.userId ?? null,
        recipientHash: hash,
        envelope: this.cipher.seal(messageKey, { to: intent.to.trim(), vars }),
        expiresAt: intent.expiresAt,
        maxAttempts: MAX_ATTEMPTS[category],
      },
      db,
    );
    return { deliveryId: row.id, intent: null };
  }

  override async dispatch(ticket: MailTicket): Promise<void> {
    if (!ticket.deliveryId) return;
    try {
      const row = await this.repo.claimOne(
        ticket.deliveryId,
        this.instanceId,
        this.config.get('MAIL_DISPATCH_LEASE_MS'),
      );
      // Already claimed by the dispatcher, already sent, or not yet due.
      if (!row) return;
      await this.process(row, this.instanceId);
    } catch (err) {
      // The row is durable; the dispatcher will pick it up when the lease
      // lapses. Never surface a mail failure to an auth response.
      this.log.error({
        msg: 'mail.delivery.dispatch_failed',
        deliveryId: ticket.deliveryId,
        errClass: classifyMailFailure(err).failureClass,
      });
    }
  }

  /** One attempt on a row this worker has claimed (status SENDING, leasedBy
   *  = workerId). Every exit writes a fenced transition. */
  async process(row: EmailDelivery, workerId: string): Promise<void> {
    const category = row.category;
    const close = async (
      status: 'FAILED' | 'EXPIRED' | 'SUPPRESSED',
      cls: string,
      attempts: number,
      smtp: number | null = null,
    ) => {
      await this.repo.markClosed(row.id, workerId, status, attempts, cls, smtp);
      this.metrics.attemptsTotal.inc({ category, outcome: closedOutcome(status, cls) });
      const level = status === 'FAILED' ? 'error' : 'warn';
      this.log[level]({
        msg: 'mail.delivery.closed',
        deliveryId: row.id,
        template: row.template,
        status,
        errClass: cls,
        smtpCode: smtp,
      });
    };

    if (row.expiresAt.getTime() <= Date.now()) return close('EXPIRED', 'expired', row.attempts);
    if (!isMailTemplateId(row.template)) return close('FAILED', 'unknown_template', row.attempts);

    const envelope = row.envelope ? this.cipher.open(row.messageKey, row.envelope) : null;
    if (!envelope) return close('FAILED', 'undecryptable', row.attempts);

    // Only NOTIFICATION mail honours suppression. AUTH mail was requested by
    // the recipient seconds ago and is their only way back into the account;
    // feedback must never silently revoke access (see RISKS.md, policy P-2).
    if (category === 'NOTIFICATION' && (await this.repo.isSuppressed(row.recipientHash))) {
      return close('SUPPRESSED', 'suppressed', row.attempts);
    }

    let message: MailMessage;
    try {
      const rendered = renderMail(row.template, envelope.vars as never, this.renderContext());
      message = { to: envelope.to, ...rendered, messageId: this.messageIdFor(row.id) };
    } catch {
      return close('FAILED', 'invalid_vars', row.attempts);
    }

    const attempts = row.attempts + 1;
    try {
      const result = await this.transport.send(message);
      const smtpCode = (result && result.smtpCode) ?? null;
      await this.repo.markAccepted(row.id, workerId, attempts, smtpCode);
      this.metrics.attemptsTotal.inc({ category, outcome: 'accepted' });
      this.log.log({
        msg: 'mail.delivery.accepted',
        deliveryId: row.id,
        template: row.template,
        attempts,
      });
    } catch (err) {
      const { failureClass, smtpCode } = classifyMailFailure(err);
      if (failureClass === 'permanent') return close('FAILED', 'permanent', attempts, smtpCode);
      const when = nextAttemptAt(attempts, row.maxAttempts, new Date(), RETRY_POLICY);
      if (when === null)
        return close(
          'FAILED',
          failureClass === 'config' ? 'config' : 'transient',
          attempts,
          smtpCode,
        );
      if (when.getTime() >= row.expiresAt.getTime())
        return close('EXPIRED', 'expired', attempts, smtpCode);
      await this.repo.markRetry(row.id, workerId, attempts, when, failureClass, smtpCode);
      this.metrics.attemptsTotal.inc({ category, outcome: failureClass });
      const level = failureClass === 'config' ? 'error' : 'warn';
      this.log[level]({
        msg: 'mail.delivery.retry_scheduled',
        deliveryId: row.id,
        template: row.template,
        attempts,
        errClass: failureClass,
        smtpCode,
        nextAttemptAt: when.toISOString(),
      });
    }
  }

  /** `<deliveryId@sender-domain>` — stable for every retry of one intent and
   *  the correlation key provider feedback carries back. */
  messageIdFor(deliveryId: string): string {
    return `<${deliveryId}@${senderDomain(this.config.get('SMTP_FROM'))}>`;
  }
}

function closedOutcome(status: 'FAILED' | 'EXPIRED' | 'SUPPRESSED', cls: string): string {
  if (status === 'EXPIRED') return 'expired';
  if (status === 'SUPPRESSED') return 'suppressed';
  if (cls === 'undecryptable' || cls === 'config') return cls;
  return cls === 'transient' ? 'exhausted' : 'permanent';
}

export function senderDomain(from: string): string {
  const match = /@([A-Za-z0-9.-]+)>?\s*$/.exec(from.trim());
  return match?.[1]?.toLowerCase() ?? 'localhost';
}

/** Inverse of messageIdFor; null for anything we did not mint. */
export function deliveryIdFromMessageId(messageId: string): string | null {
  const match = /^<?([a-z0-9]{20,40})@[A-Za-z0-9.-]+>?$/.exec(messageId.trim());
  return match?.[1] ?? null;
}
