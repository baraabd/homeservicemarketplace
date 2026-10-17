# R25 rollback and recovery

## Triggers

Stop rollout for any private-room leakage, delivery to a revoked/expired credential, missing durable history after reconnect, repeated visible booking/notification alerts, reconnect/queue growth beyond declared bounds, unexplained provider/admin access, or hosted edge transport failure. The lane performs no hosted rollout itself.

## Coordinated transport rollback

1. Record the actual failing source/build identity and fixed-schema health/queue/reconnect evidence. Preserve private diagnostics in their restricted location; do not paste credentials or private messages into tickets.
2. The owner/coordinator rebuilds the web with `VITE_REALTIME_SOCKET_IO=false` and rolls it out to the same cohort. This is a build-time setting. The recovery hook continues authoritative polling; clearing browser storage is not a rollback procedure.
3. Disable `REALTIME_SOCKET_IO` consistently across the API fleet. Keep IAM/session/permission checks, durable outbox/messages/notifications and REST handlers intact. Never enable `REALTIME_ALLOW_SINGLE_INSTANCE` automatically to mask a broken Redis cluster.
4. Confirm real seeker/provider history, unread/read state, admin review screens and logout against REST. A total Redis failure still requires restoring the mandatory rate-limit dependency; do not raise or disable its budget to obtain a successful response.
5. If source reversion is required, the coordinator creates a normal reviewed revert of the R25 source commits on the combined branch. No force-push, schema rollback, peer-branch reset, history deletion or production data rewrite is needed.
6. Before reactivation, repeat the same-build two-process run, current-session and permission negatives, controlled restart/partition, once-visible replay, browser/RTL checks and final CI/CodeQL. Hosted cohort choice, soak duration and expansion remain explicit owner decisions.

## Disposable test cleanup

The runner stops its own command/preview process groups and the browser suite stops its own API children, including on failures. It does not provision or stop caller-supplied services. The operator stops only the PostgreSQL/Redis/Mailpit process IDs or Compose project created for this R25 session, after verifying ownership. Never identify unrelated processes by name or kill an occupied port. Existing session evidence is not overwritten by a repeated attempt.

The prepared Compose stack uses a unique project, loopback high ports, no fixed container/volume names and disposable tmpfs data. After authorized test cleanup, retaining only reviewed summaries/screenshots is sufficient for publication; no user environment file, database dump, session token or mailbox export belongs in the PR.
