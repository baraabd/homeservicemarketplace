import type { AppConfigService } from '../../config/app-config.service';
import { WhatsAppAuthAdapter } from './whatsapp-auth.adapter';

const values: Record<string, unknown> = {
  WHATSAPP_ACCESS_TOKEN: 'test-token-never-logged',
  WHATSAPP_PHONE_NUMBER_ID: '123456789',
  WHATSAPP_GRAPH_API_VERSION: 'v27.0',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'account_code',
  WHATSAPP_AUTH_TEMPLATE_LANGUAGE: 'ar',
  WHATSAPP_AUTH_TEMPLATE_APPROVED: true,
  WHATSAPP_REQUEST_TIMEOUT_MS: 1000,
};

function adapter(overrides: Record<string, unknown> = {}) {
  return new WhatsAppAuthAdapter({
    get: (key: string) => ({ ...values, ...overrides })[key],
  } as unknown as AppConfigService);
}

describe('WhatsApp authentication transport', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts an approved authentication copy-code template to the fixed Meta origin', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), { status: 200 }),
      );
    await adapter().sendCode('+966500000001', '012345');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://graph.facebook.com/v27.0/123456789/messages');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({
      authorization: 'Bearer test-token-never-logged',
      'content-type': 'application/json',
    });
    const body = JSON.parse(String(init?.body));
    expect(body.to).toBe('966500000001');
    expect(body.template.language.code).toBe('ar');
    expect(body.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '012345' }] },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: '012345' }],
      },
    ]);
  });

  it.each([
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_GRAPH_API_VERSION',
    'WHATSAPP_AUTH_TEMPLATE_NAME',
    'WHATSAPP_AUTH_TEMPLATE_LANGUAGE',
    'WHATSAPP_AUTH_TEMPLATE_APPROVED',
  ])('fails closed before network access when %s is missing', async (key) => {
    const fetcher = jest.spyOn(globalThis, 'fetch');
    const transport = adapter({ [key]: undefined });
    expect(transport.isConfigured()).toBe(false);
    await expect(transport.sendCode('+966500000001', '012345')).rejects.toMatchObject({
      code: 'EAUTH',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['0500000001', '012345'],
    ['+966500000001', '12345'],
    ['+966500000001', 'secret'],
  ])('rejects invalid recipient/code inputs before sending', async (destination, code) => {
    const fetcher = jest.spyOn(globalThis, 'fetch');
    await expect(adapter().sendCode(destination!, code!)).rejects.toMatchObject({
      code: 'EENVELOPE',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'EENVELOPE'],
    [401, 'EAUTH'],
    [403, 'EAUTH'],
    [429, 'ECONNECTION'],
    [503, 'ECONNECTION'],
  ])('classifies HTTP %s without exposing provider response text', async (status, code) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('secret recipient token data', { status: Number(status) }));
    await expect(adapter().sendCode('+966500000001', '012345')).rejects.toMatchObject({
      code,
      message: 'WhatsApp authentication delivery failed',
    });
  });

  it('does not claim acceptance for an empty provider response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(adapter().sendCode('+966500000001', '012345')).rejects.toMatchObject({
      code: 'ECONNECTION',
    });
  });
});
