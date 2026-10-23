import type { PaymentIntentWireV1 } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import {
  MONEY_ACTIVATION_PARTICIPANT,
  type MoneyActivationParticipantPort,
  type MoneyPeriodActivation,
} from '../../src/modules/money/ports/activation.port';
import {
  MONEY_REFUND_POLICY,
  type MoneyRefundPolicyPort,
} from '../../src/modules/money/ports/refund.port';
import {
  MANUAL_ADAPTER_ID,
  MANUAL_METHODS,
} from '../../src/modules/money/adapters/manual/manual-rail.config';
import { LedgerService } from '../../src/modules/money/ledger/ledger.service';
import {
  R24_PERMISSIONS,
  r24MoneyHttpFixture,
  type R24HttpSession,
} from './r24-money-http.fixture';

/** Explicit transaction contract double, not the unavailable R31 entitlement
 * implementation. Its inert marker proves enlistment and rollback only. */
export class R30ActivationContractComponent implements MoneyActivationParticipantPort {
  configured = true;
  fail = false;
  isConfigured(): boolean {
    return this.configured;
  }
  async activatePeriod(input: MoneyPeriodActivation, tx: PrismaTx): Promise<void> {
    await tx.platformSetting.create({
      data: {
        key: 'it-r30-activation-contract:' + input.subscriptionPeriodId,
        value: { ...input, evidence: 'TRANSACTION_CONTRACT_ONLY' },
      },
    });
    if (this.fail) throw new Error('R30 transaction contract rollback');
  }
}

/** R32 owns production refund policy. Only a known fixture request is accepted
 * here so the real R30 transport can be exercised without inventing that policy. */
class R30RefundPolicyContractComponent implements MoneyRefundPolicyPort {
  async authorizeReservation(
    input: Parameters<MoneyRefundPolicyPort['authorizeReservation']>[0],
    tx: PrismaTx,
  ): Promise<{ policyVersion: string }> {
    const request = await tx.moneyRefundRequest.findUniqueOrThrow({
      where: { id: input.refundRequestId },
    });
    if (
      request.amountMinor.toString() !== input.amount.amountMinor ||
      request.reasonCode !== 'R30_SANDBOX_CONTRACT'
    )
      throw new Error('Unknown R30 refund fixture request');
    return { policyVersion: 'r30-test-contract-only' };
  }
}

/** Real HTTP/cookie OTP/CSRF/RBAC, migrated PostgreSQL, Redis, private storage and
 * real ClamAV. No collection, receipt, configuration or refund transport doubles.
 * All prices, instructions and settlement references are synthetic XTS data.
 * Nothing here authorizes live transfers or establishes production R31/R32. */
export async function r30ManualHttpFixture() {
  if (process.env.RUN_R30_INTEGRATION !== '1' || process.env.RUN_DB_INTEGRATION !== '1') {
    throw new Error('R30 requires explicit RUN_R30_INTEGRATION=1 and RUN_DB_INTEGRATION=1');
  }
  const activation = new R30ActivationContractComponent();
  const h = await r24MoneyHttpFixture({
    scannerDriver: 'clamav',
    isolateRateLimits: true,
    adapters: [
      { token: MONEY_ACTIVATION_PARTICIPANT, value: activation },
      { token: MONEY_REFUND_POLICY, value: new R30RefundPolicyContractComponent() },
    ],
  });
  try {
    const ledger = h.app.get(LedgerService);
    const debit = await ledger.openAccount(
      { kind: 'SYSTEM', system: 'r30.test.fixture' },
      {
        key: h.prefix + 'manual-clearing',
        ownerType: 'PLATFORM',
        currency: 'XTS',
      },
    );
    const credit = await ledger.openAccount(
      { kind: 'SYSTEM', system: 'r30.test.fixture' },
      {
        key: h.prefix + 'manual-revenue',
        ownerType: 'PLATFORM',
        currency: 'XTS',
      },
    );
    const plans: Record<'standard' | 'disabled' | 'threshold', string> = {
      standard: '',
      disabled: '',
      threshold: '',
    };
    for (const label of ['standard', 'disabled', 'threshold'] as const) {
      const plan = await h.prisma.subscriptionPlanVersion.create({
        data: {
          planKey: h.prefix + label,
          version: 1,
          billingInterval: 'MONTHLY',
          priceMinor: label === 'threshold' ? 6000n : 1000n,
          currency: 'XTS',
          entitlements: [],
          publishedAt: new Date(Date.now() - 86_400_000),
        },
      });
      plans[label] = plan.id;
      for (const method of MANUAL_METHODS) {
        await h.prisma.moneyManualInstructionVersion.create({
          data: {
            planVersionId: plan.id,
            method,
            adapterId: MANUAL_ADAPTER_ID,
            mode: 'SANDBOX',
            accountReference: 'TEST-ONLY-NO-TRANSFER-' + h.prefix + method,
            currency: 'XTS',
            debitAccountId: debit.account.id,
            creditAccountId: credit.account.id,
            configVersion: h.prefix + label + '-' + method,
            instructions: {
              en: 'SANDBOX operator simulation only. Do not transfer real money. Upload a synthetic receipt for this test obligation.',
              ar: 'محاكاة تدريبية فقط. لا تحوّل أموالاً حقيقية. ارفع إيصالاً تجريبياً لهذا الطلب.',
            },
            market: 'SYNTHETIC_TEST',
            minorUnitScale: 0,
            policyVersion: 'r30-sandbox-test-policy',
            referencePolicy: 'EXACT_TRIM',
            maxAmountMinor: 5000n,
            receiptMaxBytes: 128 * 1024,
            uploadTtlSeconds: 1800,
            quoteTtlSeconds: 3600,
            retentionDays: 7,
            validFrom: new Date(Date.now() - 86_400_000),
            validUntil: new Date(Date.now() + 86_400_000),
            approvedAt: new Date(Date.now() - 60_000),
            enabled: true,
          },
        });
      }
    }
    const admin = await h.prisma.role.findFirstOrThrow({
      where: { name: 'admin', deletedAt: null },
    });
    await h.prisma.userRole.create({
      data: { userId: h.actors.noPermission.userId, roleId: admin.id },
    });
    h.actors.noPermission.roleNames.push('admin');
    await h.grant('reviewer', R24_PERMISSIONS.receiptView);
    for (const permission of [
      R24_PERMISSIONS.review,
      R24_PERMISSIONS.receiptView,
      R24_PERMISSIONS.receiptReview,
      R24_PERMISSIONS.receiptSettlement,
      R24_PERMISSIONS.refundReview,
    ])
      await h.grant('noPermission', permission);
    const sessions = {
      owner: await h.login('owner'),
      reviewer: await h.login('reviewer'),
      recorder: await h.login('noPermission'),
      outsider: await h.login('otherProvider'),
    };
    async function createIntent(
      client: R24HttpSession = sessions.owner,
      method: (typeof MANUAL_METHODS)[number] = 'CASH_OFFICE',
      planVersionId: string = plans.standard,
    ): Promise<PaymentIntentWireV1> {
      const response = await client.request<PaymentIntentWireV1>('/v1/money/intents', {
        method: 'POST',
        idempotencyKey: h.key('manual-intent'),
        body: { contractVersion: 'hsm.money.v1', method, planVersionId },
      });
      if (response.status !== 201)
        throw new Error('R30 synthetic intent failed: HTTP ' + response.status);
      return response.body;
    }
    const primaryIntent = await createIntent();
    const disabledIntent = await createIntent(sessions.owner, 'CASH_OFFICE', plans.disabled);
    await h.prisma.moneyManualInstructionVersion.updateMany({
      where: { planVersionId: plans.disabled },
      data: { enabled: false },
    });
    return { h, plans, activation, sessions, createIntent, primaryIntent, disabledIntent };
  } catch (error) {
    await h.dispose();
    throw error;
  }
}
