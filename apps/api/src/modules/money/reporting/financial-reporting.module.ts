import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../../iam/authentication/authentication.module';
import { AuthorizationModule } from '../../iam/authorization/authorization.module';
import { MoneyModule } from '../money.module';
import { FinancialExportService } from './financial-export.service';
import {
  FinancialReportController,
  ProviderFinancialHistoryController,
} from './financial-report.controller';
import {
  FINANCIAL_RECONCILIATION_STATUS,
  FinancialReportService,
  UnavailableFinancialReconciliationStatus,
} from './financial-report.service';

@Module({
  imports: [AuthenticationModule, AuthorizationModule, MoneyModule],
  controllers: [FinancialReportController, ProviderFinancialHistoryController],
  providers: [
    FinancialReportService,
    FinancialExportService,
    {
      provide: FINANCIAL_RECONCILIATION_STATUS,
      useClass: UnavailableFinancialReconciliationStatus,
    },
  ],
  exports: [FinancialReportService, FINANCIAL_RECONCILIATION_STATUS],
})
export class FinancialReportingModule {}
