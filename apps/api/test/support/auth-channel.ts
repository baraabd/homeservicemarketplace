import type { AppConfigService } from '../../src/config/app-config.service';
import { AuthChannelService } from '../../src/infrastructure/auth-channel/auth-channel.service';
import { OtpDeliveryService } from '../../src/infrastructure/auth-channel/otp-delivery.service';
import { WhatsAppAuthAdapter } from '../../src/infrastructure/auth-channel/whatsapp-auth.adapter';
import type { MailPort } from '../../src/infrastructure/mail/mail.port';
import type { PlatformSettingRepository } from '../../src/infrastructure/persistence/settings/platform-setting.repository';

/** Email lifecycle suites pin their policy to the default so another suite's
 * platform-setting fixtures cannot reroute their real database challenges. */
export function emailAuthenticationServices(config: AppConfigService, mail: MailPort) {
  const settings = { findByKey: async () => null } as unknown as PlatformSettingRepository;
  const channels = new AuthChannelService(settings, new WhatsAppAuthAdapter(config));
  return [channels, new OtpDeliveryService(mail, channels)] as const;
}
