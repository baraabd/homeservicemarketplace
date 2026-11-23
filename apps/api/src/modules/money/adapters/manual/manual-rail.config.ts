import { Injectable } from '@nestjs/common';
import type { MoneyManualInstructionVersion, PrismaTx } from '@homeservicemarketplace/database';
import type { PaymentMethod } from '@homeservicemarketplace/contracts';
import { z } from 'zod';
import {
  unavailableMoneyPort,
  type MoneyBindingConfiguration,
  type MoneyConfigurationPort,
  type MoneyTransportBinding,
} from '../../ports/collection.port';

export const MANUAL_ADAPTER_ID = 'hsm.manual.v1';
export const MANUAL_METHODS = ['SHAM_CASH', 'SYRIATEL_CASH', 'CASH_OFFICE'] as const;
export const manualInstructionsSchema = z
  .object({
    ar: z.string().trim().min(1).max(4000),
    en: z.string().trim().min(1).max(4000),
  })
  .strict();

export function isManualBinding(binding: MoneyTransportBinding): boolean {
  return (
    binding.mode === 'SANDBOX' &&
    binding.adapterId === MANUAL_ADAPTER_ID &&
    (MANUAL_METHODS as readonly string[]).includes(binding.method)
  );
}

/** Commercial values are explicit, immutable operator-approved data, never defaults.
 * Only sandbox operator simulations are implemented. LIVE stays unavailable even
 * if someone inserts a LIVE instruction record directly into the database. */
export function usableInstruction(row: MoneyManualInstructionVersion, now = new Date()): boolean {
  return (
    row.enabled &&
    row.approvedAt !== null &&
    row.approvedAt <= now &&
    row.mode === 'SANDBOX' &&
    row.adapterId === MANUAL_ADAPTER_ID &&
    (MANUAL_METHODS as readonly string[]).includes(row.method) &&
    row.validFrom <= now &&
    row.validUntil > now &&
    row.referencePolicy === 'EXACT_TRIM' &&
    row.market.trim().length > 0 &&
    row.policyVersion.trim().length > 0 &&
    row.accountReference.trim().length > 0 &&
    row.maxAmountMinor > 0n &&
    row.receiptMaxBytes > 0 &&
    row.receiptMaxBytes <= 10 * 1024 * 1024 &&
    row.uploadTtlSeconds > 0 &&
    row.quoteTtlSeconds > 0 &&
    row.retentionDays > 0 &&
    Number.isInteger(row.minorUnitScale) &&
    row.minorUnitScale >= 0 &&
    row.minorUnitScale <= 6 &&
    manualInstructionsSchema.safeParse(row.instructions).success
  );
}

@Injectable()
export class ManualRailConfiguration implements MoneyConfigurationPort {
  async resolve(
    input: { planVersionId: string; method: PaymentMethod },
    tx: PrismaTx,
  ): Promise<MoneyBindingConfiguration | null> {
    if (!(MANUAL_METHODS as readonly string[]).includes(input.method)) return null;
    const rows = await tx.moneyManualInstructionVersion.findMany({
      where: { planVersionId: input.planVersionId, method: input.method, enabled: true },
      orderBy: [{ validFrom: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    const row = rows.find((candidate) => usableInstruction(candidate));
    return row ? this.binding(row) : null;
  }

  async resolveBinding(
    binding: MoneyTransportBinding,
    tx: PrismaTx,
  ): Promise<MoneyBindingConfiguration | null> {
    const row = await tx.moneyManualInstructionVersion.findUnique({
      where: { configVersion: binding.configVersion },
    });
    if (!row || !usableInstruction(row)) return null;
    const configured = this.binding(row);
    return Object.entries(binding).every(
      ([key, value]) => configured[key as keyof MoneyTransportBinding] === value,
    )
      ? configured
      : null;
  }

  async instruction(
    binding: MoneyTransportBinding,
    tx: PrismaTx,
  ): Promise<MoneyManualInstructionVersion> {
    if (!(await this.resolveBinding(binding, tx))) throw unavailableMoneyPort('METHOD_DISABLED');
    return tx.moneyManualInstructionVersion.findUniqueOrThrow({
      where: { configVersion: binding.configVersion },
    });
  }

  private binding(row: MoneyManualInstructionVersion): MoneyBindingConfiguration {
    return {
      planVersionId: row.planVersionId,
      method: row.method,
      currency: row.currency,
      adapterId: row.adapterId,
      mode: row.mode,
      accountReference: row.accountReference,
      debitAccountId: row.debitAccountId,
      creditAccountId: row.creditAccountId,
      configVersion: row.configVersion,
      quoteTtlSeconds: row.quoteTtlSeconds,
    };
  }
}
