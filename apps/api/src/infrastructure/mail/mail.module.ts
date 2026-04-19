import { Global, Logger, Module } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { InMemoryMailAdapter } from './in-memory-mail.adapter';
import { MAIL_PORT, MailPort } from './mail.port';
import { NodemailerMailAdapter } from './nodemailer-mail.adapter';

// Decides at boot time which mail adapter to use:
//   SMTP_HOST set → NodemailerMailAdapter (real SMTP, e.g. Mailpit)
//   SMTP_HOST unset → InMemoryMailAdapter (tests / CI fallback)
@Global()
@Module({
  providers: [
    InMemoryMailAdapter,
    {
      provide: MAIL_PORT,
      inject: [AppConfigService, InMemoryMailAdapter],
      useFactory: (config: AppConfigService, inMemory: InMemoryMailAdapter): MailPort => {
        const log = new Logger('MailModule');
        if (config.get('SMTP_HOST')) {
          const adapter = new NodemailerMailAdapter(config);
          // Factory-created instances don't receive NestJS lifecycle hooks,
          // so we call init eagerly here. The transporter setup is synchronous.
          adapter.onModuleInit();
          log.log('Using NodemailerMailAdapter (SMTP)');
          return adapter;
        }
        log.log('Using InMemoryMailAdapter (no SMTP_HOST)');
        // Return the NestJS-managed instance so that injecting by class token
        // (e.g. in tests accessing .outbox) gets the same object as MAIL_PORT.
        return inMemory;
      },
    },
    { provide: MailPort, useExisting: MAIL_PORT },
  ],
  exports: [MAIL_PORT, MailPort, InMemoryMailAdapter],
})
export class MailModule {}
