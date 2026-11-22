import { envSchema } from './env.schema';
import { validateEnv } from './env.validation';
import { isGreenApiOrigin } from './green-api.config';

const baseline = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'test_test_test_test_test_test_test_1234',
};

describe('WhatsApp provider configuration', () => {
  it('preserves Meta by default without inventing any sender or secret', () => {
    const config = envSchema.parse(baseline);
    expect(config.WHATSAPP_PROVIDER).toBe('meta');
    expect(config.GREEN_API_URL).toBeUndefined();
    expect(config.GREEN_API_ID_INSTANCE).toBeUndefined();
    expect(config.GREEN_API_TOKEN).toBeUndefined();
    expect(config.WHATSAPP_AUTH_TEMPLATE_APPROVED).toBe(false);
  });

  it('accepts Green API independently of Meta credentials or approval', () => {
    const config = envSchema.parse({
      ...baseline,
      WHATSAPP_PROVIDER: 'greenapi',
      GREEN_API_URL: ' https://7107.api.greenapi.com/ ',
      GREEN_API_ID_INSTANCE: ' 1234567890 ',
      GREEN_API_TOKEN: ' isolated-test-token ',
      GREEN_API_AUTH_TEMPLATE_ID: ' test-authentication-template ',
      WHATSAPP_ACCESS_TOKEN: '',
      WHATSAPP_PHONE_NUMBER_ID: ' ',
      WHATSAPP_GRAPH_API_VERSION: '',
      WHATSAPP_AUTH_TEMPLATE_NAME: '',
      WHATSAPP_AUTH_TEMPLATE_LANGUAGE: '',
    });
    expect(config.GREEN_API_URL).toBe('https://7107.api.greenapi.com/');
    expect(config.GREEN_API_ID_INSTANCE).toBe('1234567890');
    expect(config.GREEN_API_TOKEN).toBe('isolated-test-token');
    expect(config.GREEN_API_AUTH_TEMPLATE_ID).toBe('test-authentication-template');
    expect(config.WHATSAPP_ACCESS_TOKEN).toBeUndefined();
    expect(config.WHATSAPP_AUTH_TEMPLATE_APPROVED).toBe(false);
  });

  it('keeps missing settings unavailable instead of enabling preview delivery', () => {
    const config = envSchema.parse({
      ...baseline,
      WHATSAPP_PROVIDER: 'greenapi',
      GREEN_API_URL: '',
      GREEN_API_ID_INSTANCE: ' ',
      GREEN_API_TOKEN: '\t',
      GREEN_API_AUTH_TEMPLATE_ID: '',
    });
    expect(config.GREEN_API_URL).toBeUndefined();
    expect(config.GREEN_API_ID_INSTANCE).toBeUndefined();
    expect(config.GREEN_API_TOKEN).toBeUndefined();
    expect(config.GREEN_API_AUTH_TEMPLATE_ID).toBeUndefined();
  });

  it.each(['green-api', 'twilio', '', 'META'])(
    'rejects an unsupported provider: %s',
    (provider) => {
      const result = envSchema.safeParse({ ...baseline, WHATSAPP_PROVIDER: provider });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(['WHATSAPP_PROVIDER']);
    },
  );

  it.each([
    ['GREEN_API_ID_INSTANCE', '123/456'],
    ['GREEN_API_ID_INSTANCE', '1234'],
    ['GREEN_API_TOKEN', 'token/with/path'],
    ['GREEN_API_TOKEN', 'token?query=value'],
    ['GREEN_API_AUTH_TEMPLATE_ID', 'template#fragment'],
    ['WHATSAPP_REQUEST_TIMEOUT_MS', 999],
    ['WHATSAPP_REQUEST_TIMEOUT_MS', 30001],
  ])('rejects invalid %s', (key, value) => {
    const result = envSchema.safeParse({ ...baseline, [key]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual([key]);
  });

  it('does not include rejected secret-bearing URLs or tokens in validation errors', () => {
    const marker = 'private-configuration-marker';
    try {
      validateEnv({
        ...baseline,
        GREEN_API_URL: `https://api.greenapi.com/sendMessage/${marker}`,
        GREEN_API_TOKEN: `${marker}?invalid`,
      });
      throw new Error('Expected configuration validation to fail');
    } catch (error) {
      expect((error as Error).message).toContain('GREEN_API_URL');
      expect((error as Error).message).toContain('GREEN_API_TOKEN');
      expect((error as Error).message).not.toContain(marker);
    }
  });
});

describe('GREEN-API token destination', () => {
  it.each([
    'https://7107.api.greenapi.com',
    'https://7107.api.greenapi.com/',
    'https://api.greenapi.com',
    'https://api.green-api.com',
  ])('accepts the provider origin %s', (value) => {
    expect(isGreenApiOrigin(value)).toBe(true);
  });

  it.each([
    'http://7107.api.greenapi.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://api.greenapi.com.evil.invalid',
    'https://untrusted.api.greenapi.com',
    'https://api.greenapi.com@evil.invalid',
    'https://secret@api.greenapi.com',
    'https://api.greenapi.com:8443',
    'https://api.greenapi.com/sendMessage/token',
    'https://api.greenapi.com?token=secret',
    'https://api.greenapi.com#token',
    'not-a-url',
  ])('refuses credentials to %s', (value) => {
    expect(isGreenApiOrigin(value)).toBe(false);
    expect(envSchema.safeParse({ ...baseline, GREEN_API_URL: value }).success).toBe(false);
  });
});
