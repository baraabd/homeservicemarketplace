# R26 residual risks and blockers

| ID            | State                              | Owner / required evidence                                                                                                                                                                                                                                                                                 |
| ------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R26-EXT-01    | EXTERNAL_BLOCKED                   | Security administrator: export current repository-wide code-scanning, Dependabot and secret-scanning alert IDs, severities, affected refs and dispositions. Connector has no supported inventory endpoints; never interpret unavailable data as zero. Reconcile with deployed source.                     |
| R26-EXT-02    | EXTERNAL_BLOCKED                   | Deployment owner: actual deployed commit, image/bundle digests, approved HTTPS API/web/CDN/upload topology and TLS edge evidence. No deployment access/approval was supplied.                                                                                                                             |
| R26-INT-01    | INTEGRATION_PENDING                | Final published head must pass complete existing CI/CodeQL and new R26 job. Earlier G1 results cannot accept changed R26 runtime.                                                                                                                                                                         |
| R26-INT-02    | INTEGRATION_PENDING                | Coordinator: R24 money-review/receipt HTTP interfaces are a separate Wave 2 lane, absent from accepted G1. Validate their effective permissions/private receipts at G2 after integration. Do not invent routes or claim 404 means authorization works.                                                    |
| R26-EDGE-01   | Operational control                | Edge owner: trusted proxy hops must match actual topology; enforce TLS, request/connection/body/time limits, secure cookies and HSTS deployment scope. CSP meta alone cannot block embedding; retain actual edge framing headers.                                                                         |
| R26-CSP-02    | Explicit compatibility requirement | Deployment owner supplies exact public storage/CDN upload/media origins at build time. Existing third-party fonts/OSM services remain explicit dependencies. Inline styles remain necessary for existing React components; scripts have no unsafe allowance.                                              |
| R26-IMAGE-01  | Existing residual                  | Container owner: API application files are owned by the non-root app user in the frozen image. Non-root execution reduces privilege but is not a read-only root filesystem guarantee. Retain volume/resource/privilege controls; read-only filesystem hardening needs a dedicated validated image change. |
| R26-POLICY-01 | POLICY_BLOCKED                     | Owner/legal/operations: unresolved R16/R18 D-2/D-3/D-13/D-19 business decisions, supported money rails and live money gate. This code change does not resolve them.                                                                                                                                       |

Develop branch protection was observed disabled during the G1 handoff. That remains an owner-managed repository control, not something a successful workflow enables. No scan policy, required check, test assertion, global limiter, deployment switch or live-funds default is relaxed here.

The isolated browser scanner is a test component and the browser API uses loopback development configuration. Neither is production malware or HTTPS acceptance. Private synthetic screenshots contain no actual identity material. Missing required evidence keeps the PR Draft even if implementation checks are green.

Successor R26-CONFIG-02 (2026-10-17): URL canonicalization could introduce a
wildcard or CSP separator absent from the raw configured string. Raw and
canonical validation plus adversarial regressions remediate the source defect;
no remote-controlled configuration path or deployed exploitation was established.
The exact configured API/media/upload origins still require deployment-owner
review. Existing CI upload-origin mismatches are corrected in disposable
fixtures/configuration, with final-head real-browser evidence required.
