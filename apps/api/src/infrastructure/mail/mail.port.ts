// Outbound-mail boundary. IAM and other producers depend on this port, not on
// a concrete adapter.
//
// Two layers share it:
//
//   send()               the raw transport: hand one rendered message to SMTP
//                        (or to the in-memory capture in dev/test).
//   enqueue()/dispatch() the intent API producers use. `enqueue` runs INSIDE
//                        the producer's transaction; `dispatch` runs after it
//                        commits. A rolled-back transaction therefore never
//                        produces a message.
//
// The base enqueue/dispatch are deliberately NOT durable: they keep the intent
// in memory and render + send it on dispatch. Only transport-only test doubles
// (an InMemoryMailAdapter injected directly as MAIL_PORT) use them. MailModule
// binds DurableMailService, which persists the intent in EmailDelivery and
// retries it independently of the request.
import type { PrismaTx } from '@homeservicemarketplace/database';

import { renderMail, type MailRenderContext } from './templates/mail-templates';
import type { MailTemplateId, MailTemplateVars } from './templates/mail-template.types';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  // Produced only by the template layer, with every interpolated value
  // escaped. Raw string interpolation with user input is never acceptable.
  html?: string;
  // RFC 5322 Message-ID including angle brackets. Stable across retries of one
  // intent, so provider feedback can be correlated with it.
  messageId?: string;
}

export interface MailSendResult {
  // SMTP reply code of the final response, when the transport has one.
  smtpCode?: number;
}

export interface MailIntent<T extends MailTemplateId = MailTemplateId> {
  template: T;
  to: string;
  vars: MailTemplateVars[T];
  userId?: string | null;
  // After this instant the message is useless (the code or link inside it has
  // expired) and it is never sent.
  expiresAt: Date;
  // Producer idempotency key: two enqueues with one key are one message.
  // Defaults to a random key.
  messageKey?: string;
}

export interface MailTicket {
  // EmailDelivery id; null when nothing durable was recorded (base
  // implementation, or the intent was throttled).
  deliveryId: string | null;
  intent: MailIntent | null;
}

export abstract class MailPort {
  abstract send(message: MailMessage): Promise<MailSendResult | void>;

  protected renderContext(): MailRenderContext {
    return { frontendUrl: null };
  }

  async enqueue(intent: MailIntent, _tx?: PrismaTx): Promise<MailTicket> {
    return { deliveryId: null, intent };
  }

  async dispatch(ticket: MailTicket): Promise<void> {
    if (!ticket.intent) return;
    const rendered = renderMail(ticket.intent.template, ticket.intent.vars, this.renderContext());
    await this.send({ to: ticket.intent.to, ...rendered });
  }
}

export const MAIL_PORT = Symbol.for('IAM_MAIL_PORT');

/** The raw transport (Nodemailer or in-memory) behind DurableMailService. */
export const MAIL_TRANSPORT = Symbol.for('MAIL_TRANSPORT');
