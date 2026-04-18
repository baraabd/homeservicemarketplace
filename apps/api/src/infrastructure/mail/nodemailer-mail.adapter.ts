import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import { AppConfigService } from '../../config/app-config.service';
import { MailPort, type MailMessage } from './mail.port';

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
      ...(user && pass ? { auth: { user, pass } } : {}),
    });

    this.logger.log({ msg: 'smtp.configured', host, port, secure });
  }

  async send(message: MailMessage): Promise<void> {
    const from = this.config.get('SMTP_FROM');

    await this.transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });

    // Log envelope metadata only — never the body (contains one-time tokens).
    this.logger.log({
      msg: 'mail.sent',
      to: maskEmail(message.to),
      subject: message.subject,
    });
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[redacted]';
  return `${local.slice(0, 1)}***@${domain}`;
}
