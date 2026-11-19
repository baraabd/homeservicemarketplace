import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';

/** Only low-cardinality codes leave this adapter. Graph error bodies can
 * contain recipient data and credentials and are deliberately discarded. */
export class WhatsAppDeliveryError extends Error {
  constructor(readonly code: 'EAUTH' | 'EENVELOPE' | 'ETIMEDOUT' | 'ECONNECTION') {
    super('WhatsApp authentication delivery failed');
    this.name = 'WhatsAppDeliveryError';
  }
}

@Injectable()
export class WhatsAppAuthAdapter {
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

  async sendCode(destination: string, code: string): Promise<void> {
    if (!this.isConfigured()) throw new WhatsAppDeliveryError('EAUTH');
    if (!/^\+[1-9][0-9]{6,14}$/.test(destination) || !/^[0-9]{6}$/.test(code))
      throw new WhatsAppDeliveryError('EENVELOPE');

    const version = this.config.get('WHATSAPP_GRAPH_API_VERSION');
    const sender = this.config.get('WHATSAPP_PHONE_NUMBER_ID');
    // Origin is fixed: neither an administrator nor a request may redirect a bearer token.
    const endpoint = `https://graph.facebook.com/${version}/${sender}/messages`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.config.get('WHATSAPP_ACCESS_TOKEN')}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(this.config.get('WHATSAPP_REQUEST_TIMEOUT_MS')),
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
      });
    } catch (error) {
      throw new WhatsAppDeliveryError(
        error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
          ? 'ETIMEDOUT'
          : 'ECONNECTION',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403)
        throw new WhatsAppDeliveryError('EAUTH');
      if (response.status === 429 || response.status >= 500)
        throw new WhatsAppDeliveryError('ECONNECTION');
      throw new WhatsAppDeliveryError('EENVELOPE');
    }
    // 2xx is provider acceptance, not delivery. Require the documented message ID.
    const result: unknown = await response.json().catch(() => null);
    if (
      !result ||
      typeof result !== 'object' ||
      !('messages' in result) ||
      !Array.isArray(result.messages) ||
      !result.messages.some(
        (message: unknown) =>
          message !== null &&
          typeof message === 'object' &&
          'id' in message &&
          typeof message.id === 'string' &&
          message.id.length > 0,
      )
    )
      throw new WhatsAppDeliveryError('ECONNECTION');
  }
}
