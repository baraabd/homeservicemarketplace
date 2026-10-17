import type {
  FinancialProjectionV1,
  ReconciliationExceptionWireV1,
} from '@homeservicemarketplace/contracts';

export const MONEY_FINANCE_READ = Symbol('MONEY_FINANCE_READ');

/** The coordinator's read service authorizes the current user afresh.
 * Totals are posted-ledger projections per currency, never booking earnings.
 */
export interface MoneyFinanceReadPort {
  financialProjection(
    userId: string,
    input: { currency: string; asOf: string },
  ): Promise<FinancialProjectionV1>;
  exceptions(
    userId: string,
    input: { limit?: number; cursor?: string },
  ): Promise<{ items: ReconciliationExceptionWireV1[]; nextCursor: string | null }>;
}
