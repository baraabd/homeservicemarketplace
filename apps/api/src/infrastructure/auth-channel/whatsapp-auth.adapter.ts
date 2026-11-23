import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { GreenApiWhatsAppAuthTransport } from './green-api-whatsapp-auth.transport';
import { MetaWhatsAppAuthTransport } from './meta-whatsapp-auth.transport';
import { WhatsAppDeliveryError, type WhatsAppAuthTransport } from './whatsapp-auth.transport';

// Preserve the public error boundary used by the durable dispatcher and its callers.
export { WhatsAppDeliveryError } from './whatsapp-auth.transport';

@Injectable()
export class WhatsAppAuthAdapter {
  private readonly transport?: WhatsAppAuthTransport;

  constructor(private readonly config: AppConfigService) {
    // The schema defaults to Meta. The fallback also keeps existing injected
    // config fixtures compatible; an unknown provider never selects a transport.
    const provider = config.get('WHATSAPP_PROVIDER') ?? 'meta';
    if (provider === 'meta') this.transport = new MetaWhatsAppAuthTransport(config);
    if (provider === 'greenapi') this.transport = new GreenApiWhatsAppAuthTransport(config);
  }

  /** Local configuration only: no message send or provider request is triggered. */
  isConfigured(): boolean {
    return this.transport?.isConfigured() ?? false;
  }

  async sendCode(destination: string, code: string): Promise<void> {
    if (!this.transport || !this.isConfigured()) throw new WhatsAppDeliveryError('EAUTH');
    if (!/^\+[1-9][0-9]{6,14}$/.test(destination) || !/^[0-9]{6}$/.test(code))
      throw new WhatsAppDeliveryError('EENVELOPE');

    // One budget covers the Green API state check, message request and response
    // bodies together, keeping dispatch within its existing lease.
    const signal = AbortSignal.timeout(this.config.get('WHATSAPP_REQUEST_TIMEOUT_MS'));
    await this.transport.sendCode(destination, code, signal);
  }
}
