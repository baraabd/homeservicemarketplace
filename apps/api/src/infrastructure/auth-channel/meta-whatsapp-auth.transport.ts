import type { AppConfigService } from '../../config/app-config.service';
import {
  isJsonObject,
  requestWhatsAppJson,
  WhatsAppDeliveryError,
  type WhatsAppAuthTransport,
} from './whatsapp-auth.transport';

export class MetaWhatsAppAuthTransport implements WhatsAppAuthTransport {
  constructor(private readonly config: AppConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get('WHATSAPP_ACCESS_TOKEN')?.trim() &&
      this.config.get('WHATSAPP_PHONE_NUMBER_ID') &&
      this.config.get('WHATSAPP_GRAPH_API_VERSION') &&
      this.config.get('WHATSAPP_AUTH_TEMPLATE_NAME') &&
      this.config.get('WHATSAPP_AUTH_TEMPLATE_LANGUAGE') &&
      this.config.get('WHATSAPP_AUTH_TEMPLATE_APPROVED'),
    );
  }

  async sendCode(destination: string, code: string, signal: AbortSignal): Promise<void> {
    const version = this.config.get('WHATSAPP_GRAPH_API_VERSION');
    const sender = this.config.get('WHATSAPP_PHONE_NUMBER_ID');
    // Origin is fixed: neither an administrator nor a request may redirect a bearer token.
    const endpoint = `https://graph.facebook.com/${version}/${sender}/messages`;
    const result = await requestWhatsAppJson(
      endpoint,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.get('WHATSAPP_ACCESS_TOKEN')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destination.slice(1),
          type: 'template',
          template: {
            name: this.config.get('WHATSAPP_AUTH_TEMPLATE_NAME'),
            language: { code: this.config.get('WHATSAPP_AUTH_TEMPLATE_LANGUAGE') },
            components: [
              { type: 'body', parameters: [{ type: 'text', text: code }] },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: code }],
              },
            ],
          },
        }),
      },
      signal,
    );
    // 2xx is provider acceptance, not delivery. Require the documented message ID.
    if (
      !isJsonObject(result) ||
      !Array.isArray(result.messages) ||
      !result.messages.some(
        (message: unknown) =>
          isJsonObject(message) && typeof message.id === 'string' && message.id.trim().length > 0,
      )
    )
      throw new WhatsAppDeliveryError('ECONNECTION');
  }
}
