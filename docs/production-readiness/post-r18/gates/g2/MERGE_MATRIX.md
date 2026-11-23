# G2 — Verified merge matrix

Observed on 2026-10-22 from actual GitHub PR metadata. All listed PRs target `develop`; this coordinator task did not merge them. Individual merge identity does not substitute for acceptance of the new combined repair candidate.

| Scope                       | PR                                                                 | Branch                             | Reviewed head                              | Actual merge                               | Merged UTC           |
| --------------------------- | ------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------ | ------------------------------------------ | -------------------- |
| R24                         | [#176](https://github.com/baraabd/homeservicemarketplace/pull/176) | `feat/r24-money-api-integration`   | `22e25216f0b27ebdd0f6454842d43f35fafa8d34` | `820913a87c90fd283df58e00827bcc79a1e0ca39` | 2026-10-17T19:28:16Z |
| R25                         | [#175](https://github.com/baraabd/homeservicemarketplace/pull/175) | `feat/r25-realtime-multi-instance` | `3fdfddc6599fcd2f5d79b176c2e28471f327fe21` | `4e87bf03663fb3c72ffee983fdb70c2863e1ce8a` | 2026-10-17T19:28:55Z |
| R26                         | [#174](https://github.com/baraabd/homeservicemarketplace/pull/174) | `feat/r26-application-security`    | `6bf2669700e80e1727549e17374db40f18111c77` | `6c599618f2a97407093b37ddfa93ad21a41ea7a1` | 2026-10-17T15:28:40Z |
| R27                         | [#173](https://github.com/baraabd/homeservicemarketplace/pull/173) | `feat/r27-performance-capacity`    | `8be5ad3f5cc22f350388e2bec854e809e03b487d` | `21089a5065169b78bea5e711a4839e1a467531dc` | 2026-10-17T15:29:06Z |
| R28 initial                 | [#179](https://github.com/baraabd/homeservicemarketplace/pull/179) | `feat/r28-hosted-platform`         | `e197e943bca78859976f0495b388f376cb4c0136` | `15fe443a7d1b94b3f6a7f45cbe2bf5650a38d539` | 2026-10-18T16:54:31Z |
| R28 corrective/current base | [#181](https://github.com/baraabd/homeservicemarketplace/pull/181) | `feat/r28-hosted-platform`         | `70b7225727d89df0fd040b00ebd37c09383e7d30` | `96e92825f9b65cf124317f43b55ce42fc97f5b49` | 2026-10-22T18:00:53Z |

The current execution base is `96e92825f9b65cf124317f43b55ce42fc97f5b49`, tree `68f4e926eabeb37bb70382c62b75272cf67bd02c`. It includes owner-merged G2 corrective PR #180 and R28/dependency follow-up #181. G1 source `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` is retained as historical accepted Wave 2 start authority.

The active successor is `coord/g2-wave3-start-gate`. Its PR/source/check identities are filled from actual publication and verified artifacts in the acceptance records; no future merge hash is invented. R29–R38 remain planned packages, not merged implementations.
