# CR-R27-09 — trustworthy isolated measurements

Approved lane-owned repair under the G1 handoff allowlist. Confirmed defects:
HTTP-only port probing accepted a silent occupied TCP port; caller overrides
could redirect the fixed lane environment; database reset inspected root .env
after dropdb; container name alone did not establish disposable ownership.

The harness now detects any occupied loopback listener, rejects destination and
policy overrides, validates Compose identity/labels/loopback bindings before
fixture/reset/flush operations and refuses an existing root .env before reset.
Only its own spawned child is stopped; unexpected socket errors fail closed.
API/web ports follow the manifest (4327 / 5327, 5328). No application or schema
change. Six additional tests include a real silent TCP listener and subprocess
negative reset trials with a fake Docker executable; no database is touched.

Linux resource measurement is not trusted on the Work Mode host because its
process and filesystem views differ. Native GitHub VM reports will supply
resource measurements. No claim of a Linux RSS parser defect is made.

The dedicated workflow uses one fresh VM per baseline/candidate runtime and
the same exact harness commit. Baseline remains G1 source 40cdac5c9ce6acaa8dedc0385984a807ae9a84d0.
It records runtime SHA/tree, harness SHA, dirty harness paths, host and lockfile
fingerprint. It retains sanitized JSON only. No hosted capacity claim, budget
approval, security-budget change or deployment.
