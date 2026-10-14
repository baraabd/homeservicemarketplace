# CR-R20-07 — Separate API and worker storage credentials (deployment topology)

**Paths (coordinator-owned):** `infra/production/docker-compose.staging.yml`,
`infra/production/STAGING.md`, the secret files contract.

**Reason.** The plan splits storage authority: the API role can write and read
evidence and delete current objects, but cannot delete versions; only the
worker role can erase evidence permanently (proven against real storage with
the plan's own policies). Today one image runs the API and the
retention/dispute/scan/cleanup workers by env flag, so a process running both
must hold the worker policy, which defeats the split.

**Minimal patch.** Run API replicas with all storage-mutating workers disabled
and the API credentials; run one worker service with the worker credentials
and `*_WORKER_ENABLED` flags on. Both mount the same bucket configuration;
`storage-doctor.cjs` must report identical `rootId`s for both (CR-R20-05).

**Decision needed.** Owner/coordinator choice of topology and secret
management. Until then, RISKS R4 stands.
