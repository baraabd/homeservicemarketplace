import { Module } from '@nestjs/common';

import { AuditModule } from '../iam/audit/audit.module';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { MoneyController, MoneyReviewController } from './api/money.controller';
import { MoneyCommandService } from './application/money-command.service';
import { MoneyQueryService } from './application/money-query.service';
import { LedgerModule } from './ledger/ledger.module';
import {
  MONEY_ACTIVATION_PARTICIPANT,
  UnavailableMoneyActivationParticipant,
} from './ports/activation.port';
import {
  MONEY_CATALOG,
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  MONEY_RECEIPT_ACCEPTANCE,
  PrismaMoneyCatalogFactory,
  UnavailableMoneyCollectionAdapter,
  UnavailableMoneyConfiguration,
  UnavailableMoneyReceiptAcceptance,
} from './ports/collection.port';
import { MONEY_FINANCE_READ } from './ports/finance-read.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_POLICY,
  UnavailableMoneyRefundAdapter,
  UnavailableMoneyRefundPolicy,
} from './ports/refund.port';

// One composition boundary. R29–R32 must provide reviewed, configured
// participants through these exact tokens. Default providers are unavailable;
// booting the module grants no money permission and enables no payment rail.
@Module({
  imports: [AuthenticationModule, AuthorizationModule, AuditModule, LedgerModule],
  controllers: [MoneyController, MoneyReviewController],
  providers: [
    MoneyCommandService,
    MoneyQueryService,
    { provide: MONEY_CONFIGURATION, useClass: UnavailableMoneyConfiguration },
    { provide: MONEY_CATALOG, useClass: PrismaMoneyCatalogFactory },
    { provide: MONEY_COLLECTION_ADAPTER, useClass: UnavailableMoneyCollectionAdapter },
    { provide: MONEY_RECEIPT_ACCEPTANCE, useClass: UnavailableMoneyReceiptAcceptance },
    { provide: MONEY_ACTIVATION_PARTICIPANT, useClass: UnavailableMoneyActivationParticipant },
    { provide: MONEY_REFUND_POLICY, useClass: UnavailableMoneyRefundPolicy },
    { provide: MONEY_REFUND_ADAPTER, useClass: UnavailableMoneyRefundAdapter },
    { provide: MONEY_FINANCE_READ, useExisting: MoneyQueryService },
  ],
  exports: [
    LedgerModule,
    MoneyCommandService,
    MoneyQueryService,
    MONEY_CONFIGURATION,
    MONEY_CATALOG,
    MONEY_COLLECTION_ADAPTER,
    MONEY_RECEIPT_ACCEPTANCE,
    MONEY_ACTIVATION_PARTICIPANT,
    MONEY_REFUND_POLICY,
    MONEY_REFUND_ADAPTER,
    MONEY_FINANCE_READ,
  ],
})
export class MoneyModule {}
