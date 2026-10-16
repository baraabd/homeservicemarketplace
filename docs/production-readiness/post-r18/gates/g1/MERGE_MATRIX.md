# Current-source reconciliation notice

The dated observations below describe the earlier `g1` candidate
`54a69f78c0227a2f2b94df851a3ebb941348d8aa`; they are retained as history.
Their OPEN/INCOMPLETE/BLOCKED assessments are superseded for the current source
by [ACCEPTANCE_PUBLICATION.md](ACCEPTANCE_PUBLICATION.md),
[ACCEPTANCE_EVIDENCE.json](ACCEPTANCE_EVIDENCE.json) and the canonical
[SOURCE_MANIFEST.json](SOURCE_MANIFEST.json).

PR #168 merged CR-R20-01 at `5d3acaf861d74756190854138af485cfbfaa0a43`;
PR #169 merged the remaining source/CI repairs at `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
All nine original Wave 1 implementation/corrective merge commits are ancestors
of that source. G1-01–G1-05 now have executed merged-source evidence. The separate
G1-06 owner-publication hold remains; no Wave 2 start is implied.

---

# R19–R23 merged-source matrix

Observed candidate `54a69f78c0227a2f2b94df851a3ebb941348d8aa` / tree `6f638f5f3aedbcc5b795b62da11bb3000f7dba4b`. All rows below target `develop`.
PR inventory came from current GitHub searches and individual REST reads, not historical titles alone.

| Lane / exact title                                                                       | Implementation                                                                                                                                                                     | Corrective follow-ups                                                                                                                                                              | Acceptance                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| R19 — Extend and certify the existing money authority; freeze shared financial contracts | [#159](https://github.com/baraabd/homeservicemarketplace/pull/159), merged `4d04e9113fe749973925bb9ca1c9b93d9faf0f0d`; tested lane head `fcdf1deb1a34044b9253ebac8e0e308a69e7a667` | [#166](https://github.com/baraabd/homeservicemarketplace/pull/166), merged `cbb0ffb4eeb9998eddb1ec2f929d614920a76e15`; tested lane head `2b1a69930a01b8d52090667c4cfa98f09fe1014f` | INTEGRATION_PENDING; see G1 blockers |
| R20 — Production storage, private media authorization and persistence                    | [#161](https://github.com/baraabd/homeservicemarketplace/pull/161), merged `5fe7d23877641d7ba5e1c915b670414a08a8087a`; tested lane head `620bc7f66c369f278a540df702aa1fe757fed874` | None found in current inventory                                                                                                                                                    | INTEGRATION_PENDING; see G1 blockers |
| R21 — Production email delivery and durable feedback                                     | [#160](https://github.com/baraabd/homeservicemarketplace/pull/160), merged `9308b56cf3ca9cdb85de28a9e88567636266efdf`; tested lane head `7766253ebea0cda0f88883c037c8cd59d7849abd` | [#164](https://github.com/baraabd/homeservicemarketplace/pull/164), merged `5c82bdc88e15bf4c0a142a846c6565afcacfad66`; tested lane head `7aaf0026fb40641dcebc70f7a972f27279ed17bc` | INTEGRATION_PENDING; see G1 blockers |
| R22 — Outbox and worker execution reliability                                            | [#158](https://github.com/baraabd/homeservicemarketplace/pull/158), merged `3e9fd3ad106639aa87780af8d3927d1d391cb355`; tested lane head `79617ff051efa69e49a4c7b8f4c446e9b04f3510` | [#165](https://github.com/baraabd/homeservicemarketplace/pull/165), merged `ea318aee14a5d39b724da945b492b8dee3ae77e0`; tested lane head `f0261e44e50b3f8c22c566daf7f491be0e684b58` | INTEGRATION_PENDING; see G1 blockers |
| R23 — Observability, privacy-safe diagnostics and incident detection                     | [#163](https://github.com/baraabd/homeservicemarketplace/pull/163), merged `af662586a640e41d8438d0cb2dd69e8cbb0e172a`; tested lane head `66603ffb4521faf9b4c39bc21224dddd060a15dd` | [#167](https://github.com/baraabd/homeservicemarketplace/pull/167), merged `54a69f78c0227a2f2b94df851a3ebb941348d8aa`; tested lane head `f3f9ef491ac8d8296c655d0e010d8ad2a39e7cf5` | INTEGRATION_PENDING; see G1 blockers |

All nine merge commits are ancestors of the candidate. No PR is merely closed/unmerged.
Squash/rebase identity is not assumed: actual resulting merge commits, content, wiring and
the final integrated tree were inspected. Subsequent R19 canonical input and R22 post-commit
repairs and the R23 HTTP/privacy correction are retained. Full tree equality to the last
corrective head prevents confusing its historical source with a different merged tree.

## Other merged source in the candidate

- G0 #157 is merged, registry coverage was stale; reconciliation is in this PR.
- Unnumbered recovery #156 is merged; no new sprint number is assigned.
- R27 #162 was merged before G1 from the historical G0 baseline. Preserve its harness and evidence as provisional; it neither closes G1 nor earns Wave 2 acceptance.
- No open PRs were returned by the current live inventory. Existing branches remain untouched.

Original lane heads and merge timestamps are retained in `REMOTE_EVIDENCE.json`.
Candidate post-merge runs are the authoritative existing combined-source evidence; individual lane claims alone are not acceptance.
