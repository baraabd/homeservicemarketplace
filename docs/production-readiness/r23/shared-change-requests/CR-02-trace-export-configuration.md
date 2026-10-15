# CR-02 — trace export and sampling configuration

Owner of the files: coordinator. Requested by: R23. Dependency consequences:
none (the exporter uses the runtime's `fetch`; no OpenTelemetry SDK is added).
Migration consequences: none.

## Paths

- `apps/api/src/config/env.schema.ts`
- `apps/api/src/main.ts` (or a bootstrap hook in `AppModule`)
- `.env.example`, `docs/production-readiness/r18/ENVIRONMENT_MATRIX.md`

## Reason

Trace ids are always minted and logged. Exporting spans is off until a
validated configuration turns it on: R23 does not read `process.env` directly
from the telemetry module, because unvalidated configuration is how a
production default gets weakened by accident.

## Proposed keys

| Key                                  | Type / validation                                                  | Default            |
| ------------------------------------ | ------------------------------------------------------------------ | ------------------ |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | URL; `https:` required when `NODE_ENV=production`; no userinfo     | unset (export off) |
| `OTEL_EXPORTER_OTLP_HEADERS`         | `k=v,k=v`; secret; never logged; refuse if set without an endpoint | unset              |
| `OTEL_TRACES_SAMPLER_RATIO`          | number 0–1                                                         | `0`                |
| `OTEL_SPAN_QUEUE_MAX`                | integer 1–65536                                                    | `2048`             |

Names follow the OpenTelemetry environment-variable specification so a future
SDK adoption reads the same keys.

## Minimal patch (bootstrap)

```ts
import { setTraceSampleRatio } from './infrastructure/logger/pino-http-options';
import { OtlpHttpJsonExporter } from './infrastructure/telemetry/span-pipeline';
import { TelemetryService } from './infrastructure/telemetry/telemetry.service';
import { runtimeSourceSha } from './infrastructure/health/health.service';

setTraceSampleRatio(config.get('OTEL_TRACES_SAMPLER_RATIO'));
const endpoint = config.get('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT');
if (endpoint) {
  app.get(TelemetryService).enableSpanExport(
    new OtlpHttpJsonExporter({
      endpoint,
      serviceName: 'hsm-api',
      serviceVersion: runtimeSourceSha(),
      headers: parseOtlpHeaders(config.get('OTEL_EXPORTER_OTLP_HEADERS')),
    }),
    { maxQueueSize: config.get('OTEL_SPAN_QUEUE_MAX') },
  );
}
```

## Tests

- `env.validation.spec.ts`: rejects an `http:` endpoint in production, a
  userinfo URL, a ratio outside 0–1, headers without an endpoint.
- Boot test: export off by default; on with a local collector double.

## Not decided here

Which collector or tracing backend, its region and retention. That is an
owner/vendor decision (RISKS.md R23-EXT-2).
