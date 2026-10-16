import { TelemetryService } from '../telemetry/telemetry.service';
import { Global, Logger, Module } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { DurableMailService } from './durable-mail.service';
import { EmailDeliveryRepository } from './email-delivery.repository';
import { MailFeedbackController } from './feedback/mail-feedback.controller';
import { MailFeedbackService } from './feedback/mail-feedback.service';
import { InMemoryMailAdapter } from './in-memory-mail.adapter';
import { MailEnvelopeCipher } from './mail-envelope.cipher';
import { MailDispatcher } from './mail.dispatcher';
import { MailMetrics } from './mail.metrics';
import { MAIL_PORT, MAIL_TRANSPORT, MailPort } from './mail.port';
import { MAIL_ENVELOPE_CIPHER } from './mail.tokens';
import { NodemailerMailAdapter } from './nodemailer-mail.adapter';
import { ProviderStatusEmailHandler } from './provider-status-email.handler';

// MAIL_PORT is always DurableMailService (R21): producers record an intent in
// their own transaction and it is delivered and retried from EmailDelivery.
//
// The transport behind it is decided at boot:
//   SMTP_HOST set   → NodemailerMailAdapter (real SMTP, e.g. Mailpit)
//   SMTP_HOST unset → InMemoryMailAdapter (tests / CI fallback)
@Global()
@Module({
  controllers: [MailFeedbackController],
  providers: [
    InMemoryMailAdapter,
    {
      provide: MAIL_TRANSPORT,
      inject: [AppConfigService, InMemoryMailAdapter, { token: TelemetryService, optional: true }],
      useFactory: (
        config: AppConfigService,
        inMemory: InMemoryMailAdapter,
        telemetry?: TelemetryService,
      ): MailPort => {
        const log = new Logger('MailModule');
        if (config.get('SMTP_HOST')) {
          const adapter = new NodemailerMailAdapter(config, telemetry);
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
        // (e.g. in tests accessing .outbox) gets the same object that sends.
        return inMemory;
      },
    },
    {
      provide: MAIL_ENVELOPE_CIPHER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): MailEnvelopeCipher => {
        const key = config.get('MAIL_INTENT_ENCRYPTION_KEY');
        if (key) return MailEnvelopeCipher.fromBase64(key);
        // R21 — queued OTP and reset links are always sealed at rest. A
        // deployment without a dedicated key derives one (HKDF, separate
        // label) from its required JWT secret, so it neither stores secrets in
        // clear text nor loses queued mail on restart. A dedicated key is
        // preferred; making it mandatory is coordinator change CR-R21-03.
        if (config.isProduction) {
          new Logger('MailModule').warn(
            'MAIL_INTENT_ENCRYPTION_KEY unset: sealing queued mail with a key derived from JWT_ACCESS_SECRET',
          );
          return MailEnvelopeCipher.derived(config.get('JWT_ACCESS_SECRET'));
        }
        new Logger('MailModule').warn(
          'MAIL_INTENT_ENCRYPTION_KEY unset: using a process-local key; queued mail does not survive a restart',
        );
        return MailEnvelopeCipher.ephemeral();
      },
    },
    EmailDeliveryRepository,
    MailMetrics,
    DurableMailService,
    MailDispatcher,
    MailFeedbackService,
    ProviderStatusEmailHandler,
    { provide: MAIL_PORT, useExisting: DurableMailService },
    { provide: MailPort, useExisting: MAIL_PORT },
  ],
  exports: [
    MAIL_PORT,
    MailPort,
    MAIL_TRANSPORT,
    InMemoryMailAdapter,
    DurableMailService,
    MailDispatcher,
    ProviderStatusEmailHandler,
  ],
})
export class MailModule {}
