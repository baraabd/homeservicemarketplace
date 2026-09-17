# Reconciliation policy — Sprint 15 contract

Reconciliation compares three authorities without rewriting history: payment-rail events, HSM PaymentIntent/payment records, and HSM ledger/subscription effects. Every discrepancy becomes an exception with stable reason code, correlation/reference ids, first/last seen timestamps and resolution audit.

Examples: external success without local success; local success without expected external confirmation; amount/currency mismatch; succeeded payment without balanced posted ledger; active subscription without authoritative payment (except explicitly free plan); duplicate external reference; refund without compensating ledger transaction.

Automated reconciliation may repair only idempotent, pre-authorized missing side effects. Ambiguous money discrepancies require an authorized operator decision. Reports derive from ledger/payment records and never treat UI wallet totals as an accounting authority.