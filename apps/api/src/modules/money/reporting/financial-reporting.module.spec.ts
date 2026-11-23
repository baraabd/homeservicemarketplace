import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { MoneyModule } from '../money.module';
import { MoneyQueryService } from '../application/money-query.service';
import { MONEY_FINANCE_READ } from '../ports/finance-read.port';
import {
  FinancialReportController,
  ProviderFinancialHistoryController,
} from './financial-report.controller';
import {
  FINANCIAL_RECONCILIATION_STATUS,
  FinancialReportService,
  UnavailableFinancialReconciliationStatus,
} from './financial-report.service';
import { FinancialReportingModule } from './financial-reporting.module';

jest.mock('../../../config/config.module', () => ({ ConfigModule: class ConfigModule {} }));

describe('R33 reporting composition', () => {
  it('consumes the existing money authority once and never replaces the finance token', () => {
    expect(
      (Reflect.getMetadata(MODULE_METADATA.IMPORTS, FinancialReportingModule) as unknown[]).filter(
        (value) => value === MoneyModule,
      ),
    ).toHaveLength(1);
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      FinancialReportingModule,
    ) as unknown[];
    expect(providers).toContain(FinancialReportService);
    expect(providers).not.toContain(MoneyQueryService);
    expect(providers).not.toContainEqual(expect.objectContaining({ provide: MONEY_FINANCE_READ }));
    expect(providers).toContainEqual({
      provide: FINANCIAL_RECONCILIATION_STATUS,
      useClass: UnavailableFinancialReconciliationStatus,
    });
  });
  it('mounts admin and provider reads separately without a write controller', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, FinancialReportingModule)).toEqual([
      FinancialReportController,
      ProviderFinancialHistoryController,
    ]);
  });
  it('cannot report a reconciliation success before R34 supplies run provenance', async () => {
    await expect(new UnavailableFinancialReconciliationStatus().status()).resolves.toEqual({
      state: 'UNAVAILABLE',
      lastSuccessAt: null,
      runId: null,
      reason: 'R34_INTEGRATION_PENDING',
    });
  });
});
