# R23 — risks, blockers and known deviations

## External and policy blockers

| ID        | Blocker                                                                              | Class            | Owner         | Effect                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------ | ---------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R23-EXT-1 | No authorized production alert receivers (pager, ticket queue, contacts, rota)       | EXTERNAL_BLOCKED | product owner | Alerts reach the local test receiver only. Production incident readiness is not established.                                                 |
| R23-EXT-2 | No hosted metrics/logs/traces backend, vendor, region or retention decision (R18-H1) | EXTERNAL_BLOCKED | product owner | Rules, dashboards and the exporter are reproducible locally; no hosted evidence exists.                                                      |
| R23-POL-1 | Objectives in `SLO.md` are PROPOSED; no owner or capacity approval                   | POLICY_BLOCKED   | product owner | Thresholds may change; no SLA is claimed.                                                                                                    |
| R23-POL-2 | No payment rail (R16, R18 D-1)                                                       | POLICY_BLOCKED   | product owner | `PaymentOutcomeUnknown` is inert by design.                                                                                                  |
| R23-G0    | No coordinator wave manifest, G0 acceptance record or approved allowlist was found   | PROCESS          | coordinator   | Work started from `develop@059c018` (the planning observation, equal to `origin/develop` at start). The allowlist is proposed, not approved. |

## Integration pending (coordinator / other lanes)

| ID        | Item                                                                    | Change request |
| --------- | ----------------------------------------------------------------------- | -------------- |
| R23-INT-1 | Request-id agreement for invalid inbound ids; path-only error logging   | CR-01          |
| R23-INT-2 | Trace export configuration and sampling (export off until then)         | CR-02          |
| R23-INT-3 | Deep diagnostics scheduling (leaf providers only today)                 | CR-03          |
| R23-INT-4 | Boundary adoption: outbox tick, SMTP, storage, scanner, workers         | CR-04          |
| R23-INT-5 | CI rule-test job, hosted scrape with bearer token, production receivers | CR-05          |

Until CR-04 lands, `MailSendFailureRatioHigh` and `BackgroundJobStale` have no
producer and stay silent. They do not page falsely; they also do not protect.

## Residual technical risks

1. **Global middleware mounted from a lane-owned module.** `MetricsModule`
   now measures every request. Measured overhead of the recording path:
   see ACCEPTANCE.md (microseconds per request). Coordinator review requested
   (ALLOWLIST.md).
2. **Scrubbing is pattern-based for free text.** Key-based and allowlist
   layers are robust; regexes for secrets inside arbitrary strings can miss an
   unusual format (for example a credential without a recognisable key or
   scheme). The allowlisted request serializer means request data never
   reaches that layer; error messages from third-party SDKs remain the main
   exposure. Mitigation: synthetic-secret tests across headers, query, body,
   cause chains and SDK-shaped errors; review new error sources.
3. **Stack traces stay in logs** (scrubbed) because they are needed to debug.
   They contain filesystem paths of the build host. They never reach clients
   (unchanged `AllExceptionsFilter` behaviour).
4. **IP address removed from request logs.** Abuse investigation that relied
   on `remoteAddress` in API logs must use the edge/proxy logs or rate-limit
   metrics instead. This is a deliberate privacy decision; reverse it only
   with a retention and access decision.
5. **AsyncLocalStorage propagation** can be lost by libraries that break
   async context (custom thenables, some pools). Effect: a background log line
   without a `traceId`; never wrong data.
6. **Route cardinality cap (400)** collapses later routes into `other` if the
   API ever exceeds it. `telemetry_label_overflow_total` and its alert make
   that visible.
7. **Synthetic test network corrected during PR review.** Both helpers now
   run inside the project Compose bridge and use service DNS. Host ports
   stay on loopback. The new Linux workflow must demonstrate scrape plus
   firing and resolved notification delivery before its run is accepted.
8. **Pre-existing failure outside R23**: `storage/restricted-erasure.spec.ts`
   fails 1 of 7 on this Windows host at base and with R23 (storage code
   identical). Not caused or masked by R23; reported for the owning lane.

9. **The end-to-end synthetic alert path has not completed.** The local run
   was killed for host memory after its healthy phase (ACCEPTANCE.md § 4).
   Rules, routing and recovery are proven by promtool and amtool only, not by
   a delivered notification.
10. **Current develop integrated.** Merge `4b9aa66` includes develop
    `f52d7b0`; final-head CI remains the integration check after review fixes.

## Not claimed

No SLA, no production incident readiness, no hosted acceptance, no zero
defects, no guaranteed conflict-free integration with the other Wave 1 lanes.
