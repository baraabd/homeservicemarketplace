import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type { MoneyApprovedRefundPolicy, PrismaTx } from '@homeservicemarketplace/database';
import {
  approvedPolicySchema,
  type ApprovedRefundPolicy,
  type RefundPolicyScope,
  type RefundPolicySourcePort,
} from '../refunds/refund-eligibility.policy';

/** No implicit defaults or administrative API. Rows are immutable, separately
 * reviewed policy versions. Recovery retains the exact historical version. */
@Injectable()
export class ApprovedRefundPolicySource implements RefundPolicySourcePort {
  constructor(private readonly config: AppConfigService) {}
  async resolve(scope: RefundPolicyScope, tx: PrismaTx): Promise<ApprovedRefundPolicy | null> {
    if (!this.config.get('MONEY_REFUND_AUTHORIZATION_ENABLED')) return null;
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
    if (!clock || !Number.isFinite(clock.now.getTime())) return null;
    const rows = await tx.moneyApprovedRefundPolicy.findMany({
      where: {
        ...scope,
        approvedAt: { lte: clock.now },
        validFrom: { lte: clock.now },
        validUntil: { gt: clock.now },
      },
      orderBy: { version: 'asc' },
      take: 2,
    });
    // Ambiguous overlapping approval fails closed, rather than choosing a winner.
    return rows.length === 1 ? this.parse(rows[0]!) : null;
  }
  async byVersion(version: string, tx: PrismaTx) {
    const row = await tx.moneyApprovedRefundPolicy.findUnique({ where: { version } });
    const policy = row && this.parse(row);
    return row && policy ? { policy, effect: row.entitlementEffect } : null;
  }
  private parse(row: MoneyApprovedRefundPolicy): ApprovedRefundPolicy | null {
    const result = approvedPolicySchema.safeParse(row.rules);
    if (
      !result.success ||
      row.mode !== 'SANDBOX' ||
      row.approvedAt > row.validFrom ||
      row.validFrom >= row.validUntil
    )
      return null;
    const policy = result.data;
    if (
      ['version', 'planVersionId', 'method', 'mode', 'currency', 'approvalReference'].some(
        (key) =>
          policy[key as keyof ApprovedRefundPolicy] !== row[key as keyof MoneyApprovedRefundPolicy],
      )
    )
      return null;
    return policy;
  }
}
