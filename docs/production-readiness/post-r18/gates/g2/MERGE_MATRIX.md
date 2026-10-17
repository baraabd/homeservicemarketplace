# G2 — Merged source and evidence matrix

All identities below are historical observed Git/GitHub facts, not transfer of acceptance to a later tree.

| Lane / record  | Owner-merged PR        | Actual merge source                        | Evidence implication                                                                                              |
| -------------- | ---------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| G1 publication | #171                   | `0568739096ceeaf0cfc79034626886e258fe4328` | Publishes frozen runtime `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`; #172 later releases assigned starts.         |
| R26            | #174                   | `6c599618f2a97407093b37ddfa93ad21a41ea7a1` | Merged before R24/R25; isolated source checks do not certify G2.                                                  |
| R27            | #173                   | `21089a5065169b78bea5e711a4839e1a467531dc` | Replaces historical provisional #162 for present delivery; budget and integration requests remain.                |
| R24            | #176                   | `820913a87c90fd283df58e00827bcc79a1e0ca39` | Merged reviewed head `22e25216f0b27ebdd0f6454842d43f35fafa8d34`, tree `2fe968987f3ca1f559b8b03abe8f437dcacb74f1`. |
| R25            | #175                   | `4e87bf03663fb3c72ffee983fdb70c2863e1ce8a` | Merged after R24; actual combined tree is `eaca9cdeab15e719570f7997c4fc3bbeb64e562e`.                             |
| R28 delivery   | Draft #179, not merged | 60b64cd8216294d7476a7a22607ee56feb18dec4   | Exact12-file peer delivery imported unchanged under coordinator lease; checked plan only.                         |

The green R25 preview `c2066b2b7195b7c8c707f57dc2b5e1dde8c3eb0c` has tree `8805aa1092caefe71e4e0ed99d5ee93b7c0ea845`, different from combined develop. Run [39062646647](https://github.com/baraabd/homeservicemarketplace/actions/runs/39062646647) on the combined source has 27 successful and three failed checks: R25, R18 functional completion acceptance and CI gate. R25 job `117484531044` and artifact `12111448781` establish its bounded failure; raw private browser output was not published.

## Candidate/publication identity

`SOURCE_MANIFEST.json` names each actual checked candidate. `ACCEPTANCE_EVIDENCE.json` distinguishes committed source, local exploratory checks, immutable historical runs and final PR capture. A record-only successor is still checked at its actual head; no document writes its own unknowable future commit hash. The exact R28 same-wave source import is recorded separately from merged dependency ancestry. Draft #178 at14a3cec598a0731879986736adeb792058ae1aa9 remains an earlier blocked closeout observation; its parallel branch/PR is unchanged. This candidate uses one canonical gate schema and retains the supplied R32 package. No merge to develop or deployment is performed.
