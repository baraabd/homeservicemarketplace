import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppConfigService } from '../../config/app-config.service';
import { MailModule } from './mail.module';
import { InMemoryMailAdapter } from './in-memory-mail.adapter';
import { MAIL_PORT } from './mail.port';

// Sprint 9B.14 — which mail adapter a process is allowed to bind.
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

// AppConfigService reaches MailModule through the @Global ConfigModule in the
// real application, so the stand-in has to be global too — a plain provider in
// the testing module is invisible to MailModule's own injector.
function buildModule(config: Partial<Record<string, unknown>>, isProduction: boolean) {
  @Global()
  @Module({
    providers: [
      {
        provide: AppConfigService,
        useValue: { get: (key: string) => config[key], isProduction },
      },
    ],
    exports: [AppConfigService],
  })
  class StubConfigModule {}

  return Test.createTestingModule({ imports: [StubConfigModule, MailModule] }).compile();
}

describe('MailModule adapter selection', () => {
  describe('outside production', () => {
    it('binds the in-memory adapter when no SMTP host is configured', async () => {
      const moduleRef = await buildModule({}, false);
      expect(moduleRef.get(MAIL_PORT)).toBeInstanceOf(InMemoryMailAdapter);
      await moduleRef.close();
    });

    it('binds the same instance the class token resolves to', async () => {
      // Tests read `.outbox` through the class token; if the factory returned a
      // second instance those messages would be invisible.
      const moduleRef = await buildModule({}, false);
      expect(moduleRef.get(MAIL_PORT)).toBe(moduleRef.get(InMemoryMailAdapter));
      await moduleRef.close();
    });
  });

  describe('in production', () => {
    it('REFUSES to boot with no SMTP host rather than dropping mail silently', async () => {
      await expect(buildModule({}, true)).rejects.toThrow(/SMTP_HOST/);
    });

    it('says what breaks, so the failure is actionable', async () => {
      // An operator reading a boot failure needs the consequence, not just the
      // variable name — otherwise the temptation is to assume the check is
      // over-strict and delete it.
      await expect(buildModule({}, true)).rejects.toThrow(
        /verification and password reset are unusable/,
      );
    });

    it('boots normally once a host IS configured', async () => {
      const moduleRef = await buildModule(
        { SMTP_HOST: 'smtp.example.test', SMTP_PORT: 587, MAIL_FROM: 'no-reply@example.test' },
        true,
      );
      // Not the mock — that is the whole point.
      expect(moduleRef.get(MAIL_PORT)).not.toBeInstanceOf(InMemoryMailAdapter);
      await moduleRef.close();
    });
  });
});
