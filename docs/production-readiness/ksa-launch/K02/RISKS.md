# K02 — Residual risks, deviations and follow-ups

| ID      | Risk / deviation                                                                                                                                                                       | Severity     | Owner / next step                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| K02-R1  | **Production signup is closed** until the Terms/Privacy texts are approved (by design: DRAFT text is not accepted in production).                                                      | Launch gate  | Owner O-13; then bump versions to APPROVED                                |
| K02-R2  | Legal texts are engineering drafts describing actual behaviour; every undecided fact is marked pending. They are not legal advice and not in force.                                    | High         | Owner + counsel review                                                    |
| K02-R3  | Provider identity onboarding still collects and retains ID document images (ADR 0009/0010). PDPL Art. 28 / IR Art. 31 allow copies only where a statute requires them.                 | High (legal) | Owner O-10 before `VERIFICATION_ENFORCED=true`; K02 changed nothing there |
| K02-R4  | Legacy amounts (pre-K02 rows) are quarantined, not reconciled. Their unit is unproven; they are visible with a label and excluded from totals.                                         | Medium       | Reviewed reconciliation (separate, owner-approved)                        |
| K02-R5  | Seeker requests are not checked against the market envelope server-side (providers are). A request outside Saudi Arabia can be created.                                                | Medium       | K03+ (proposal P-5)                                                       |
| K02-R6  | Breaking wire change: bid body and earnings/financials summary shapes. API and web must deploy together (see `ROLLBACK.md`).                                                           | Medium       | Release coordinator                                                       |
| K02-R7  | Wallet "Daily earnings" chart shows the launch currency only (other currencies are listed in the header, never charted together).                                                      | Low          | Accepted by design                                                        |
| K02-R8  | Live-jobs bottom-sheet handle animates continuously and ignores `prefers-reduced-motion` (pre-existing; found by the K02 browser run).                                                 | Low (a11y)   | Follow-up outside K02 scope                                               |
| K02-R9  | Real-API browser evidence ran on `chromium-desktop` with explicit 320–1440 viewports; no physical iOS/Android device, no WebKit/Firefox.                                               | Medium       | Hosted/real-device pass (K08/K10)                                         |
| K02-R10 | Marketing consent: none exists and none was added; withdrawal of policy consent and account deletion flows are not part of K02.                                                        | Medium       | Owner O-8 / privacy-rights design (P-8)                                   |
| K02-R11 | One local first-run flake: `DashboardOverview.test.tsx` first test timed out once on a cold module transform during a full parallel run; 3 consecutive reruns and 2 full suites green. | Low          | Watch in CI                                                               |
| K02-R12 | SDAIA National Register of Controllers rules page was unavailable when checked.                                                                                                        | Medium       | Owner O-12                                                                |
| K02-R13 | Brand "FixNow / فيكس ناو" is provisional; trademark/CR name not confirmed.                                                                                                             | Medium       | Owner O-3                                                                 |

## Deliberate non-changes

- No escrow, payout, fee, refund or FX. No change to R29–R33 money modules.
- `default_currency`, `platform_fee_bps` settings remain inert (description
  updated to say currency is server policy).
- R18 historical documents are not edited; D-2 is addressed here.
- No SMS sender; phone numbers remain "not verified".
