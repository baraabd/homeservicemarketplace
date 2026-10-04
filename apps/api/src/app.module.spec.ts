import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from './app.module';
import { LedgerModule } from './modules/money/ledger/ledger.module';
import { SupportModule } from './modules/support/support.module';
import { AdminSupportController, SupportController } from './modules/support/support.controller';

// ConfigModule validates process.env when imported. Module registration is
// independent of environment configuration, so keep this check hermetic while
// retaining the actual application, support and ledger module metadata.
jest.mock('./config/config.module', () => ({
  ConfigModule: class ConfigModule {},
}));

describe('AppModule feature registration', () => {
  it('keeps support routes mounted alongside the ledger foundation', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    const supportControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      SupportModule,
    ) as unknown[];

    expect(imports).toContain(SupportModule);
    expect(imports).toContain(LedgerModule);
    expect(supportControllers).toEqual(
      expect.arrayContaining([SupportController, AdminSupportController]),
    );
  });
});
