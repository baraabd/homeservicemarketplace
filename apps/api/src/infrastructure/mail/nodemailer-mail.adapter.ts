import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import { AppConfigService } from '../../config/app-config.service';
import { smtpCodeFromResponse } from './mail-errors';
import { MailPort, type MailMessage, type MailSendResult } from './mail.port';

@Injectable()
export class NodemailerMailAdapter extends MailPort implements OnModuleInit {
  private readonly logger = new Logger(NodemailerMailAdapter.name);
  private transporter!: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(private readonly config: AppConfigService) {
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

  async send(message: MailMessage): Promise<MailSendResult> {
    const from = this.config.get('SMTP_FROM');

    const info = await this.transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.messageId ? { messageId: message.messageId } : {}),
    });

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
