# R28 — Risks and external blockers

Status: **CONFIGURATION_ONLY / HOSTED_ENVIRONMENT_BLOCKED**. These are unresolved
items, not waived requirements. The checker reports non-secret field paths and
owner groups; it does not verify the referenced evidence.

| Risk or missing evidence                                                                          | Consequence                                                                           | Owner and completion evidence                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No selected hosting account, region, host, DNS, registry, secret store, budget or approval        | No hosted target may be provisioned or charged                                        | Infrastructure/spending owner; exact resource selections, cost ceiling, reviewed plan fingerprint and separate authorization                                                   |
| Role declarations are not effective database grants                                               | API could retain DDL, owner, inherited or migration-history authority                 | Database/security owner; real API/migrator sessions, same physical target evidence, sanitized catalog inspection and permission-denied probes on an approved disposable target |
| Identifiers can name the same resource through aliases                                            | Distinct strings alone cannot prove physical staging/production/restore isolation     | Infrastructure owner; provider IDs, network/routes, endpoint and bucket policy inspection                                                                                      |
| Redis clients lack named ACL username/custom-CA input at G1                                       | An arbitrary managed Redis product may not match the frozen clients                   | Infrastructure/R25 coordinator; compatible restricted default-user ACL, dedicated TLS instance, real handshake/channel tests or a separately reviewed compatibility change     |
| The current Compose API stop grace is implicit; the worker defaults to 20 seconds                 | A normal restart can kill an in-flight operation before its shutdown grace completes  | Coordinator; CR-001 stop-grace integration plus real pending-work shutdown/delivery evidence using the actual protected runtime settings                                       |
| The edge file is a declaration, not an applied proxy configuration                                | CSP/cookie/CORS/TLS and public management denial are not proven                       | Edge/R25/R26 owners; versioned adapter, actual headers/negative origins, browser WebSocket and polling, SSE, and direct-ingress denial                                         |
| G1 SSE is in-process with no replay/heartbeat/fan-out; Socket.IO polling needs affinity if scaled | One replica is the current reference; arbitrary scale-out may lose events             | R25/G2 coordinator; accepted multi-instance source and integrated live reconnect/fan-out tests before changing topology                                                        |
| Immutable file mounts do not prove at-rest protection or cross-system rotation serialization      | Mutable/replaced secrets could race rollout; old snapshots could be retired too early | Secret operator; protected immutable versions, actual coordination lock, replacement/rollback test and version-retirement evidence                                             |
| OCI revision labels are not independently trusted build provenance                                | A pinned but untrusted image could falsely claim a source revision                    | Release/registry owner; trusted builder attestations for all three exact repository digests and deployed HTTPS source identity                                                 |
| Backup/PITR settings, retention, RPO and RTO are proposals                                        | Recovery promises remain unmeasured; object versioning is not a restore               | Data/R36 owner; approved objectives and isolated restore with measured data age/time, integrity, privacy and outbound-delivery denial                                          |
| SMTP, scanner, private storage and worker delivery have no authorized target evidence             | No hosted functional acceptance                                                       | Mail/storage/security/runtime owners; independent real inbox, verdicts, access denials, durable delivery and representative R35/R37 journeys                                   |
| R28 tests are not yet named by the shared CI workflow                                             | Green existing CI cannot establish remotely gated R28 coverage                        | Coordinator; apply CR-001, run the new tests on Linux/Windows and retain the source-bound plan report                                                                          |
| Metadata fingerprint is not an authenticated approval                                             | A fully populated synthetic plan must not be treated as an authorization              | Release owner; verify the referenced authority externally; retain CONFIGURATION_ONLY until actual acceptance gates pass                                                        |

## Policy boundaries retained

R16 payout/financial decisions and R18 live money, verification/work-access,
production-initialization and owner decisions remain with their existing owners.
No provider is granted access or verification, no production demo provider is
created, no admin is granted or removed, and no money rail is activated here.
Infrastructure readiness would not independently close those policy gates.

## Validation limits

The initial final-head CI attempt also exposed an integration blocker: current
R26/R27 workflows require files that postdate the assigned G1 source. Their
missing-file failures cannot be fixed inside the 12-file R28 allowance. CR-001
requests explicit normal-merge authority for the already owner-merged current
develop revision, followed by all final-head checks; no checks are disabled.

The validator checks declared relationships and a documented closed schema subset.
It is not a cloud plan engine, generic JSON Schema library, certificate verifier,
IAM evaluator or provenance verifier. It does not dereference an approval-looking
string. No static assertion can establish internet denial, secret encryption,
physical-resource identity or application behavior on an unknown host.

Input files are read through bounded descriptors and concurrent readers are tested.
Checks do not confer a lock over a future deployment or freeze files after returning.
The operator must recheck the reviewed fingerprint and use the existing deployment
lock plus immutable secret versions at the separately authorized rollout boundary.

Independent review fixed the schema-snapshot fingerprint race, invalid falsey edge
fallback and malformed DNS-label acceptance. CodeQL then identified the pre-open
path check in JSON reading; the correction opens once, binds the descriptor to the
non-symlink path entry and checks identity before reading. Platforms without
O_NOFOLLOW/O_NONBLOCK do not acquire kernel-atomic no-follow/nonblocking guarantees;
the descriptor/entry validation still rejects an opened symlink without reading
its bytes. Passing tests provide bounded source
evidence; they do not establish absence of all defects or a conflict-free G2 merge.
