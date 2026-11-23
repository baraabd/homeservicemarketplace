import Stripe from 'stripe';
import { AppConfigService } from '../../../config/app-config.service';
import { stripeRuntimeConfiguration } from './stripe-runtime.module';
import { STRIPE_SDK_VERSION } from '../adapters/stripe/stripe-sandbox.config';
jest.mock('../../../config/config.module', () => ({ ConfigModule: class ConfigModule {} }));
describe('G3 official SDK runtime configuration', () => {
  it('pins the installed official SDK exactly', () => {
    expect(Stripe.PACKAGE_VERSION).toBe(STRIPE_SDK_VERSION);
  });
  it('keeps all rails disabled with absent configuration', () => {
    expect(
      stripeRuntimeConfiguration({ get: () => '' } as unknown as AppConfigService).isEnabled(),
    ).toBe(false);
  });
  it.each([
    '{',
    '{"enabled":true,"secretKey":"private-sentinel"}',
    '{"enabled":true,"mode":"LIVE"}',
  ])('rejects malformed/unsupported configuration without reflecting it', (value) => {
    try {
      stripeRuntimeConfiguration({ get: () => value } as unknown as AppConfigService);
      throw new Error('accepted');
    } catch (error) {
      expect(String(error)).not.toContain('private-sentinel');
      expect(error).toMatchObject({ details: { reason: 'STRIPE_CONFIGURATION_INVALID' } });
    }
  });
});
