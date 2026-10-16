# G1 closure and remaining publication condition

Certified source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` / `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
The previous open rows remain in Git history at this source. PR #169 supplies
the corrective source; [ACCEPTANCE_EVIDENCE.md](ACCEPTANCE_EVIDENCE.md) supplies
the independently inspected merged-source evidence.

| ID    | Current state       | Closure / remaining action                                                                                                                                                    |
| ----- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1-01 | CLOSED_TECHNICAL    | Callable `hsm.money.v1` ports and consumers compile; 19 R19 real PostgreSQL cases prove compensation, rollback and one activation notice.                                     |
| G1-02 | CLOSED_TECHNICAL    | Signed write-once avatar upload and frontend precondition; 40 real S3/access cases pass, plus 29 retention cases.                                                             |
| G1-03 | CLOSED_TECHNICAL    | All three real SMTP scenarios execute within 13 passing durable-mail tests. Production delivery remains separate.                                                             |
| G1-04 | CLOSED_TECHNICAL    | Replay audit/permission definition without grants, validated timing, 8 replay + 21 reliability + 3 process cases pass.                                                        |
| G1-05 | CLOSED_TECHNICAL    | Default-off exporter, protected bounded diagnostics and real dependency/worker producers verified; identical-tree alert evidence is separately identified.                    |
| G1-06 | PUBLICATION_PENDING | Corrective source is owner-merged and reverified. Owner must review/merge this separate acceptance record; coordinator verifies its commit and source before releasing lanes. |

## Independent release limitations retained

- R18-G1 branch protection: develop reports protected=false; separate historical release blocker.
- Repository-wide CodeQL inventory unavailable through exposed connector; R26/security owner must supply current IDs/dispositions. Historical #2/#13/#16/#20 are not asserted current.
- R18-H1 hosting/DNS/registry/secrets, real sender deliverability, hosted storage IAM/KMS/CDN, production alert receivers/region/retention and SLO approval remain owner/R28/R37 work.
- R16 money/payout policies, R18 D-2/D-3/D-13/D-19 and R19 commercial policies remain explicit owner decisions. Live rails and payouts stay disabled.

No hosted, policy or production condition is silently closed. No account/role
permission or production setting changes in this publication.
