# Production gap matrix — S01

Audited application baseline: `66e336cb4823802aabacc536584972aa43056d23`. This is an implementation/evidence inventory, not a production-release certificate. Start with this matrix, use [FEATURE_INVENTORY.json](FEATURE_INVENTORY.json) for exact source/test/configuration profiles, and use [RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md) to assign the next work. No application code is changed by S01.

## Reading the evidence

The inventory expands **79 named capabilities across 11 shared evidence profiles**. Every capability inherits the profile's frontend route/component, API/controller, guard, contract, database models, unit/integration/browser test paths, configuration, flags and residual risk. Migration references are indexed in [baseline/MODEL_MIGRATION_INDEX.json](baseline/MODEL_MIGRATION_INDEX.json). An empty test list means this audit did not map independent evidence for that field; it never means "passed" or "not needed". Sharing an evidence profile does not imply that every test covers every capability.

Statuses classify the currently verified release state: IMPLEMENTED_NOT_PRODUCTION_CONFIGURED, IMPLEMENTED_FEATURE_GATED, PARTIALLY_IMPLEMENTED, MISSING and BLOCKED. No product capability is labelled COMPLETE from component existence, historical prose or a generic green CI badge. The supplied taxonomy also permits TEST_ONLY and DOCUMENTATION_ONLY; neither is used to conceal actual implementations here.

## Capability matrix

| Track | Capabilities | Current release state | Evidence profile | Work assignment |
| --- | --- | --- | --- | --- |
| Seeker | signup/login/logout; email verification; password recovery | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | auth | S04 |
| Seeker | user profile; saved addresses; service catalog; job/request creation; bids; booking lifecycle; account settings | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | seeker | S05 for request creation; later for other Seeker surfaces |
| Seeker | request media | PARTIALLY_IMPLEMENTED | media | S05 |
| Seeker | messages/chat; notifications | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | communication | later |
| Seeker | disputes | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | disputes | later |
| Seeker | mobile/RTL/Arabic/English | PARTIALLY_IMPLEMENTED | seeker | S04/S05 |
| Provider | account upgrade; onboarding V1; public profile; marketplace feed; bids; bookings; status center | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | provider | S06 for upgrade/onboarding; later for feed/bids/bookings |
| Provider | onboarding V2; BASICS_IDENTITY; SERVICES_EXPERIENCE; PORTFOLIO; REVIEW_SUBMISSION; avatar; specialties/services; portfolio | IMPLEMENTED_FEATURE_GATED | v2 | S06 |
| Provider | WORK_AREA; service area | IMPLEMENTED_FEATURE_GATED | v2 | S07 |
| Provider | WORKING_HOURS; working hours | IMPLEMENTED_FEATURE_GATED | v2 | S08 |
| Provider | identity verification; review corrections; work-access grant | IMPLEMENTED_FEATURE_GATED | verification | S09 |
| Provider | chat; notifications | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | communication | later |
| Provider | wallet/earnings | PARTIALLY_IMPLEMENTED | money | S10 |
| Admin | admin auth/access; dashboard; users; provider directory; suspensions/reactivation; analytics; settings; notifications; audit logs | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | admin | S09 for provider directory/review; later for other Admin sections |
| Admin | review queue; six-section provider dossier; identity verification; portfolio moderation; specialty/category review; final provider approval | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | verification | S09 |
| Admin | verification policies | PARTIALLY_IMPLEMENTED | verification | S09 |
| Admin | disputes | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | disputes | later |
| Admin | financials | PARTIALLY_IMPLEMENTED | money | S10 |
| Platform | PostgreSQL; Prisma migrations; Redis; S3/local storage; restricted evidence; ClamAV; email; outbox; metrics; logs; health/readiness; Docker; CI; CodeQL; secret scanning; container scanning | IMPLEMENTED_NOT_PRODUCTION_CONFIGURED | platform | S03 |
| Platform | Socket.IO; evidence/retention/dispute/public-media workers | IMPLEMENTED_FEATURE_GATED | platform | later |
| Platform | staging/prod deployment path | BLOCKED | platform | S03 |
| Platform | protected develop | BLOCKED | platform | S02 |
| Money | authoritative financial persistence | MISSING | money | S10 |

## What the baseline actually proves

[CI run 36203630366](https://github.com/baraabd/homeservicemarketplace/actions/runs/36203630366) completed successfully for the exact baseline SHA. Its jobs include real PostgreSQL/Redis integration and migration drift, auth cookies against a real API/browser, Admin real-route/persistence, Provider V2 real-route/persistence, visual/responsive/accessibility, real S3/ClamAV retention, dispute journeys, Docker production boot, Compose media/OTP smoke and dependency/secret/container scans. CodeQL and Web development startup also succeeded on the baseline. These are existing GitHub executions, not local runs invented by this audit.

The downloaded Provider artifact was parsed independently. For six samples, acknowledged values equal reloaded values, fresh-login values and direct database values. The fields are displayName, professionSince, serviceAreaCity, intervals, bio and acceptedConsentVersion. The artifact records interceptionFree=true, an empty interception mechanism list and exitStatus=0. [baseline/EVIDENCE.json](baseline/EVIDENCE.json) records provenance and the bounded result without copying raw logs or sessions.

The artifact's flagSource metadata says `VITE_FF_PROVIDER_ONBOARDING_V2`, whereas actual runtime source reads `VITE_PROVIDER_ONBOARDING_V2`. This discrepancy must be corrected in its owning evidence generator in S06; it does not justify silently relabelling old evidence. The six sampled values are not exhaustive coverage of every onboarding field or every failure/race path.

## Important non-equivalences

A passing Docker boot is not SMTP delivery or cloud-storage correctness: the existing image boot supplies an SMTP host that is not dialled, and does not certify the reference production storage topology. HTTP chat persistence is not a completed Socket.IO production cutover. Provider earnings and Admin financials are computed marketplace booking summaries, not actual captured payments, settlement or payouts. The Money domain has bigint arithmetic and tests, but no corresponding financial tables/repos/controller in this baseline.

The source snapshot used for the audit is S02 head `7b17096896f33867870eb461bef886b8444773e4`. Remote compare identifies the baseline as its merge base; the differences are only S02 governance files. Application/database source therefore remains the baseline. The snapshot has 1,874 tracked files, 65 Prisma models and 60 SQL migration scripts. This is an archived tracked source snapshot, not a local git clone or a locally executed git merge-base.

## Rollout flags and environment truth

Backend source defaults keep work-access and verification enforcement OFF; scanner defaults to none; scan/expiry/public-media/dispute workers are separately configured. Outbox defaults ON. Realtime defaults OFF. V2 frontend source defaults OFF when absent, but the checked-in web example explicitly sets V2=true and browser localStorage can override it in both directions. The effective hosted setting is unknown: examples and test flags are not deployment configuration. No flag is changed by this audit.

## Scope and limitations

Source paths and model/migration references were checked for existence and consistency. Controller declarations and key implementations were inspected; this is not a formal proof of every line of the repository. Not every test result was extracted individually. Configuration-dependent capabilities remain uncertified until the owning sprint supplies exact final-head acceptance. The matrix must be refreshed after integration; it must not overwrite another sprint's own acceptance report.
