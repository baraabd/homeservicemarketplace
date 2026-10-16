# G1 source closures and publication hold

Certified source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`. Evidence: [post-merge CI](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728679)
and [ACCEPTANCE_EVIDENCE.json](ACCEPTANCE_EVIDENCE.json).

| ID    | Current state                  | Actual closure / remaining action                                                                                                                                            |
| ----- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1-01 | CLOSED_ON_MERGED_SOURCE        | V1 callable ports/fixtures, exact refund compensation constraints and transactional inbox consumer; all 19 R19 cases pass.                                                   |
| G1-02 | CLOSED_ON_MERGED_SOURCE        | Signed write-once avatar PUTs and preserved restricted reads; all 40 R20 cases and 29 retention cases pass.                                                                  |
| G1-03 | CLOSED_ON_MERGED_SOURCE        | All 13 durable-mail cases, including the three real SMTP scenarios, pass.                                                                                                    |
| G1-04 | CLOSED_ON_MERGED_SOURCE        | Migrated audited replay with no role grants, validated timing; replay 8/8, reliability 21/21 and compiled process cases 3/3 pass.                                            |
| G1-05 | CLOSED_ON_MERGED_SOURCE        | Default-off bounded export, scheduled protected diagnostics and actual transport/worker metrics; boundary and real-worker cases pass.                                        |
| G1-06 | PENDING_OWNER_REVIEW_AND_MERGE | The corrective source is merged and certified. Review/merge this separate acceptance record, verify its actual publication commit, then explicitly authorize assigned lanes. |

The machine record has no unresolved technical source blockers. Its
`publication.blockers` retains G1-06; all five Wave 2 lanes remain held.
Acceptance of the source does not imply that the acceptance record is merged.

## Separate release and external limitations

- `develop` reports `protected: false`; historical R18-G1 branch protection remains a release control.
- Repository-wide current CodeQL/dependency/secret alert IDs and dispositions must be reconciled by R26/security owner. Historical R18 IDs are not asserted current; successful scans do not imply an empty inventory.
- Hosted accounts, DNS/registry/secrets, real sender deliverability, storage IAM/KMS/CDN, production alert receivers/region/retention and SLO approval remain owner/R28/R37 work.
- R16 money/payout and R18 D-2/D-3/D-13/D-19 decisions and R19 commercial policies remain explicit owner decisions. Live rails and payouts stay disabled.

No future sprint is fabricated to close a Wave 1 boundary. No current finding
is dismissed, no hosted target is guessed, and no role or account is granted.
