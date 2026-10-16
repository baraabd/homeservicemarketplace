import { TelemetryService } from '../telemetry/telemetry.service';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import { AppConfigService } from '../../config/app-config.service';
import { smtpCodeFromResponse } from './mail-errors';
import { MailPort, type MailMessage, type MailSendResult } from './mail.port';

@Injectable()
export class NodemailerMailAdapter extends MailPort implements OnModuleInit {
  private readonly logger = new Logger(NodemailerMailAdapter.name);
  private transporter!: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(
    private readonly config: AppConfigService,
    @Optional() private readonly telemetry?: TelemetryService,
  ) {
    super();
  }

  onModuleInit(): void {
    const host = this.config.get('SMTP_HOST');
    const port = this.config.get('SMTP_PORT');
    const secure = this.config.get('SMTP_SECURE');
    const user = this.config.get('SMTP_USER');
    const pass = this.config.get('SMTP_PASS');

    this.transporter = createTransport({
      host,
      port,
      secure,
      // Implicit TLS (465) or mandatory STARTTLS: hardened mail must never
      // fall back to plaintext when a relay omits the STARTTLS capability.
      requireTLS: this.config.isProduction && !secure,
      ...(this.config.isProduction ? { tls: { rejectUnauthorized: true } } : {}),
      ...(user && pass ? { auth: { user, pass } } : {}),
      // R21 — bounded. Nodemailer's defaults (2 min connect, 10 min socket)
      // let one hung relay hold a dispatcher lease and a request's post-commit
      // attempt for minutes. Every value has a schema default.
      ...timeouts(this.config),
    });

    this.logger.log({ msg: 'smtp.configured', host, port, secure });
  }

  async verify(signal: AbortSignal): Promise<void> {
    // A separate bounded connection: cancelling a diagnostic never closes a real send.
    const user = this.config.get('SMTP_USER');
    const pass = this.config.get('SMTP_PASS');
    const secure = this.config.get('SMTP_SECURE');
    const probe = createTransport({
      host: this.config.get('SMTP_HOST'),
      port: this.config.get('SMTP_PORT'),
      secure,
      requireTLS: this.config.isProduction && !secure,
      ...(this.config.isProduction ? { tls: { rejectUnauthorized: true } } : {}),
      ...(user && pass ? { auth: { user, pass } } : {}),
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 3000,
    });
    const abort = () => probe.close();
    signal.throwIfAborted();
    signal.addEventListener('abort', abort, { once: true });
    try {
      await probe.verify();
    } finally {
      signal.removeEventListener('abort', abort);
      probe.close();
    }
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    const from = this.config.get('SMTP_FROM');

    const send = () =>
      this.transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.messageId ? { messageId: message.messageId } : {}),
      });

    const info = await (this.telemetry
      ? this.telemetry.callDependency('smtp', 'send', send)
      : send());

    // Log envelope metadata only — never the body (contains one-time tokens).
    this.logger.log({
      msg: 'mail.sent',
      to: maskEmail(message.to),
      subject: message.subject,
    });
    const smtpCode = smtpCodeFromResponse(info?.response);
    return smtpCode === undefined ? {} : { smtpCode };
  }
}

function timeouts(config: AppConfigService) {
  const connectionTimeout = config.get('SMTP_CONNECTION_TIMEOUT_MS');
  const greetingTimeout = config.get('SMTP_GREETING_TIMEOUT_MS');
  const socketTimeout = config.get('SMTP_SOCKET_TIMEOUT_MS');
  return {
    ...(connectionTimeout ? { connectionTimeout } : {}),
    ...(greetingTimeout ? { greetingTimeout } : {}),
    ...(socketTimeout ? { socketTimeout } : {}),
  };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[redacted]';
  return `${local.slice(0, 1)}***@${domain}`;
}
