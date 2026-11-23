import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { MoneyCommandService } from '../../application/money-command.service';
import { StripeSandboxConfiguration } from '../../adapters/stripe/stripe-sandbox.config';
import { StripeCollectionAdapter } from '../../adapters/stripe/stripe-collection.adapter';
import { StripeRefundAdapter } from '../../adapters/stripe/stripe-refund.adapter';
import { StripeTransportModule, StripeWebhookModule } from './stripe-webhook.module';
import { StripeInboxJob } from './stripe-inbox.job';
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: MoneyCommandService, useValue: {} },
  ],
  exports: [PrismaService, MoneyCommandService],
})
class DependencyDouble {}
describe('R29 non-circular explicit module composition', () => {
  it('boots disabled without SDK, credentials, network or implicit financial providers', async () => {
    const configuration = new StripeSandboxConfiguration();
    const transport = StripeTransportModule.register({
      imports: [DependencyDouble],
      configuration,
    });
    const test = await Test.createTestingModule({
      imports: [StripeWebhookModule.register({ imports: [DependencyDouble, transport] })],
    }).compile();
    expect(test.get(StripeSandboxConfiguration)).toBe(configuration);
    expect(test.get(StripeCollectionAdapter)).toBeInstanceOf(StripeCollectionAdapter);
    expect(test.get(StripeRefundAdapter)).toBeInstanceOf(StripeRefundAdapter);
    expect(await test.get(StripeInboxJob).runBatch()).toEqual({ processed: 0, pending: 0 });
    await test.close();
  });
  it('keeps ingress separate from transport to avoid MoneyModule cycles', () => {
    const transport = StripeTransportModule.register({
      imports: [],
      configuration: new StripeSandboxConfiguration(),
    });
    expect(transport.controllers).toBeUndefined();
    expect(transport.providers).not.toContain(MoneyCommandService);
    expect(StripeWebhookModule.register({ imports: [] }).exports).toEqual([StripeInboxJob]);
  });
});
