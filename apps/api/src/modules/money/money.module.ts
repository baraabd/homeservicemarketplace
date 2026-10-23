import { Module } from '@nestjs/common';

import { AuditModule } from '../iam/audit/audit.module';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { MoneyController, MoneyReviewController } from './api/money.controller';
import { MoneyCommandService } from './application/money-command.service';
import { MoneyQueryService } from './application/money-query.service';
import { LedgerModule } from './ledger/ledger.module';
import { ManualRailConfiguration } from './adapters/manual/manual-rail.config';
import { ManualCollectionAdapter } from './adapters/manual/manual-collection.adapter';
import { ManualRefundAdapter } from './adapters/manual/manual-refund.adapter';
import { ManualReviewModule } from './manual-review/manual-review.module';
import {
  ManualPaymentController,
  ManualReceiptReadController,
  ManualFinanceReviewController,
} from './manual-review/manual-review.controller';
import { ReceiptAcceptanceParticipant } from './manual-review/receipt-acceptance.participant';
import { ManualEventProcessingJob } from './manual-review/manual-event-processing.job';
import { MONEY_ACTIVATION_PARTICIPANT } from './ports/activation.port';
import { SubscriptionActivationParticipant } from './subscriptions/subscription-activation.participant';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import {
  MONEY_CATALOG,
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  MONEY_RECEIPT_ACCEPTANCE,
  PrismaMoneyCatalogFactory,
} from './ports/collection.port';
import { MONEY_FINANCE_READ } from './ports/finance-read.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_CONFIRMATION_PARTICIPANT,
  MONEY_REFUND_POLICY,
  UnavailableMoneyRefundConfirmationParticipant,
} from './ports/refund.port';
import {
  REFUND_POLICY_SOURCE,
  RefundEligibilityPolicy,
  UnavailableRefundPolicySource,
} from './refunds/refund-eligibility.policy';

// One composition boundary. R30 provides sandbox-only manual transports through
// the existing R24 ports; R31 supplies the transaction-bound activation participant.
// No instruction, permission grant, activation policy or
// refund policy is created by module boot; every live rail remains unavailable.
@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    AuditModule,
    LedgerModule,
    ManualReviewModule,
    SubscriptionsModule,
  ],
  controllers: [
    MoneyController,
    MoneyReviewController,
    ManualPaymentController,
    ManualReceiptReadController,
    ManualFinanceReviewController,
  ],
  providers: [
    MoneyCommandService,
    MoneyQueryService,
    ManualEventProcessingJob,
    { provide: MONEY_CONFIGURATION, useExisting: ManualRailConfiguration },
    { provide: MONEY_CATALOG, useClass: PrismaMoneyCatalogFactory },
    { provide: MONEY_COLLECTION_ADAPTER, useExisting: ManualCollectionAdapter },
    { provide: MONEY_RECEIPT_ACCEPTANCE, useExisting: ReceiptAcceptanceParticipant },
    { provide: REFUND_POLICY_SOURCE, useClass: UnavailableRefundPolicySource },
    RefundEligibilityPolicy,
    { provide: MONEY_REFUND_POLICY, useExisting: RefundEligibilityPolicy },
    { provide: MONEY_ACTIVATION_PARTICIPANT, useExisting: SubscriptionActivationParticipant },
    { provide: MONEY_REFUND_ADAPTER, useExisting: ManualRefundAdapter },
    {
      provide: MONEY_REFUND_CONFIRMATION_PARTICIPANT,
      useClass: UnavailableMoneyRefundConfirmationParticipant,
    },
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
    REFUND_POLICY_SOURCE,
    MONEY_REFUND_ADAPTER,
    MONEY_REFUND_CONFIRMATION_PARTICIPANT,
    MONEY_FINANCE_READ,
  ],
})
export class MoneyModule {}
