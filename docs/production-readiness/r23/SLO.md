# R23 — service objectives (PROPOSED)

**Every target on this page is PROPOSED.** None has owner or capacity
approval, none is an SLA, and no measurement from a hosted environment exists
(there is no hosted environment: R18-H1). The numbers are starting points
chosen to be reachable by a single-region modular monolith; they must be
revisited against real traffic before approval.

| Objective                | SLI (source)                                                                                                       | Proposed target                | Window         | Alerting                                                                         | Status                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ | -------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| API availability         | share of API requests without a 5xx; probes (`/health/*`) and client aborts (499) excluded (`http_requests_total`) | 99.5 %                         | 28 days        | burn rate 14.4x (1 h & 5 m, page), 6x (6 h & 30 m, page), 1x (3 d & 6 h, ticket) | PROPOSED; producer added in R23                           |
| API latency              | share of API requests completing within 1 s (`http_request_duration_seconds`)                                      | 99 %                           | 28 days        | 14.4x (page), 6x (ticket)                                                        | PROPOSED; producer added in R23                           |
| Outbox lag               | oldest claimable outbox event age (`outbox_oldest_pending_age_seconds`)                                            | at most 300 s                  | continuous     | over 300 s for 10 min (page)                                                     | PROPOSED; producer exists since Sprint 6                  |
| Notification delay       | event-to-delivery delay p99 (`notification_delivery_delay_seconds`)                                                | at most 120 s                  | 15 min rolling | over 120 s for 15 min (ticket)                                                   | PROPOSED; INSTRUMENTATION_PENDING (R29+)                  |
| Mail delivery            | share of SMTP sends that succeed (`dependency_call_duration_seconds{dependency="smtp"}`)                           | 95 % per 15 min (paging floor) | 15 min         | over 5 % failures with 5 or more sends, 10 min (page)                            | PROPOSED; producer pending CR-04 adoption                 |
| Scan age                 | oldest upload waiting for a malware scan (`scan_oldest_pending_age_seconds`)                                       | at most 900 s                  | continuous     | over 900 s for 10 min (page)                                                     | PROPOSED; INSTRUMENTATION_PENDING (R31/R32)               |
| Payment unknown outcomes | payment attempts with an unknown outcome (`payment_unknown_outcomes_open`)                                         | 0 older than 15 min            | continuous     | any, 15 min (page)                                                               | PROPOSED; POLICY_BLOCKED (no payment rail, R16 / R18 D-1) |

## Why these SLIs

- **Availability counts 5xx only.** A 4xx is the API answering correctly to a
  bad request; counting it would make a scanner or an outdated client burn the
  budget.
- **499 is excluded**, because a mobile client dropping the connection is not
  a server failure. It is still visible on the dashboard.
- **Latency is a threshold ratio, not a percentile target**, because ratios
  aggregate correctly across instances and over time; percentiles do not.
- **Outbox age, not depth.** A large backlog draining quickly is healthy; a
  rising oldest age means arrivals have overtaken throughput.

## Noise control

- Multi-window burn rates: a long window proves the burn is sustained, a short
  window makes the alert resolve soon after recovery (tested in
  `infra/production/observability/prometheus/tests/api-slo.test.yml`: a
  one-minute burst after two healthy hours does not page).
- Minimum volume: no API page below 20 requests per hour.
- `for:` durations on every page (at least 2 minutes, enforced by the quality
  gate).
- Alertmanager groups by `alertname, service, slo`, and inhibits slow burns
  while the fast burn of the same SLO fires.

## Approval needed

The owner approves or replaces each target with capacity data, names the
owning team for the notification and payment objectives, and decides the
paging hours. Until then alerts route to test receivers only.
