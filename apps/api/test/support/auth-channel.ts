import type { TestingModuleBuilder } from '@nestjs/testing';
import type { AppConfigService } from '../../src/config/app-config.service';
import { AuthChannelService } from '../../src/infrastructure/auth-channel/auth-channel.service';
import { OtpDeliveryService } from '../../src/infrastructure/auth-channel/otp-delivery.service';
import { WhatsAppAuthAdapter } from '../../src/infrastructure/auth-channel/whatsapp-auth.adapter';
import type { MailPort } from '../../src/infrastructure/mail/mail.port';
import type { PlatformSettingRepository } from '../../src/infrastructure/persistence/settings/platform-setting.repository';

/** Email lifecycle suites select email explicitly so the platform default and
 * another suite's settings cannot reroute their real database challenges. */
function emailAuthChannel(whatsapp: WhatsAppAuthAdapter): AuthChannelService {
  const settings = {
    findByKey: async () => ({ value: 'email' }),
  } as unknown as PlatformSettingRepository;
  return new AuthChannelService(settings, whatsapp);
}

export function emailAuthenticationServices(config: AppConfigService, mail: MailPort) {
  const channels = emailAuthChannel(new WhatsAppAuthAdapter(config));
  return [channels, new OtpDeliveryService(mail, channels)] as const;
}

/** These journeys exercise email registration, not the global policy table.
 * Keep the real channel service and provider checks, with an explicit email
 * preference scoped to this app. auth-channel-policy.integration.spec.ts owns
 * the real persisted-policy/default/reset path in an isolated database. */
export function withEmailAuthenticationPolicy(builder: TestingModuleBuilder): TestingModuleBuilder {
  return builder.overrideProvider(AuthChannelService).useFactory({
    inject: [WhatsAppAuthAdapter],
    factory: emailAuthChannel,
  });
}
