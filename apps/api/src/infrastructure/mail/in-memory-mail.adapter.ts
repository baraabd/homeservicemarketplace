import { Injectable, Logger } from '@nestjs/common';

import { MailPort, type MailMessage } from './mail.port';

// Dev/test adapter. Captures messages in memory so integration tests can
// assert "a reset email was sent to X" without a real SMTP service.
// Never used in production: the real adapter must be registered by the
// infra module when the real mail provider is wired in a later phase.
@Injectable()
export class InMemoryMailAdapter extends MailPort {
  private readonly logger = new Logger(InMemoryMailAdapter.name);
  private readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    // Do NOT log message.text — it may contain a one-time token. Log only
    // envelope metadata. The token is retrievable in tests via `outbox`.
    this.logger.log({ msg: 'mail.sent', to: maskEmail(message.to), subject: message.subject });
  }

  get outbox(): readonly MailMessage[] {
    return this.sent;
  }

  clear(): void {
    this.sent.length = 0;
  }

  lastSentTo(email: string): MailMessage | undefined {
    const normalized = email.toLowerCase();
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i]!.to.toLowerCase() === normalized) return this.sent[i];
    }
    return undefined;
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[redacted]';
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}
