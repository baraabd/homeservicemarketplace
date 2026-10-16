import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppConfigService } from '../../config/app-config.service';
import { MetricsService } from './metrics.service';
import { TelemetryService } from './telemetry.service';
import { TelemetryBootstrap } from './telemetry-bootstrap.service';
function config(values: Record<string, unknown>): AppConfigService {
  return { get: (key: string) => values[key] } as AppConfigService;
}
it('keeps export disabled without an endpoint', () => {
  const telemetry = new TelemetryService(new MetricsService());
  new TelemetryBootstrap(
    config({ OTEL_TRACES_SAMPLER_RATIO: 0 }),
    telemetry,
  ).onApplicationBootstrap();
  expect(telemetry.spanPipeline).toBeNull();
});
it('connects the validated configuration to a bounded export pipeline', async () => {
  const telemetry = new TelemetryService(new MetricsService());
  new TelemetryBootstrap(
    config({
      OTEL_TRACES_SAMPLER_RATIO: 0,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_SPAN_QUEUE_MAX: 8,
    }),
    telemetry,
  ).onApplicationBootstrap();
  expect(telemetry.spanPipeline).not.toBeNull();
  await telemetry.onApplicationShutdown();
});

it('exports a sampled job through the configured local collector with its secret header', async () => {
  const received: { header: string | string[] | undefined; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
    });
    req.on('end', () => {
      received.push({ header: req.headers['x-collector-auth'], body });
      res.writeHead(200).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const telemetry = new TelemetryService(new MetricsService());
  try {
    new TelemetryBootstrap(
      config({
        OTEL_TRACES_SAMPLER_RATIO: 1,
        OTEL_SPAN_QUEUE_MAX: 8,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/traces`,
        OTEL_EXPORTER_OTLP_HEADERS: 'x-collector-auth=synthetic-fixture',
      }),
      telemetry,
    ).onApplicationBootstrap();
    await expect(
      telemetry.runInstrumentedJob('g1.fixture', async () => 'business-result', 1),
    ).resolves.toBe('business-result');
    await telemetry.spanPipeline!.flush();
    expect(received).toHaveLength(1);
    expect(received[0].header).toBe('synthetic-fixture');
    expect(received[0].body).toContain('job g1.fixture');
    expect(received[0].body).not.toContain('synthetic-fixture');
  } finally {
    await telemetry.onApplicationShutdown();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
