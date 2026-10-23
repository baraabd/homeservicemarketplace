import { Injectable } from '@nestjs/common';
import { fromMoneyWire, toMoneyWire } from '@homeservicemarketplace/contracts';
import type { MoneyManualRefundOperation } from '@homeservicemarketplace/database';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import type {
  MoneyRefundAdapterPort,
  MoneyRefundObservation,
  MoneyRefundTransportCommand,
} from '../../ports/refund.port';
import type { MoneyTransportBinding } from '../../ports/collection.port';
import { isManualBinding, ManualRailConfiguration } from './manual-rail.config';
import { MANUAL_TX_OPTIONS, manualConflict } from '../../manual-review/manual-review.service';

@Injectable()
export class ManualRefundAdapter implements MoneyRefundAdapterPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunner,
    private readonly configuration: ManualRailConfiguration,
  ) {}
  isConfigured(binding: MoneyTransportBinding): boolean {
    return isManualBinding(binding);
  }

  async submit(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation> {
    return this.transactions.run(async (tx) => {
      await this.configuration.instruction(command.binding, tx);
      const amount = fromMoneyWire(command.amount);
      await tx.$queryRaw`SELECT "id" FROM "MoneyRefund" WHERE "id" = ${command.refundId} FOR UPDATE`;
      const refund = await tx.moneyRefund.findUnique({
        where: { id: command.refundId },
        include: {
          paymentConfirmation: { include: { paymentIntent: { include: { binding: true } } } },
        },
      });
      if (
        !refund ||
        !['RESERVED', 'DISPATCHED'].includes(refund.status) ||
        refund.paymentConfirmationId !== command.paymentConfirmationId ||
        refund.amountMinor !== amount.amountMinor ||
        refund.currency !== amount.currency ||
        !isManualBinding(command.binding)
      )
        throw manualConflict('REFUND_BINDING_MISMATCH');
      this.validateObligation(command, refund);
      const prior = await tx.moneyManualRefundOperation.findUnique({
        where: { refundId: command.refundId },
      });
      if (prior) return this.observation(command, prior);
      const created = await tx.moneyManualRefundOperation.create({
        data: {
          refundId: command.refundId,
          providerIdempotencyKey: command.providerIdempotencyKey,
          adapterId: command.binding.adapterId,
          mode: command.binding.mode,
          accountReference: command.binding.accountReference,
          amountMinor: amount.amountMinor,
          currency: amount.currency,
          state: 'PENDING',
        },
      });
      // PENDING means an operator task exists. No wallet/API/transfer was called.
      return this.observation(command, created);
    }, MANUAL_TX_OPTIONS);
  }

  async query(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation> {
    const operation = await this.prisma.client.moneyManualRefundOperation.findUnique({
      where: { refundId: command.refundId },
      include: {
        refund: {
          include: {
            paymentConfirmation: { include: { paymentIntent: { include: { binding: true } } } },
          },
        },
      },
    });
    if (!operation)
      return {
        status: 'UNKNOWN',
        refundId: command.refundId,
        paymentConfirmationId: command.paymentConfirmationId,
        adapterId: command.binding.adapterId,
        mode: command.binding.mode,
        accountReference: command.binding.accountReference,
        amount: command.amount,
        externalOperationId: command.externalOperationId,
      };
    this.validateObligation(command, operation.refund);
    return this.observation(command, operation);
  }

  private validateObligation(
    command: MoneyRefundTransportCommand,
    refund: {
      paymentConfirmationId: string;
      amountMinor: bigint;
      currency: string;
      paymentConfirmation: {
        paymentIntent: {
          planVersionId: string;
          method: string;
          currency: string;
          binding: {
            adapterId: string;
            mode: string;
            accountReference: string;
            configVersion: string;
            debitAccountId: string;
            creditAccountId: string;
          } | null;
        };
      };
    },
  ): void {
    const intent = refund.paymentConfirmation.paymentIntent;
    const bound = intent.binding;
    const amount = fromMoneyWire(command.amount);
    const authoritative = bound
      ? {
          ...bound,
          planVersionId: intent.planVersionId,
          method: intent.method,
          currency: intent.currency,
        }
      : null;
    if (
      !authoritative ||
      refund.paymentConfirmationId !== command.paymentConfirmationId ||
      refund.amountMinor !== amount.amountMinor ||
      refund.currency !== amount.currency ||
      Object.entries(command.binding).some(
        ([key, value]) => authoritative[key as keyof typeof authoritative] !== value,
      )
    )
      throw manualConflict('REFUND_BINDING_MISMATCH');
  }

  private observation(
    command: MoneyRefundTransportCommand,
    row: MoneyManualRefundOperation,
  ): MoneyRefundObservation {
    const amount = fromMoneyWire(command.amount);
    if (
      !this.isConfigured(command.binding) ||
      row.providerIdempotencyKey !== command.providerIdempotencyKey ||
      row.adapterId !== command.binding.adapterId ||
      row.mode !== command.binding.mode ||
      row.accountReference !== command.binding.accountReference ||
      row.amountMinor !== amount.amountMinor ||
      row.currency !== amount.currency ||
      (command.externalOperationId && command.externalOperationId !== row.externalOperationId)
    )
      throw manualConflict('REFUND_BINDING_MISMATCH');
    const terminal = row.state === 'SUCCEEDED' || row.state === 'FAILED';
    if (
      terminal &&
      (!row.externalOperationId ||
        !row.reference ||
        !row.dispatchUserId ||
        !row.confirmationUserId ||
        row.dispatchUserId === row.confirmationUserId)
    )
      throw manualConflict('REFUND_CONFIRMATION_INCOMPLETE');
    return {
      status: row.state as MoneyRefundObservation['status'],
      refundId: command.refundId,
      paymentConfirmationId: command.paymentConfirmationId,
      adapterId: row.adapterId,
      mode: row.mode,
      accountReference: row.accountReference,
      amount: toMoneyWire({ amountMinor: row.amountMinor, currency: row.currency }),
      externalOperationId: row.externalOperationId,
    };
  }
}
