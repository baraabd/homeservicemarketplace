import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../telemetry/metrics.service';
import { DurableMailService } from './durable-mail.service';
import { MailModule } from './mail.module';
import { InMemoryMailAdapter } from './in-memory-mail.adapter';
import { MAIL_PORT, MAIL_TRANSPORT } from './mail.port';
import { MAIL_ENVELOPE_CIPHER } from './mail.tokens';
import { MailEnvelopeCipher } from './mail-envelope.cipher';

// Sprint 9B.14 — which mail TRANSPORT a process is allowed to bind.
//
// The in-memory adapter is the right default for dev and CI: it captures
// messages so a test can read an OTP out of one. In production it is a SILENT
// HOLE. Registration, email verification and password reset all answer 202 and
// log `mail.sent`, while nothing is delivered — so every new account is
// unreachable and every locked-out user stays locked out, with a green health
// check and no error anywhere to notice.
//
// That failure is invisible until someone happens to test signup against
// production, which in practice means it is found by a user. Refusing at boot
// is the only honest outcome, and it is the same treatment the deterministic
// test SCANNER already gets for the same reason: an adapter that can quietly
// fake a security-relevant outcome must not be reachable where it matters.
//
// R21 — producers no longer talk to the transport: MAIL_PORT is always the
// durable service, and the transport sits behind MAIL_TRANSPORT.

// AppConfigService reaches MailModule through the @Global ConfigModule in the
// real application, so the stand-ins have to be global too — a plain provider
// in the testing module is invisible to MailModule's own injector.
function buildModule(config: Partial<Record<string, unknown>>, isProduction: boolean) {
  @Global()
  @Module({
    providers: [
      {
        provide: AppConfigService,
        useValue: {
          get: (key: string) =>
            key in config ? config[key] : key === 'MAIL_DISPATCHER_ENABLED' ? false : undefined,
          isProduction,
        },
      },
      // Never touched at module construction; the dispatcher is disabled.
      { provide: PrismaService, useValue: {} },
      MetricsService,
    ],
    exports: [AppConfigService, PrismaService, MetricsService],
  })
  class StubInfraModule {}

  return Test.createTestingModule({ imports: [StubInfraModule, MailModule] }).compile();
}

const JWT = { JWT_ACCESS_SECRET: 'x'.repeat(48) };

describe('MailModule adapter selection', () => {
  describe('outside production', () => {
    it('binds the in-memory transport when no SMTP host is configured', async () => {
      const moduleRef = await buildModule({}, false);
      expect(moduleRef.get(MAIL_TRANSPORT)).toBeInstanceOf(InMemoryMailAdapter);
      await moduleRef.close();
    });

    it('binds the same instance the class token resolves to', async () => {
      // Tests read `.outbox` through the class token; if the factory returned a
      // second instance those messages would be invisible.
      const moduleRef = await buildModule({}, false);
      expect(moduleRef.get(MAIL_TRANSPORT)).toBe(moduleRef.get(InMemoryMailAdapter));
      await moduleRef.close();
    });

    it('routes producers through the durable service, never the bare transport', async () => {
      const moduleRef = await buildModule({}, false);
      expect(moduleRef.get(MAIL_PORT)).toBeInstanceOf(DurableMailService);
      await moduleRef.close();
    });
  });

  describe('in production', () => {
    it('REFUSES to boot with no SMTP host rather than dropping mail silently', async () => {
      await expect(buildModule({ ...JWT }, true)).rejects.toThrow(/SMTP_HOST/);
    });

    it('says what breaks, so the failure is actionable', async () => {
      // An operator reading a boot failure needs the consequence, not just the
      // variable name — otherwise the temptation is to assume the check is
      // over-strict and delete it.
      await expect(buildModule({ ...JWT }, true)).rejects.toThrow(
        /verification and password reset are unusable/,
      );
    });

    it('boots normally once a host IS configured', async () => {
      const moduleRef = await buildModule(
        {
          ...JWT,
          SMTP_HOST: 'smtp.example.test',
          SMTP_PORT: 587,
          SMTP_FROM: 'no-reply@example.test',
        },
        true,
      );
      // Not the mock — that is the whole point.
      expect(moduleRef.get(MAIL_TRANSPORT)).not.toBeInstanceOf(InMemoryMailAdapter);
      await moduleRef.close();
    });
  });

  describe('R21 envelope sealing key', () => {
    it('rejects a configured key that is not 32 bytes instead of weakening sealing', async () => {
      await expect(
        buildModule({ MAIL_INTENT_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }, false),
      ).rejects.toThrow(/32 bytes/);
    });

    it('production without a dedicated key derives a restart-stable key from the JWT secret', async () => {
      const smtp = { SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'no-reply@example.test' };
      const first = await buildModule({ ...JWT, ...smtp }, true);
      const second = await buildModule({ ...JWT, ...smtp }, true);
      const sealed = first
        .get<MailEnvelopeCipher>(MAIL_ENVELOPE_CIPHER)
        .seal('k', { to: 'a@example.test', vars: {} });
      // A restarted process (a second module) opens what the first sealed.
      expect(second.get<MailEnvelopeCipher>(MAIL_ENVELOPE_CIPHER).open('k', sealed)).toEqual({
        to: 'a@example.test',
        vars: {},
      });
      await first.close();
      await second.close();
    });
  });
});
