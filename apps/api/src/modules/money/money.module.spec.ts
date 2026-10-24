import 'reflect-metadata';
import {
  MoneyRailConfiguration,
  MoneyCollectionRouter,
  MoneyRefundRouter,
} from './runtime/money-rail-router';
import { ApprovedRefundPolicySource } from './runtime/approved-refund-policy.source';
import { ApprovedRefundParticipant } from './runtime/approved-refund.participant';
import { StripeSessionController } from './runtime/stripe-session.controller';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { MoneyController, MoneyReviewController } from './api/money.controller';
import { MoneyCommandService } from './application/money-command.service';
import { MoneyQueryService } from './application/money-query.service';
import { LedgerService } from './ledger/ledger.service';
import { LedgerModule } from './ledger/ledger.module';
import { SubscriptionActivationService } from './domain/subscription-activation.service';
import { MoneyModule } from './money.module';
import { ManualReviewModule } from './manual-review/manual-review.module';
import { ManualRailConfiguration } from './adapters/manual/manual-rail.config';
import { ManualCollectionAdapter } from './adapters/manual/manual-collection.adapter';
import { ManualRefundAdapter } from './adapters/manual/manual-refund.adapter';
import { ReceiptAcceptanceParticipant } from './manual-review/receipt-acceptance.participant';
import {
  ManualPaymentController,
  ManualReceiptReadController,
  ManualFinanceReviewController,
} from './manual-review/manual-review.controller';
import type { PrismaTx } from '@homeservicemarketplace/database';
import type { MoneyTransportBinding } from './ports/collection.port';
import { MONEY_ACTIVATION_PARTICIPANT } from './ports/activation.port';
import { SubscriptionActivationParticipant } from './subscriptions/subscription-activation.participant';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import {
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  MONEY_RECEIPT_ACCEPTANCE,
} from './ports/collection.port';
import { MONEY_FINANCE_READ } from './ports/finance-read.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_CONFIRMATION_PARTICIPANT,
  MONEY_REFUND_POLICY,
} from './ports/refund.port';
import { REFUND_POLICY_SOURCE, RefundEligibilityPolicy } from './refunds/refund-eligibility.policy';

// This unit suite checks composition metadata and unavailable providers. The
// dedicated HTTP suite boots the real AppModule with its actual validation.
jest.mock('../../config/config.module', () => ({ ConfigModule: class ConfigModule {} }));

const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, MoneyModule) as Array<
  | {
      provide?: unknown;
      useClass?: new () => Record<string, (...args: never[]) => unknown>;
      useExisting?: unknown;
    }
  | unknown
>;

describe('R24/R31 MoneyModule composition and unavailable external defaults', () => {
  it('imports and exports the existing ledger once without creating another posting authority', () => {
    expect(
      (Reflect.getMetadata(MODULE_METADATA.IMPORTS, MoneyModule) as unknown[]).filter(
        (entry) => entry === LedgerModule,
      ),
    ).toHaveLength(1);
    expect(
      (Reflect.getMetadata(MODULE_METADATA.EXPORTS, MoneyModule) as unknown[]).filter(
        (entry) => entry === LedgerModule,
      ),
    ).toHaveLength(1);
    expect(providers).not.toContain(LedgerService);
    expect(providers).not.toContain(SubscriptionActivationService);
    expect(providers).toEqual(expect.arrayContaining([MoneyCommandService, MoneyQueryService]));
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, MoneyModule)).toEqual([
      StripeSessionController,
      MoneyController,
      MoneyReviewController,
      ManualPaymentController,
      ManualReceiptReadController,
      ManualFinanceReviewController,
    ]);
  });

  it('exports one finance read implementation rather than a second ledger projection authority', () => {
    expect(providers).toContainEqual({
      provide: MONEY_FINANCE_READ,
      useExisting: MoneyQueryService,
    });
  });

  it('contains no configured purchase binding by default', async () => {
    const tx = { moneyManualInstructionVersion: { findMany: jest.fn().mockResolvedValue([]) } };
    await expect(
      new ManualRailConfiguration().resolve(
        { planVersionId: 'absent-plan', method: 'SHAM_CASH' },
        tx as unknown as PrismaTx,
      ),
    ).resolves.toBeNull();
    expect(tx.moneyManualInstructionVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { planVersionId: 'absent-plan', method: 'SHAM_CASH', enabled: true },
      }),
    );
  });

  it('reuses exactly one manual participant per port through the reviewed module', () => {
    expect(
      (Reflect.getMetadata(MODULE_METADATA.IMPORTS, MoneyModule) as unknown[]).filter(
        (entry) => entry === ManualReviewModule,
      ),
    ).toHaveLength(1);
    for (const [provide, useExisting] of [
      [MONEY_CONFIGURATION, MoneyRailConfiguration],
      [MONEY_COLLECTION_ADAPTER, MoneyCollectionRouter],
      [MONEY_RECEIPT_ACCEPTANCE, ReceiptAcceptanceParticipant],
      [MONEY_REFUND_ADAPTER, MoneyRefundRouter],
    ]) {
      expect(
        providers.filter(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            'provide' in entry &&
            entry.provide === provide,
        ),
      ).toEqual([{ provide, useExisting }]);
    }
  });

  it('binds exactly one real R31 participant from its owning module', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, MoneyModule)).toContain(
      SubscriptionsModule,
    );
    expect(
      providers.filter(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          'provide' in entry &&
          entry.provide === MONEY_ACTIVATION_PARTICIPANT,
      ),
    ).toEqual([
      { provide: MONEY_ACTIVATION_PARTICIPANT, useExisting: SubscriptionActivationParticipant },
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, SubscriptionsModule)).toContain(
      SubscriptionActivationParticipant,
    );
    expect(providers).not.toContain(SubscriptionActivationParticipant);
  });

  it.each([
    [MONEY_COLLECTION_ADAPTER, ManualCollectionAdapter],
    [MONEY_RECEIPT_ACCEPTANCE, ReceiptAcceptanceParticipant],
    [MONEY_REFUND_ADAPTER, ManualRefundAdapter],
  ] as const)(
    'keeps the mounted manual participant %s unavailable to live or non-manual bindings',
    (token, implementation) => {
      expect(providers).toContainEqual({
        provide: token,
        useExisting:
          token === MONEY_COLLECTION_ADAPTER
            ? MoneyCollectionRouter
            : token === MONEY_REFUND_ADAPTER
              ? MoneyRefundRouter
              : implementation,
      });
      const binding: MoneyTransportBinding = {
        planVersionId: 'plan',
        method: 'SHAM_CASH',
        currency: 'XTS',
        mode: 'LIVE',
        adapterId: 'hsm.manual.v1',
        accountReference: 'synthetic-account',
        configVersion: 'synthetic-v1',
        debitAccountId: 'clearing',
        creditAccountId: 'revenue',
      };
      expect(implementation.prototype.isConfigured(binding)).toBe(false);
      expect(
        implementation.prototype.isConfigured({ ...binding, mode: 'SANDBOX', method: 'STRIPE' }),
      ).toBe(false);
    },
  );

  it('has no implicit refund eligibility policy', async () => {
    expect(providers).toContain(RefundEligibilityPolicy);
    expect(
      providers.filter(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          'provide' in entry &&
          entry.provide === MONEY_REFUND_POLICY,
      ),
    ).toEqual([{ provide: MONEY_REFUND_POLICY, useExisting: RefundEligibilityPolicy }]);
    expect(providers).toContainEqual({
      provide: REFUND_POLICY_SOURCE,
      useExisting: ApprovedRefundPolicySource,
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ now: new Date() }]),
      moneyApprovedRefundPolicy: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await expect(
      new ApprovedRefundPolicySource().resolve(
        { planVersionId: 'plan', method: 'STRIPE', currency: 'XTS', mode: 'SANDBOX' },
        tx as unknown as PrismaTx,
      ),
    ).resolves.toBeNull();
  });

  it('exports one transaction-bound confirmed refund participant with no implicit policy', () => {
    expect(
      (Reflect.getMetadata(MODULE_METADATA.EXPORTS, MoneyModule) as unknown[]).filter(
        (entry) => entry === MONEY_REFUND_CONFIRMATION_PARTICIPANT,
      ),
    ).toHaveLength(1);
    expect(providers).toContainEqual({
      provide: MONEY_REFUND_CONFIRMATION_PARTICIPANT,
      useExisting: ApprovedRefundParticipant,
    });
  });
});
