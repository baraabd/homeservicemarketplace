# G2 — Risks and continuing holds

## Technical risks under verification

The read projections reduce round trips while preserving existing service authorization. Their risks are SQL/Prisma equivalence, nullable/tied cursor ordering, schema isolation and planner choices on representative large tables. Real PostgreSQL equivalence and the unchanged R27 generic/bound EXPLAIN and page-size checks are required before acceptance. A smaller query count alone is insufficient.

Admin financial pagination still uses mutable `updatedAt` sorting. A concurrent change can repeat or omit an item during a long walk; the historical measurement demonstrates that limitation. This repair does not promise snapshot pagination or alter money values to conceal it.

The successor measurement baseline is the current owner-merged source, because the historical G1 lock differs from the accepted patched lock. The unchanged comparator must reject mixed dependency trees. Shared hosted CI hardware and low sample sizes limit timing inference even for comparable source/harness identities. Original proposal budgets remain unchanged; hosted SLOs are not evaluated by the local budget CLI.

## Publication and future waves

Complete original R29–R38 packages are now available, but they are planning instructions. Conditional file ownership does not create runtime modules or implement a sprint. G2 publication controls R29–R33; G3 controls R34–R38; R38 final certification must wait for the serialized R34–R37 evidence join. No same-wave unmerged source may be imported.

An accepted but unmerged G2 record remains a start hold. The owner reviews the concrete PR; the coordinator subsequently verifies the merge/publication source and next frozen base. No automatic merge, rebase, force push or deployment is authorized.

## External and policy holds

- R28 remains `CONFIGURATION_ONLY / HOSTED_ENVIRONMENT_BLOCKED` until approved target identities, TLS/proxy/Redis configuration, secrets, resources and operator authority exist. No hosted resources are created here.
- R16 payout/funding authority and R18 commercial/legal/production decisions remain unchanged. Subscription collections are not provider withdrawable balances. No market, currency, tax, fee, grace, refund or verification policy is inferred.
- New Stripe/manual live integrations require their explicit credentials, merchant/commercial policies and approved confirmation authority. Future component tests cannot manufacture settlement or activation.
- A successful exact-PR CodeQL result and dependency audit do not establish a clean repository-wide alert inventory or branch protection. These separate launch controls require current authorized verification.
- Live-money flags, production deployment, resource spend and account/permission grants remain prohibited by this task's scope.

The historical blocked record and failed experiments remain retained so a future coordinator can distinguish resolved defects from missing or stale evidence. No zero-defect or conflict-free integration claim is made.
