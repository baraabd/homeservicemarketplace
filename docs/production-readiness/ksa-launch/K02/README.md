# K02 — Saudi product rules, currency and public legal journeys

**Status: IMPLEMENTED and locally verified; NOT accepted.** Hosted CI on the
final SHA, owner decisions and legal approval are outstanding. The PR stays
draft. Nothing is merged or deployed.

| Document               | Content                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `IMPLEMENTATION.md`    | What changed and why; contracts, routes, migration, flags         |
| `OWNER_DECISIONS.md`   | Decision sheet: implemented-by-directive, proposed, inputs needed |
| `REGULATORY_NOTES.md`  | PDPL, E-Commerce, ZATCA, SAMA, SaudiNIC — sourced findings        |
| `ISSUE_TEST_MATRIX.md` | Every issue/acceptance item → fix → tests                         |
| `EVIDENCE.md`          | Exact commands, counts, SHAs, environment, browser evidence       |
| `ROLLBACK.md`          | Deploy order, rollback, forward repair                            |
| `RISKS.md`             | Residual risks, deviations, follow-ups                            |
| `evidence/`            | Curated screenshots (synthetic data)                              |

Consumers: K03–K07 should use `hsm.amount-unit.v1`
(`packages/contracts/src/money/amount-unit.ts`), `LAUNCH_MARKET`
(`packages/contracts/src/market/launch-market.ts`) and the legal registry
(`packages/contracts/src/iam/legal/legal-documents.ts`).

K02 is a launch work package. It is not an R34–R38 lane, changes no Wave 4
owned file, and does not change G3/G4 status.
