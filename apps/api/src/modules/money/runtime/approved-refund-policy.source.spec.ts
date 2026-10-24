import type { PrismaTx } from '@homeservicemarketplace/database';
import { ApprovedRefundPolicySource } from './approved-refund-policy.source';
const scope = {
  planVersionId: 'synthetic-plan',
  method: 'STRIPE' as const,
  currency: 'XTS',
  mode: 'SANDBOX' as const,
};
const rules = {
  ...scope,
  version: 'synthetic-policy-v1',
  approvalReference: 'test-only-not-commercial-approval',
  reasonCodes: ['CUSTOMER_REQUEST'],
  refundWindowSeconds: null,
  allowPartial: true,
  requireRequesterReviewerSeparation: true,
  requireOriginalReviewerSeparation: true,
  feeTreatment: 'NO_DEDUCTION',
  taxTreatment: 'NO_ADJUSTMENT',
  proRataTreatment: 'NONE',
  entitlementPolicyVersion: 'synthetic-effect-v1',
};
const row = {
  ...scope,
  version: rules.version,
  approvalReference: rules.approvalReference,
  approvedAt: new Date(0),
  validFrom: new Date(1),
  validUntil: new Date(99999),
  rules,
  entitlementEffect: 'SUSPEND_SUBSCRIPTION',
};
function setup(rows: unknown[]) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ now: new Date(100) }]),
    moneyApprovedRefundPolicy: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn().mockResolvedValue(rows[0] ?? null),
    },
  };
  return { tx, prisma: tx as unknown as PrismaTx, source: new ApprovedRefundPolicySource() };
}
describe('G3 explicit immutable refund policy source (synthetic approvals)', () => {
  it('has no fallback policy when no approved row exists', async () => {
    const h = setup([]);
    expect(await h.source.resolve(scope, h.prisma)).toBeNull();
  });
  it('rejects overlapping policies instead of selecting a dominant version', async () => {
    const h = setup([row, { ...row, version: 'other' }]);
    expect(await h.source.resolve(scope, h.prisma)).toBeNull();
  });
  it('uses transaction time and exact sandbox scope with bounded lookup', async () => {
    const h = setup([row]);
    expect(await h.source.resolve(scope, h.prisma)).toEqual(rules);
    expect(h.tx.moneyApprovedRefundPolicy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining(scope), take: 2 }),
    );
  });
  it.each([
    { mode: 'LIVE' },
    { currency: 'XXX' },
    { approvalReference: 'other' },
    { rules: { ...rules, allowPartial: undefined } },
    { validUntil: new Date(0) },
  ])('rejects inconsistent/unapproved policy %j', async (patch) => {
    const h = setup([{ ...row, ...patch }]);
    expect(await h.source.resolve(scope, h.prisma)).toBeNull();
  });
  it('retains an exact historical version for recovery after its selection window expires', async () => {
    const h = setup([row]);
    expect(await h.source.byVersion(rules.version, h.prisma)).toEqual({
      policy: rules,
      effect: 'SUSPEND_SUBSCRIPTION',
    });
    expect(h.tx.moneyApprovedRefundPolicy.findUnique).toHaveBeenCalledWith({
      where: { version: rules.version },
    });
  });
});
