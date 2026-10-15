# CR-05 — hosted scrape, alert receivers and CI gate

Owner: coordinator (CI, deployment configuration) and the product owner
(receivers, contacts, vendor). Requested by: R23.

## 1. CI job (coordinator-owned `.github/workflows/ci.yml`)

Add a job that needs no secrets or network beyond the image pull:

```yaml
observability-rules:
  name: Observability rules (promtool)
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Check and unit-test alert rules
      run: |
        docker run --rm -v "$PWD/infra/production/observability/prometheus:/w:ro" \
          --entrypoint promtool prom/prometheus:v3.5.0 check rules /w/rules/api-slo.rules.yml /w/rules/platform.rules.yml
        docker run --rm -v "$PWD/infra/production/observability/prometheus:/w:ro" -w /w/tests \
          --entrypoint promtool prom/prometheus:v3.5.0 test rules api-slo.test.yml platform.test.yml
```

Pin the image by digest when adding it. Optionally add
`scripts/production/observability/run-synthetic-alert.cjs` as a manual
(`workflow_dispatch`) job; it takes about 10 minutes.

## 2. Hosted scrape (target-specific, requires authorization)

- Scrape `/metrics` with `authorization: { type: Bearer, credentials_file: ... }`
  using `METRICS_TOKEN` from the secret store. Never put the token in the
  Prometheus config file or a CI log.
- `job="hsm-api"` must be the job label: every rule filters on it.
- Load `infra/production/observability/prometheus/rules/*.rules.yml` unchanged.

## 3. Production receivers (owner decision)

Replace the two webhook URLs in `alertmanager.test.yml` with the authorized
receivers (pager for `severity=page`, ticket queue for `severity=ticket`),
with credentials from files. Keep routing, grouping and inhibition. Then
repeat the synthetic alert test against the hosted stack and record its
result in ACCEPTANCE.md.

## 4. Decisions needed

| Decision                                                                           | Owner                            |
| ---------------------------------------------------------------------------------- | -------------------------------- |
| Metrics/logs/traces vendor, region and retention                                   | product owner                    |
| On-call rota and contacts for `platform-oncall`, notifications and payments owners | product owner                    |
| Approval of the PROPOSED objectives in `SLO.md`                                    | product owner with capacity data |
