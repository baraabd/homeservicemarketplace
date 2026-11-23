import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type Provider,
  type FactoryProvider,
} from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { MoneyCommandService } from '../../application/money-command.service';
import { StripeBindings } from '../../adapters/stripe/stripe-bindings';
import { StripeCollectionAdapter } from '../../adapters/stripe/stripe-collection.adapter';
import { StripeRefundAdapter } from '../../adapters/stripe/stripe-refund.adapter';
import { StripeSandboxConfiguration } from '../../adapters/stripe/stripe-sandbox.config';
import { StripeSdk, type StripeConstructor } from '../../adapters/stripe/stripe-sdk';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { StripeInboxJob } from './stripe-inbox.job';

/** Explicit composition, with no import of a peer implementation. Coordinator
 * supplies accepted MoneyModule/Prisma exports and one SDK/configuration factory.
 * Do not import this into MoneyModule itself: that would create a cycle. */
@Module({})
export class StripeTransportModule {
  static register(options: {
    imports: NonNullable<ModuleMetadata['imports']>;
    configuration: StripeSandboxConfiguration;
    sdk?: StripeConstructor;
  }): DynamicModule {
    return this.compose(
      options.imports,
      { provide: StripeSandboxConfiguration, useValue: options.configuration },
      options.sdk,
    );
  }

  static registerAsync(options: {
    imports: NonNullable<ModuleMetadata['imports']>;
    inject: FactoryProvider['inject'];
    configuration: (...args: never[]) => StripeSandboxConfiguration;
    sdk: StripeConstructor;
  }): DynamicModule {
    return this.compose(
      options.imports,
      {
        provide: StripeSandboxConfiguration,
        inject: options.inject,
        useFactory: options.configuration,
      },
      options.sdk,
    );
  }

  private static compose(
    imports: NonNullable<ModuleMetadata['imports']>,
    configuration: Provider,
    sdk?: StripeConstructor,
  ): DynamicModule {
    return {
      module: StripeTransportModule,
      imports,
      providers: [
        configuration,
        {
          provide: StripeSdk,
          inject: [StripeSandboxConfiguration],
          useFactory: (config: StripeSandboxConfiguration) => new StripeSdk(config, sdk),
        },
        {
          provide: StripeBindings,
          inject: [PrismaService],
          useFactory: (prisma: PrismaService) => new StripeBindings(prisma),
        },
        {
          provide: StripeCollectionAdapter,
          inject: [StripeSandboxConfiguration, StripeSdk, StripeBindings],
          useFactory: (
            config: StripeSandboxConfiguration,
            sdk: StripeSdk,
            bindings: StripeBindings,
          ) => new StripeCollectionAdapter(config, sdk, bindings),
        },
        {
          provide: StripeRefundAdapter,
          inject: [StripeSandboxConfiguration, StripeSdk, StripeBindings],
          useFactory: (
            config: StripeSandboxConfiguration,
            sdk: StripeSdk,
            bindings: StripeBindings,
          ) => new StripeRefundAdapter(config, sdk, bindings),
        },
      ],
      exports: [
        StripeCollectionAdapter,
        StripeRefundAdapter,
        StripeSandboxConfiguration,
        StripeSdk,
        StripeBindings,
      ],
    };
  }
}

/** Ingress imports the shared transport instance and MoneyModule. MoneyModule
 * imports only transport, so no forwardRef or duplicate financial authority. */
@Module({})
export class StripeWebhookModule {
  static register(options: { imports: NonNullable<ModuleMetadata['imports']> }): DynamicModule {
    return {
      module: StripeWebhookModule,
      imports: options.imports,
      controllers: [StripeWebhookController],
      providers: [
        {
          provide: StripeWebhookService,
          inject: [StripeSandboxConfiguration, MoneyCommandService],
          useFactory: (config: StripeSandboxConfiguration, commands: MoneyCommandService) =>
            new StripeWebhookService(config, commands),
        },
        {
          provide: StripeInboxJob,
          inject: [PrismaService, MoneyCommandService, StripeSandboxConfiguration],
          useFactory: (
            prisma: PrismaService,
            commands: MoneyCommandService,
            config: StripeSandboxConfiguration,
          ) => new StripeInboxJob(prisma, commands, config),
        },
      ],
      exports: [StripeInboxJob],
    };
  }
}
