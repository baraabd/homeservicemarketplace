import { Module } from '@nestjs/common';
import Stripe from 'stripe';
import { AppConfigService } from '../../../config/app-config.service';
import { ConfigModule } from '../../../config/config.module';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { StripeSandboxConfiguration, stripeError } from '../adapters/stripe/stripe-sandbox.config';
import type { StripeConstructor } from '../adapters/stripe/stripe-sdk';
import { StripeTransportModule } from '../webhooks/stripe/stripe-webhook.module';

export function stripeRuntimeConfiguration(config: AppConfigService): StripeSandboxConfiguration {
  const json = config.get('MONEY_STRIPE_SANDBOX_JSON');
  if (!json) return new StripeSandboxConfiguration();
  try {
    return new StripeSandboxConfiguration(JSON.parse(json));
  } catch {
    throw stripeError('STRIPE_CONFIGURATION_INVALID');
  }
}
@Module({
  imports: [
    StripeTransportModule.registerAsync({
      imports: [ConfigModule, PrismaModule],
      inject: [AppConfigService],
      configuration: stripeRuntimeConfiguration,
      sdk: Stripe as unknown as StripeConstructor,
    }),
  ],
  exports: [StripeTransportModule],
})
export class StripeRuntimeModule {}
