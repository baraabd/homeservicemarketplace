import type { AppConfigService } from '../../config/app-config.service';
import { isGreenApiOrigin } from '../../config/green-api.config';
import {
  isJsonObject,
  requestWhatsAppJson,
  WhatsAppDeliveryError,
  type WhatsAppAuthTransport,
} from './whatsapp-auth.transport';

// GREEN-API also returns 400 while starting or unauthorized. Preserve the
// dispatcher's bounded retry instead of treating every 400 as a bad envelope.
// Error bodies are discarded because quota errors can contain recipient lists.
const GREEN_API_STATUS_CODES = {
  400: 'ECONNECTION',
  408: 'ETIMEDOUT',
  466: 'EAUTH',
  499: 'ETIMEDOUT',
} as const;
const AUTHORIZED_STATE_CACHE_MS = 5_000;

export class GreenApiWhatsAppAuthTransport implements WhatsAppAuthTransport {
  private authorizedUntil = 0;
  private authorizationCheck?: Promise<void>;

  constructor(private readonly config: AppConfigService) {}

  isConfigured(): boolean {
    const origin = this.config.get('GREEN_API_URL');
    return Boolean(
      origin &&
      isGreenApiOrigin(origin) &&
      this.config.get('GREEN_API_ID_INSTANCE') &&
      this.config.get('GREEN_API_TOKEN')?.trim(),
    );
  }

  async sendCode(destination: string, code: string, signal: AbortSignal): Promise<void> {
    // Recheck here before building a URL: never send a token to an arbitrary host,
    // including when a transport is constructed directly outside the Nest module.
    if (!this.isConfigured()) throw new WhatsAppDeliveryError('EAUTH');
    const origin = new URL(this.config.get('GREEN_API_URL')!).origin;
    const instance = encodeURIComponent(this.config.get('GREEN_API_ID_INSTANCE')!);
    const token = encodeURIComponent(this.config.get('GREEN_API_TOKEN')!);
    const endpoint = (method: 'getStateInstance' | 'sendMessage' | 'sendTemplate') =>
      `${origin}/waInstance${instance}/${method}/${token}`;

    // GREEN-API may queue messages for 24 hours while unauthorized. A brief
    // shared positive-state check avoids its one-request/second state limit.
    // A later disconnect can still delay delivery; this is no delivery receipt.
    await this.assertAuthorized(endpoint('getStateInstance'), signal);

    const chatId = `${destination.slice(1)}@c.us`;
    const templateId = this.config.get('GREEN_API_AUTH_TEMPLATE_ID');
    // WABA instances require a previously approved one-code authentication
    // template. Ordinary connected instances use the documented text method.
    const body = templateId
      ? { chatId, templateId, params: [code] }
      : {
          chatId,
          message: [
            'الخدمات المنزلية | Home Services',
            `رمز التحقق / Verification code: ${code}`,
            'لا تشارك هذا الرمز. Do not share this code.',
          ].join('\n'),
          linkPreview: false,
        };
    try {
      const result = await requestWhatsAppJson(
        endpoint(templateId ? 'sendTemplate' : 'sendMessage'),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        signal,
        GREEN_API_STATUS_CODES,
      );
      // This acknowledges the provider queue only; it is not a delivery receipt.
      if (!isJsonObject(result) || typeof result.idMessage !== 'string' || !result.idMessage.trim())
        throw new WhatsAppDeliveryError('ECONNECTION');
    } catch (error) {
      this.authorizedUntil = 0;
      throw error;
    }
  }

  private assertAuthorized(endpoint: string, signal: AbortSignal): Promise<void> {
    if (Date.now() < this.authorizedUntil) return Promise.resolve();
    // Per-process singleton only. Cross-replica rate limits remain transient
    // delivery failures handled by the existing durable retry budget.
    if (!this.authorizationCheck) {
      this.authorizationCheck = this.checkSenderState(endpoint, signal).finally(() => {
        this.authorizationCheck = undefined;
      });
    }
    return this.authorizationCheck;
  }

  private async checkSenderState(endpoint: string, signal: AbortSignal): Promise<void> {
    const state = await requestWhatsAppJson(
      endpoint,
      { method: 'GET' },
      signal,
      GREEN_API_STATUS_CODES,
    );
    if (!isJsonObject(state) || typeof state.stateInstance !== 'string')
      throw new WhatsAppDeliveryError('ECONNECTION');
    if (state.stateInstance !== 'authorized')
      throw new WhatsAppDeliveryError(
        ['notAuthorized', 'blocked', 'suspended', 'yellowCard'].includes(state.stateInstance)
          ? 'EAUTH'
          : 'ECONNECTION',
      );
    this.authorizedUntil = Date.now() + AUTHORIZED_STATE_CACHE_MS;
  }
}
