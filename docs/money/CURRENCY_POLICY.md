# Currency and localization policy

Persist integer minor units plus uppercase three-letter currency code. Never persist a localized formatted amount and never use binary floating point for arithmetic. API JSON serializes large minor-unit integers as decimal strings. Formatting belongs at presentation boundaries using locale-aware Intl APIs and the stored currency.

A transaction/quote/payment intent has exactly one currency in Sprint 13. Currency conversion is out of scope; adding FX later requires an explicit rate source, timestamp, rounding and ledger policy ADR. Manual payment instructions must state the exact expected amount/currency and must not infer conversion from a receipt image.