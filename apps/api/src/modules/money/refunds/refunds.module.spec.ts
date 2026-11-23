import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { MoneyCommandService } from '../application/money-command.service';
import { MoneyModule } from '../money.module';
import { RefundOutboxConsumer } from '../recovery/refund-outbox.consumer';
import { RefundRecoveryService } from '../recovery/refund-recovery.service';
import { RefundOrchestratorService } from './refund-orchestrator.service';
import { RefundController } from './refund.controller';
import { RefundsModule } from './refunds.module';

jest.mock('../../../config/config.module', () => ({ ConfigModule: class ConfigModule {} }));

describe('R32 composition boundary', () => {
  it('reuses the money authority and exposes only the scoped operator controller', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, RefundsModule)).toContain(MoneyModule);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, RefundsModule)).toEqual([
      RefundController,
    ]);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, RefundsModule) as unknown[];
    expect(providers.filter((entry) => entry === RefundOrchestratorService)).toHaveLength(1);
    expect(providers).toContain(RefundRecoveryService);
    expect(providers).not.toContain(MoneyCommandService);
    // The infrastructure composition provides the handler once; no duplicate
    // lifecycle loop is created by contributing it through this module.
    expect(providers).not.toContain(RefundOutboxConsumer);
  });
});
