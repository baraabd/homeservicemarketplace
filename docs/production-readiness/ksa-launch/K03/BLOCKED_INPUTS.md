# K03 — Blocked inputs and unexecuted deployment steps

Status: **`HOSTED_ENVIRONMENT_BLOCKED`** (observed 2026-11-03).

## Evidence for the blocked state

| Input                                            | Observation                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K01 accepted                                     | No. `release/ksa-k01-ci-baseline` has no commits beyond develop `92770ea6`; its worktree holds uncommitted edits by another session                       |
| K02 accepted (scope, resources, evidence policy) | No. `release/ksa-k02-saudi-contracts` has no commits beyond `92770ea6`                                                                                    |
| Approved provider/account/region/host            | None. `topology.json` `target.*` are all `null`. PR #204 records that the connected Railway workspace has no HSM resources                                |
| Budget / spend approval                          | None (`spendApprovalRef`, `monthlyCostCeiling` are `null`)                                                                                                |
| Domain and DNS authority                         | None approved (also recorded by K10, PR #205). `findservice.site` in PR #204 is a Vercel-verified, non-Saudi domain, and K03 did not treat it as approved |
| Registry and secret store                        | None selected                                                                                                                                             |
| Mail sender and permitted test recipients        | None (`email/SENDER_DOMAIN.md` "Selected service" is empty)                                                                                               |
| Storage and encryption choices                   | `storage-plan.json` placeholders unresolved; restricted-bucket object lock is `OWNER_DECISION`                                                            |
| Evidence minimisation and lawful basis           | K02 decision pending                                                                                                                                      |
| Verification/work-access rollout                 | OWNER_DECISIONS D-19 pending                                                                                                                              |

## Unexecuted steps (exact, in order)

Each of these steps needs the inputs above and a separate authorization.

1. **Owner records** the provider, account, region, host, registry, secret store,
   budget ceiling and approval references in a reviewed copy of `topology.json`.
   Then run
   `node scripts/production/platform/validate-plan.cjs --check <plan> --require-target --api-origin https://staging.<DOMAIN> --web-origin https://staging.<DOMAIN>`
   and confirm it exits 0.
2. **Spend approval:** provision the staging resources in `DEPLOYMENT_DESIGN.md` §2,
   with no production data.
3. **DNS authority:**
   - publish `staging.<DOMAIN>`, CAA and the `stg-mail` SPF/DKIM/DMARC records;
   - issue a certificate;
   - run `scripts/production/email/check-sender-dns.cjs stg-mail.<DOMAIN>`.
4. Run `STAGING_RUNBOOK.md` steps 1–4 on the accepted SHA: build, provenance, roles,
   manifest, `--check`, then `--apply`.
5. Run `STAGING_RUNBOOK.md` step 5 acceptance with approved test inboxes and
   synthetic users only.
6. Run the rotation, rollback and redeploy rehearsal (runbook §6) on the hosted target.
7. Record the following under `evidence/hosted/` and update `ISSUE_TEST_MATRIX.md`:
   - image digests and provenance;
   - the manifest fingerprint;
   - sanitized effective-infrastructure observations (open ports, role inspection,
     bucket policies);
   - the migration report.

## Decisions requested from the owner (after the above is concrete)

- Approve the same-origin `staging.<DOMAIN>` design and the `stg-mail` sending
  subdomain.
- Choose the provider/region, and quote the bill of materials in
  `DEPLOYMENT_DESIGN.md` §7. Approve a ceiling (quote × 1.3, with alerts at 50/80/100 %).
- Approve the domain/TLD and the registrar (SaudiNIC eligibility verified at
  execution time).
- Name the approved test inboxes. They must be owner-controlled and monitored, and
  must not be personal mailboxes of third parties.
