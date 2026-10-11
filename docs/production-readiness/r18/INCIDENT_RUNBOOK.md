# R18 — Incident runbook

For the alerts in `OBSERVABILITY_AND_ALERTS.md`. Start every incident by
recording the time, the deployed digests and the `x-request-id` of an
affected request. Never paste tokens, OTPs, cookies, message text or identity
documents into the incident record.

## API errors

Check `/health/ready` per instance; read the error logs by request id. If the
errors began with a deployment, roll back (`ROLLBACK_RUNBOOK.md`). The client
only ever sees safe error copy.

## Latency

Check database pool saturation and slow queries; check Redis latency. Scale
API instances only if the database has headroom.

## Dependency down (PostgreSQL, Redis)

Readiness fails and the API answers 503; rate limiting fails closed. Restore
the dependency; do not switch rate limiting to in-memory in production (the
runtime policy refuses it).

## Outbox

A growing backlog means workers are not claiming. Check worker readiness and
logs; restart workers. Committed events are not lost; they are announced once
when a worker claims them.

## Scanner

Uploads stay unscanned and cannot be used as evidence or attached as verified
media until ClamAV returns. Restore the scanner; do not bypass scanning.

## Mail

OTP and recovery mail fail, so sign-in cannot complete. Check the SMTP
transport and sender verification. Do not enable a test mailbox or an OTP
bypass in production.

## Auth abuse

Login rate-limit refusals spike. Keep the limits; block at the edge if
needed; check for credential stuffing in the logs by IP class, not by
password.
