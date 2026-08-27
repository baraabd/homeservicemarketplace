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
        // Sprint 9B.14 — a production process must not bind the mock.
        //
        // The in-memory adapter is a correct default for dev and CI: it
        // captures messages so a test can read an OTP. In production it is a
        // silent hole. Registration, email verification and password reset all
        // return 202 and log "mail.sent", while nothing is delivered — so every
        // new account is unreachable and every locked-out user stays locked
        // out, with a green health check and no error anywhere.
        //
        // Refusing at boot is the only honest outcome. The failure mode it
        // replaces is invisible for as long as nobody happens to test signup on
        // production, which is exactly the kind of bug that is found by a user.
        if (config.isProduction) {
          throw new Error(
            'Refusing to boot: no SMTP_HOST is configured, so mail would be ' +
              'captured in memory and never delivered. Configure SMTP_HOST (and ' +
              'its credentials), or run a mail relay — verification and password ' +
              'reset are unusable without one.',
          );
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
