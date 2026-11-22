/** Only low-cardinality codes cross the delivery boundary. Provider error
 * bodies and request URLs can contain recipients, codes and access tokens. */
export class WhatsAppDeliveryError extends Error {
  constructor(readonly code: 'EAUTH' | 'EENVELOPE' | 'ETIMEDOUT' | 'ECONNECTION') {
    super('WhatsApp authentication delivery failed');
    this.name = 'WhatsAppDeliveryError';
  }
}

export interface WhatsAppAuthTransport {
  isConfigured(): boolean;
  sendCode(destination: string, code: string, signal: AbortSignal): Promise<void>;
}

/** All fetch/body failures are replaced, never attached as an error cause:
 * Green API carries its token in the request path, including on GET requests. */
export async function requestWhatsAppJson(
  endpoint: string,
  init: Pick<RequestInit, 'method' | 'headers' | 'body'>,
  signal: AbortSignal,
  statusOverrides: Readonly<Partial<Record<number, WhatsAppDeliveryError['code']>>> = {},
): Promise<unknown> {
  try {
    if (signal.aborted) throw new WhatsAppDeliveryError('ETIMEDOUT');
    const response = await fetch(endpoint, { ...init, redirect: 'error', signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const override = statusOverrides[response.status];
      if (override) throw new WhatsAppDeliveryError(override);
      if (response.status === 401 || response.status === 403)
        throw new WhatsAppDeliveryError('EAUTH');
      if (response.status === 429 || response.status >= 500)
        throw new WhatsAppDeliveryError('ECONNECTION');
      throw new WhatsAppDeliveryError('EENVELOPE');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof WhatsAppDeliveryError) throw error;
    throw new WhatsAppDeliveryError(
      signal.aborted ||
        (isJsonObject(error) && (error.name === 'TimeoutError' || error.name === 'AbortError'))
        ? 'ETIMEDOUT'
        : 'ECONNECTION',
    );
  }
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
