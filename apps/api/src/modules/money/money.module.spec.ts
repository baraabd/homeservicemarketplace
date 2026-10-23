import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { MoneyController, MoneyReviewController } from './api/money.controller';
import { MoneyCommandService } from './application/money-command.service';
import { MoneyQueryService } from './application/money-query.service';
import { LedgerService } from './ledger/ledger.service';
import { LedgerModule } from './ledger/ledger.module';
import { SubscriptionActivationService } from './domain/subscription-activation.service';
import { MoneyModule } from './money.module';
import { MONEY_ACTIVATION_PARTICIPANT } from './ports/activation.port';
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

function configuredProvider(token: symbol) {
  const matches = providers.filter(
    (
      entry,
    ): entry is {
      provide: symbol;
      useClass: new () => Record<string, (...args: never[]) => unknown>;
    } =>
      typeof entry === 'object' && entry !== null && 'provide' in entry && entry.provide === token,
  );
  expect(matches).toHaveLength(1);
  return new matches[0]!.useClass();
}

describe('R24 MoneyModule composition and unavailable defaults', () => {
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
      MoneyController,
      MoneyReviewController,
    ]);
  });

  it('exports one finance read implementation rather than a second ledger projection authority', () => {
    expect(providers).toContainEqual({
      provide: MONEY_FINANCE_READ,
      useExisting: MoneyQueryService,
    });
  });

  it('contains no configured purchase binding by default', async () => {
    await expect(configuredProvider(MONEY_CONFIGURATION).resolve()).resolves.toBeNull();
  });

  it.each([
    [MONEY_COLLECTION_ADAPTER, 'createOrResume', 'MONEY_COLLECTION_UNAVAILABLE'],
    [MONEY_RECEIPT_ACCEPTANCE, 'accept', 'MONEY_RECEIPT_UNAVAILABLE'],
    [MONEY_ACTIVATION_PARTICIPANT, 'activatePeriod', 'MONEY_ACTIVATION_UNAVAILABLE'],
    [MONEY_REFUND_ADAPTER, 'submit', 'MONEY_REFUND_ADAPTER_UNAVAILABLE'],
  ] as const)(
    'never reports a configured or successful default for %s',
    async (token, method, reason) => {
      const port = configuredProvider(token);
      expect(port.isConfigured()).toBe(false);
      await expect(port[method]()).rejects.toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        status: 503,
        details: { reason },
      });
    },
  );

  it('has no implicit refund eligibility policy', async () => {
    expect(providers).toContain(RefundEligibilityPolicy);
    expect(providers).toContainEqual({
      provide: MONEY_REFUND_POLICY,
      useExisting: RefundEligibilityPolicy,
    });
    await expect(configuredProvider(REFUND_POLICY_SOURCE).resolve()).resolves.toBeNull();
  });

  it('exports one unavailable G2 confirmed-refund participant without applying a consequence', async () => {
    expect(
      (Reflect.getMetadata(MODULE_METADATA.EXPORTS, MoneyModule) as unknown[]).filter(
        (entry) => entry === MONEY_REFUND_CONFIRMATION_PARTICIPANT,
      ),
    ).toHaveLength(1);
    const participant = configuredProvider(MONEY_REFUND_CONFIRMATION_PARTICIPANT);
    expect(participant.isConfigured()).toBe(false);
    await expect(participant.applyConfirmedRefund()).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      status: 503,
      details: { reason: 'MONEY_REFUND_POLICY_UNAVAILABLE' },
    });
  });
});
