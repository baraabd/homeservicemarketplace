#!/usr/bin/env node
'use strict';

// R23 — synthetic failure target for the alert-path test.
//
// Boots a minimal Nest application from the COMPILED API (apps/api/dist): the
// real MetricsModule (metrics registry, /metrics controller and access guard,
// HTTP telemetry middleware) and the real production pino-http options. Only
// the route under test is synthetic: GET /v1/synthetic/ok answers 200 and
// GET /v1/synthetic/fail throws, so the 5xx is produced by the same exception
// path a real handler failure takes.
//
// This is not the full API. It proves the instrumentation, rules, routing and
// receiver chain; it does not prove a hosted deployment (see ACCEPTANCE.md).
//
// Usage: node synthetic-target.cjs <port> <log-file>
// Requires `pnpm --filter @homeservicemarketplace/api build` first.

const path = require('node:path');
const fs = require('node:fs');

const apiRoot = path.resolve(__dirname, '../../../apps/api');
const dist = path.join(apiRoot, 'dist');
const fromApi = (id) => require(require.resolve(id, { paths: [apiRoot] }));

const port = Number(process.argv[2] ?? 19100);
const logFile = process.argv[3];
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('usage: synthetic-target.cjs <port 1024-65535> <log-file>');
  process.exit(2);
}
if (!logFile) {
  console.error('a log file path is required');
  process.exit(2);
}
if (!fs.existsSync(path.join(dist, 'infrastructure/telemetry/metrics.module.js'))) {
  console.error('apps/api/dist is missing; run the API build first');
  process.exit(2);
}

require(require.resolve('reflect-metadata', { paths: [apiRoot] }));
const { Controller, Get, Global, Module } = fromApi('@nestjs/common');
const { NestFactory, APP_FILTER } = fromApi('@nestjs/core');
const { LoggerModule: PinoLoggerModule, Logger: PinoNestLogger } = fromApi('nestjs-pino');

const { MetricsModule } = require(path.join(dist, 'infrastructure/telemetry/metrics.module.js'));
const { AppConfigService } = require(path.join(dist, 'config/app-config.service.js'));
const { AllExceptionsFilter } = require(
  path.join(dist, 'infrastructure/http/all-exceptions.filter.js'),
);
const { buildPinoHttpOptions } = require(
  path.join(dist, 'infrastructure/logger/pino-http-options.js'),
);

// Non-production with no METRICS_TOKEN: the access guard's documented "open"
// branch, so the local Prometheus can scrape without a credential. A hosted
// scrape uses the bearer token (shared-change-requests/CR-05).
const configStub = {
  isProduction: false,
  get: () => undefined,
};

class SyntheticController {
  ok() {
    return { ok: true };
  }
  fail() {
    throw new Error('synthetic failure injected by the R23 alert-path test');
  }
}
Controller('v1/synthetic')(SyntheticController);
for (const [method, route] of [
  ['ok', 'ok'],
  ['fail', 'fail'],
]) {
  Get(route)(
    SyntheticController.prototype,
    method,
    Object.getOwnPropertyDescriptor(SyntheticController.prototype, method),
  );
}

class ConfigStubModule {}
Global()(ConfigStubModule);
Module({
  providers: [{ provide: AppConfigService, useValue: configStub }],
  exports: [AppConfigService],
})(ConfigStubModule);

class SyntheticAppModule {}
Module({
  imports: [
    ConfigStubModule,
    PinoLoggerModule.forRoot({
      pinoHttp: [buildPinoHttpOptions('info'), fs.createWriteStream(logFile, { flags: 'a' })],
    }),
    MetricsModule,
  ],
  controllers: [SyntheticController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})(SyntheticAppModule);

(async () => {
  const app = await NestFactory.create(SyntheticAppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoNestLogger));
  app.enableShutdownHooks();
  // Loopback only: Docker Desktop forwards host.docker.internal to it.
  await app.listen(port, '127.0.0.1');
  process.stdout.write(`synthetic-target listening on 127.0.0.1:${port}\n`);
})().catch((err) => {
  console.error('synthetic-target failed to start:', err && err.name);
  process.exit(1);
});
