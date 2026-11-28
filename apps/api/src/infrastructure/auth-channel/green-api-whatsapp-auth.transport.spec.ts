import type { AppConfigService } from '../../config/app-config.service';
import { WhatsAppAuthAdapter, WhatsAppDeliveryError } from './whatsapp-auth.adapter';

const values: Record<string, unknown> = {
  WHATSAPP_PROVIDER: 'greenapi',
  GREEN_API_URL: 'https://7107.api.greenapi.com',
  GREEN_API_ID_INSTANCE: '7107000000',
  GREEN_API_TOKEN: 'green-test-token-not-real',
  WHATSAPP_REQUEST_TIMEOUT_MS: 1000,
};
const destination = '+966500000001';
const otp = '012345';
const base = 'https://7107.api.greenapi.com/waInstance7107000000';
const sensitiveFailure = `${base}/sendMessage/green-test-token-not-real ${destination} ${otp}`;

function adapter(overrides: Record<string, unknown> = {}) {
  return new WhatsAppAuthAdapter({
    get: (key: string) => ({ ...values, ...overrides })[key],
  } as unknown as AppConfigService);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('GREEN-API WhatsApp authentication transport', () => {
  beforeEach(() =>
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected provider request')),
  );
  afterEach(() => jest.restoreAllMocks());

  it('reports configuration locally without requiring Meta values or contacting the provider', () => {
    expect(adapter({ WHATSAPP_AUTH_TEMPLATE_APPROVED: false }).isConfigured()).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('checks sender authorization before sending a branded OTP with one timeout budget', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(jsonResponse({ idMessage: 'message-accepted' }));
    const timeout = jest.spyOn(AbortSignal, 'timeout');

    await adapter({ GREEN_API_URL: `${values.GREEN_API_URL}/` }).sendCode(destination, otp);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [stateUrl, stateInit] = fetcher.mock.calls[0]!;
    const [sendUrl, sendInit] = fetcher.mock.calls[1]!;
    expect(stateUrl).toBe(`${base}/getStateInstance/green-test-token-not-real`);
    expect(stateInit?.method).toBe('GET');
    expect(stateInit?.body).toBeUndefined();
    expect(sendUrl).toBe(`${base}/sendMessage/green-test-token-not-real`);
    expect(sendInit?.method).toBe('POST');
    expect(sendInit?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(sendInit?.body))).toEqual({
      chatId: '966500000001@c.us',
      message:
        'الخدمات المنزلية | Home Services\nرمز التحقق / Verification code: 012345\nلا تشارك هذا الرمز. Do not share this code.',
      linkPreview: false,
    });
    expect(stateInit?.redirect).toBe('error');
    expect(sendInit?.redirect).toBe('error');
    expect(stateInit?.signal).toBeInstanceOf(AbortSignal);
    expect(sendInit?.signal).toBe(stateInit?.signal);
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(1000);
  });

  it('uses the WABA template contract when an authentication template ID is configured', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(jsonResponse({ idMessage: 'template-accepted' }));
    await adapter({ GREEN_API_AUTH_TEMPLATE_ID: 'auth-template-id' }).sendCode(destination, otp);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[1]!;
    expect(url).toBe(`${base}/sendTemplate/green-test-token-not-real`);
    expect(JSON.parse(String(init?.body))).toEqual({
      chatId: '966500000001@c.us',
      templateId: 'auth-template-id',
      params: ['012345'],
    });
  });

  it('shares one state request across concurrent OTPs and briefly caches only an authorized result', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(10_000);
    let finishState!: (response: Response) => void;
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finishState = resolve;
          }),
      )
      .mockImplementation(async () => jsonResponse({ idMessage: 'message-accepted' }));
    const transport = adapter();
    const first = transport.sendCode(destination, otp);
    const second = transport.sendCode('+966500000002', '123456');
    expect(fetcher).toHaveBeenCalledTimes(1);

    finishState(jsonResponse({ stateInstance: 'authorized' }));
    await Promise.all([first, second]);
    expect(fetcher).toHaveBeenCalledTimes(3);

    clock.mockReturnValue(14_999);
    await transport.sendCode(destination, otp);
    expect(fetcher).toHaveBeenCalledTimes(4);

    clock.mockReturnValue(15_000);
    fetcher
      .mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(jsonResponse({ idMessage: 'message-after-state-refresh' }));
    await transport.sendCode(destination, otp);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls[4]![0]).toBe(`${base}/getStateInstance/green-test-token-not-real`);
  });

  it('does not cache negative authorization and can retry after the operator reconnects', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ stateInstance: 'notAuthorized' }))
      .mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(jsonResponse({ idMessage: 'message-after-reconnect' }));
    const transport = adapter();
    await expect(transport.sendCode(destination, otp)).rejects.toMatchObject({ code: 'EAUTH' });
    await transport.sendCode(destination, otp);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]![0]).toBe(`${base}/getStateInstance/green-test-token-not-real`);
  });

  it('invalidates cached sender authorization after a message request fails', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(new Response(sensitiveFailure, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(jsonResponse({ idMessage: 'message-after-recovery' }));
    const transport = adapter();
    await expect(transport.sendCode(destination, otp)).rejects.toMatchObject({ code: 'EAUTH' });
    await transport.sendCode(destination, otp);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[2]![0]).toBe(`${base}/getStateInstance/green-test-token-not-real`);
  });

  it('does not start a message request if the shared operation budget elapsed during the state check', async () => {
    const controller = new AbortController();
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const fetcher = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      controller.abort(new DOMException(sensitiveFailure, 'TimeoutError'));
      return jsonResponse({ stateInstance: 'authorized' });
    });
    await expect(adapter().sendCode(destination, otp)).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['GREEN_API_URL', 'GREEN_API_ID_INSTANCE', 'GREEN_API_TOKEN'])(
    'fails closed when %s is missing even if Meta credentials exist',
    async (key) => {
      const transport = adapter({
        [key]: undefined,
        WHATSAPP_ACCESS_TOKEN: 'meta-test-token',
        WHATSAPP_PHONE_NUMBER_ID: '123456789',
        WHATSAPP_GRAPH_API_VERSION: 'v27.0',
        WHATSAPP_AUTH_TEMPLATE_NAME: 'account_code',
        WHATSAPP_AUTH_TEMPLATE_LANGUAGE: 'ar',
        WHATSAPP_AUTH_TEMPLATE_APPROVED: true,
      });
      expect(transport.isConfigured()).toBe(false);
      await expect(transport.sendCode(destination, otp)).rejects.toMatchObject({ code: 'EAUTH' });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    'https://api.greenapi.com.attacker.example',
    'https://attacker.example',
    'http://7107.api.greenapi.com',
    'https://7107.api.greenapi.com/arbitrary-path',
    'https://user:password@7107.api.greenapi.com',
  ])('never sends the path token to an unapproved origin %s', async (origin) => {
    const transport = adapter({ GREEN_API_URL: origin });
    expect(transport.isConfigured()).toBe(false);
    await expect(transport.sendCode(destination, otp)).rejects.toMatchObject({ code: 'EAUTH' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['0500000001', otp],
    [destination, '12345'],
    [destination, '1234567'],
    [destination, 'abcdef'],
  ])('rejects invalid recipient/code before the state check', async (recipient, code) => {
    await expect(adapter().sendCode(recipient!, code!)).rejects.toMatchObject({
      code: 'EENVELOPE',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['notAuthorized', 'EAUTH'],
    ['blocked', 'EAUTH'],
    ['suspended', 'EAUTH'],
    ['yellowCard', 'EAUTH'],
    ['starting', 'ECONNECTION'],
    ['sleepMode', 'ECONNECTION'],
    ['unknown', 'ECONNECTION'],
  ])('does not enqueue an OTP when sender state is %s', async (stateInstance, code) => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ stateInstance }));
    await expect(adapter().sendCode(destination, otp)).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { stateInstance: true }, { stateInstance: ['authorized'] }])(
    'rejects a malformed authorization response without enqueueing: %j',
    async (body) => {
      const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse(body));
      await expect(adapter().sendCode(destination, otp)).rejects.toMatchObject({
        code: 'ECONNECTION',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([null, {}, { idMessage: '' }, { idMessage: '  ' }, { idMessage: 123 }])(
    'requires a nonempty provider message ID rather than accepting any 2xx response: %j',
    async (body) => {
      const fetcher = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }))
        .mockResolvedValueOnce(jsonResponse(body));
      await expect(adapter().sendCode(destination, otp)).rejects.toMatchObject({
        code: 'ECONNECTION',
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  describe.each(['state', 'send'] as const)('%s request failures', (stage) => {
    function afterState() {
      const fetcher = jest.spyOn(globalThis, 'fetch');
      if (stage === 'send')
        fetcher.mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }));
      return fetcher;
    }

    it.each([
      [400, 'ECONNECTION'],
      [401, 'EAUTH'],
      [403, 'EAUTH'],
      [404, 'EENVELOPE'],
      [408, 'ETIMEDOUT'],
      [422, 'EENVELOPE'],
      [429, 'ECONNECTION'],
      [466, 'EAUTH'],
      [499, 'ETIMEDOUT'],
      [503, 'ECONNECTION'],
    ])('classifies HTTP %s and discards token/phone/code in error bodies', async (status, code) => {
      const fetcher = afterState().mockResolvedValueOnce(
        new Response(sensitiveFailure, { status: Number(status) }),
      );
      const error = await adapter()
        .sendCode(destination, otp)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(WhatsAppDeliveryError);
      expect(error).toMatchObject({ code, message: 'WhatsApp authentication delivery failed' });
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain(sensitiveFailure);
      expect(fetcher).toHaveBeenCalledTimes(stage === 'state' ? 1 : 2);
    });

    it('replaces a network error containing the secret request URL', async () => {
      afterState().mockRejectedValueOnce(new Error(sensitiveFailure));
      const error = await adapter()
        .sendCode(destination, otp)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(WhatsAppDeliveryError);
      expect(error).toMatchObject({ code: 'ECONNECTION' });
      expect(String(error)).not.toContain('green-test-token-not-real');
      expect(String(error)).not.toContain(destination);
      expect(String(error)).not.toContain(otp);
      expect(error).not.toHaveProperty('cause');
    });

    it('normalizes malformed JSON responses', async () => {
      afterState().mockResolvedValueOnce(new Response(sensitiveFailure, { status: 200 }));
      await expect(adapter().sendCode(destination, otp)).rejects.toMatchObject({
        code: 'ECONNECTION',
        message: 'WhatsApp authentication delivery failed',
      });
    });

    it('classifies aborts while reading a response body as timeout without leaking its cause', async () => {
      const response = jsonResponse({});
      jest
        .spyOn(response, 'json')
        .mockRejectedValueOnce(new DOMException(sensitiveFailure, 'AbortError'));
      afterState().mockResolvedValueOnce(response);
      await expect(adapter().sendCode(destination, otp)).rejects.toMatchObject({
        code: 'ETIMEDOUT',
        message: 'WhatsApp authentication delivery failed',
      });
    });

    it('discards a response cancellation error without losing the HTTP failure class', async () => {
      const response = new Response(sensitiveFailure, { status: 401 });
      jest.spyOn(response.body!, 'cancel').mockRejectedValueOnce(new Error(sensitiveFailure));
      afterState().mockResolvedValueOnce(response);
      await expect(adapter().sendCode(destination, otp)).rejects.toMatchObject({
        code: 'EAUTH',
        message: 'WhatsApp authentication delivery failed',
      });
    });

    it('honors the configured timeout signal and does not retry inside the adapter', async () => {
      const controller = new AbortController();
      const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
      const fetcher = afterState().mockImplementationOnce(async () => {
        controller.abort(new DOMException(sensitiveFailure, 'TimeoutError'));
        throw controller.signal.reason;
      });
      await expect(adapter().sendCode(destination, otp)).rejects.toMatchObject({
        code: 'ETIMEDOUT',
      });
      expect(timeout).toHaveBeenCalledWith(1000);
      expect(fetcher).toHaveBeenCalledTimes(stage === 'state' ? 1 : 2);
    });
  });

  it('does not fall back to text or Meta when WABA rejects a template', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ stateInstance: 'authorized' }))
      .mockResolvedValueOnce(new Response(sensitiveFailure, { status: 403 }));
    await expect(
      adapter({ GREEN_API_AUTH_TEMPLATE_ID: 'auth-template-id' }).sendCode(destination, otp),
    ).rejects.toMatchObject({ code: 'EAUTH' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]![0]).toBe(`${base}/sendTemplate/green-test-token-not-real`);
  });
});
