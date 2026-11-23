# K08 issue-to-test acceptance matrix

Legend: **OPEN** means not executed on a joined candidate. Every OPEN P0/P1
row blocks K08 acceptance. "Supporting" evidence (unit, component, static) is
listed where it exists but never closes a row by itself.

Candidate: **none** (see README). Source inspected: `92770ea6` / tree `854a9146`.

## R34 operational reconciliation

| Requirement                                                                                         | Priority | Executed test                                      | Persisted outcome | Status | Blocker    |
| --------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------- | ----------------- | ------ | ---------- |
| Statement retrieval per supported collection/refund rail                                            | P0       | —                                                  | —                 | OPEN   | B1, B2, B4 |
| Durable run checkpoints, leases/fencing, restart/retry                                              | P0       | —                                                  | —                 | OPEN   | B1, B2     |
| Missing / duplicated / mismatched / late / unknown outcomes modelled; unknown never becomes success | P0       | —                                                  | —                 | OPEN   | B1, B2     |
| Dry-run, resolve, reopen with reason, version check, maker/checker, audit                           | P0       | —                                                  | —                 | OPEN   | B1, B2, B4 |
| Truthful R33 status projection (replace `UnavailableFinancialReconciliationStatus`)                 | P1       | Baseline confirmed still bound (source inspection) | —                 | OPEN   | B1, B2     |
| Full/partial refund invariants, duplicate callbacks, out-of-order statements                        | P0       | —                                                  | —                 | OPEN   | B1, B2     |
| Process kill after external outcome before local commit; safe reprocessing                          | P0       | —                                                  | —                 | OPEN   | B1, B2     |
| Stale operator; simultaneous resolve/reopen; ledger total unchanged under replay                    | P0       | —                                                  | —                 | OPEN   | B1, B2     |
| Actual external sandbox evidence (14 G3 scenarios)                                                  | P0       | NOT_RUN (G3 record)                                | —                 | OPEN   | B3         |

## R35 joined three-role journey

| Journey / state                                                                           | Priority | Executed test                                                                                                 | Screenshot review | Persisted outcome | Status              | Blocker            |
| ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------- | ------------------- | ------------------ |
| Signup → OTP                                                                              | P0       | —                                                                                                             | —                 | —                 | OPEN                | B2, B5             |
| Request with media, location, schedule                                                    | P0       | —                                                                                                             | —                 | —                 | OPEN                | B2, B5             |
| Approved eligible provider receives the request; bid; customer acceptance; single booking | P0       | —                                                                                                             | —                 | —                 | OPEN                | B2, B5             |
| Start / complete / review / notifications / messages                                      | P0       | —                                                                                                             | —                 | —                 | OPEN                | B2, B5             |
| Cancellation; expired or revoked grant; suspension                                        | P0       | —                                                                                                             | —                 | —                 | OPEN                | B2, B5             |
| Correction / resubmission; support; dispute intake / appeal                               | P1       | —                                                                                                             | —                 | —                 | OPEN                | B2, B5             |
| DB persistence after reload, logout and login; websocket recovery; notification dedup     | P0       | —                                                                                                             | —                 | —                 | OPEN                | B2, B5, B6         |
| Plan purchase → webhook → entitlement → expiry/renewal → refund → reconciliation          | P0       | —                                                                                                             | —                 | —                 | OPEN                | B1, B3, B4         |
| Paid status confers no identity verification or work access                               | P0       | Copy states this (supporting only)                                                                            | —                 | —                 | OPEN                | B3                 |
| **Same-tab same-plan second purchase gets distinct intent/attempt**                       | P1       | `StripePlanPurchase.same-tab.test.tsx` (component, HTTP double): **fails on baseline, passes with CR-K08-01** | n/a               | —                 | OPEN (fix proposed) | B3, owner adoption |
| Pending/unknown keeps the original key through refresh and repeat                         | P1       | Same file, control cases pass on the baseline and with the patch (component)                                  | n/a               | —                 | OPEN                | B3                 |
| Hosted Docker artifact CSP, payment flag ON: Payment Element loads                        | P1       | Builder unit tests 32/32 (static only)                                                                        | —                 | —                 | OPEN                | B3, B6             |
| Hosted Docker artifact CSP, payment flag OFF: truthful disabled UI                        | P1       | Source inspection found CR-K08-02                                                                             | —                 | —                 | OPEN (defect)       | B6, B8             |

## UI matrix (applies to every R35 row above)

Widths 320/390/430/768/1024/1440, Arabic RTL and English LTR, light and dark,
200% zoom, keyboard and screen reader, long Arabic text, mobile keyboard,
loading/error/empty/offline/conflict states, real iOS Safari and Android Chrome.
**None of these were executed.** No screenshot was produced or inspected by K08.
Blockers: B5, B6, B7.
