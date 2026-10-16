# Acceptance rollback and revocation

This publication PR changes governance records and their regression fixtures;
it changes no application, database, runtime configuration or deployment.
Revert this PR as one coherent reviewed change to restore the previous held
gate without undoing the source repairs already merged in #168/#169.

If evidence becomes stale or a required boundary regresses, issue a reviewed
successor BLOCKED decision, clear the wave's frozen authorization/startable
lanes, and reconcile the registry/index together. Preserve prior immutable
source/evidence and record the revocation reason. Do not disable the validator
or remove tests to make an unsupported record pass.

Application rollback remains governed by REMEDIATION_ROLLBACK.md: frontend
first/API second on rollout, API first on rollback; preserve additive financial
guards and audit/dedupe persistence. No database reset, ledger rewrite, object
deletion, schema downgrade, role grant or live-money activation is authorized.
No merge, auto-merge or deployment is performed by this publication task.
