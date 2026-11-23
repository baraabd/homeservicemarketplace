import { Module } from '@nestjs/common';
import { StripeSessionService } from './runtime/stripe-session.service';
import { StripeSessionController } from './runtime/stripe-session.controller';
import { ApprovedRefundPolicySource } from './runtime/approved-refund-policy.source';
import { ApprovedRefundParticipant } from './runtime/approved-refund.participant';
import { StripeRuntimeModule } from './runtime/stripe-runtime.module';
import {
  MoneyRailConfiguration,
  MoneyCollectionRouter,
  MoneyRefundRouter,
} from './runtime/money-rail-router';

import { AuditModule } from '../iam/audit/audit.module';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { MoneyController, MoneyReviewController } from './api/money.controller';
import { MoneyCommandService } from './application/money-command.service';
import { MoneyQueryService } from './application/money-query.service';
import { LedgerModule } from './ledger/ledger.module';
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
} from './ports/refund.port';
import { REFUND_POLICY_SOURCE, RefundEligibilityPolicy } from './refunds/refund-eligibility.policy';

// One composition boundary. G3 routes accepted Stripe/manual transports through
// the existing R24 ports; R31 supplies transaction-bound activation/refund effects.
// No instruction, permission grant, activation policy or
// refund policy is created by module boot; every live rail remains unavailable.
@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    AuditModule,
    LedgerModule,
    ManualReviewModule,
    StripeRuntimeModule,
    SubscriptionsModule,
  ],
  controllers: [
    StripeSessionController,
    MoneyController,
    MoneyReviewController,
    ManualPaymentController,
    ManualReceiptReadController,
    ManualFinanceReviewController,
  ],
  providers: [
    StripeSessionService,
    MoneyCommandService,
    MoneyQueryService,
    ManualEventProcessingJob,
    MoneyRailConfiguration,
    MoneyCollectionRouter,
    MoneyRefundRouter,
    ApprovedRefundPolicySource,
    ApprovedRefundParticipant,
    { provide: MONEY_CONFIGURATION, useExisting: MoneyRailConfiguration },
    { provide: MONEY_CATALOG, useClass: PrismaMoneyCatalogFactory },
    { provide: MONEY_COLLECTION_ADAPTER, useExisting: MoneyCollectionRouter },
    { provide: MONEY_RECEIPT_ACCEPTANCE, useExisting: ReceiptAcceptanceParticipant },
    { provide: REFUND_POLICY_SOURCE, useExisting: ApprovedRefundPolicySource },
    RefundEligibilityPolicy,
    { provide: MONEY_REFUND_POLICY, useExisting: RefundEligibilityPolicy },
    { provide: MONEY_ACTIVATION_PARTICIPANT, useExisting: SubscriptionActivationParticipant },
    { provide: MONEY_REFUND_ADAPTER, useExisting: MoneyRefundRouter },
    {
      provide: MONEY_REFUND_CONFIRMATION_PARTICIPANT,
      useExisting: ApprovedRefundParticipant,
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
