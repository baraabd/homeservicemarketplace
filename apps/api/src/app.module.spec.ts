import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from './app.module';
import { LedgerModule } from './modules/money/ledger/ledger.module';
import { MoneyModule } from './modules/money/money.module';
import { RefundsModule } from './modules/money/refunds/refunds.module';
import { RefundOutboxConsumer } from './modules/money/recovery/refund-outbox.consumer';
import { OutboxModule } from './infrastructure/outbox/outbox.module';
import { OUTBOX_HANDLERS } from './infrastructure/outbox/outbox.tokens';
import { SupportModule } from './modules/support/support.module';
import { AdminSupportController, SupportController } from './modules/support/support.controller';

// ConfigModule validates process.env when imported. Module registration is
// independent of environment configuration, so keep this check hermetic while
// retaining the actual application, support and ledger module metadata.
jest.mock('./config/config.module', () => ({
  ConfigModule: class ConfigModule {},
}));

describe('AppModule feature registration', () => {
  it('registers one refund outbox consumer with its existing financial module', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    expect(imports.filter((entry) => entry === RefundsModule)).toHaveLength(1);
    const outbox = imports.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'module' in entry &&
        entry.module === OutboxModule,
    ) as { imports: unknown[]; providers: Array<{ provide?: unknown; inject?: unknown[] }> };
    expect(outbox.imports).toContain(RefundsModule);
    const registry = outbox.providers.find((entry) => entry.provide === OUTBOX_HANDLERS);
    expect(registry?.inject?.filter((entry) => entry === RefundOutboxConsumer)).toHaveLength(1);
  });
  it('keeps support routes mounted alongside the ledger foundation', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    const supportControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      SupportModule,
    ) as unknown[];

    expect(imports.filter((entry) => entry === SupportModule)).toHaveLength(1);
    expect(imports.filter((entry) => entry === MoneyModule)).toHaveLength(1);
    expect(imports.filter((entry) => entry === LedgerModule)).toHaveLength(0);
    const moneyImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, MoneyModule) as unknown[];
    expect(moneyImports.filter((entry) => entry === LedgerModule)).toHaveLength(1);
    const moneyExports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, MoneyModule) as unknown[];
    expect(moneyExports.filter((entry) => entry === LedgerModule)).toHaveLength(1);
    expect(supportControllers).toEqual(
      expect.arrayContaining([SupportController, AdminSupportController]),
    );
  });
});
