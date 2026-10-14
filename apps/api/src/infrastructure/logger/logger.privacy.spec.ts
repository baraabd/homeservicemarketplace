// R23 — privacy acceptance for logs, spans and metrics.
//
// Boots a real Nest application with the PRODUCTION pino-http options
// (buildPinoHttpOptions), the real AllExceptionsFilter in production mode and
// the real HTTP telemetry middleware, then sends requests carrying synthetic
// secrets in headers, query strings, bodies, exception messages, exception
// causes and SDK-shaped errors. Every byte written to the log stream, every
// exported span and the full /metrics text are searched for each secret.
//
// The span exporter here is an in-memory CONTRACT DOUBLE: it receives exactly
// what a collector would, without a network. Collector behaviour itself is
// covered by span-pipeline.spec.ts.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  MiddlewareConsumer,
  Module,
  NestModule,
  Param,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Logger as PinoNestLogger, LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { Writable } from 'node:stream';
import request from 'supertest';

import { AppConfigService } from '../../config/app-config.service';
import { AllExceptionsFilter } from '../http/all-exceptions.filter';
import { HttpTelemetryMiddleware } from '../telemetry/http-telemetry.middleware';
import { MetricsService } from '../telemetry/metrics.service';
import type { FinishedSpan, SpanExporter } from '../telemetry/span-pipeline';
import { TelemetryService } from '../telemetry/telemetry.service';
import { buildPinoHttpOptions, setTraceSampleRatio } from './pino-http-options';

jest.setTimeout(30_000);

// Secret-shaped values are assembled at runtime, never written as literals:
// a literal is indistinguishable from a real credential to the CI secret
// scanner (docs/security/gitleaks-historical-baseline.md § R23). The runtime
// values are unchanged.
const synthetic = (...parts: string[]): string => ['SYNTH', ...parts].join('');
const base64url = (text: string): string => Buffer.from(text).toString('base64url');

const SECRETS = {
  bearer: 'SYNTHbearer55aa0c9e',
  cookie: 'SYNTHcookie91b2e7',
  apiKey: synthetic('apikey', '3c4d'),
  password: 'SYNTHpassword7f3a',
  resetToken: 'SYNTHresettoken0c1d',
  otp: '914273',
  dbPassword: synthetic('dbpass', '62e1'),
  smtpPassword: 'SYNTHsmtppass11f0',
  awsSignature: 'SYNTHamzsig9a8b7c6d',
  awsSecurityToken: 'SYNTHamztoken4455',
  receipt: 'SYNTHreceiptcontent8899',
  idImage: 'SYNTHidimagebytes2233',
  email: 'synthetic.person@example.test',
  // Invalid correlation id (spaces): must be replaced, never logged raw.
  badRequestId: 'bad id SYNTHreqid77',
  jwt: [
    base64url('{"alg":"HS256"}'),
    base64url('{"sub":"SYNTHjwt"}'),
    base64url('SYNTHjwtsignature'),
  ].join('.'),
  privateKeyBody: 'SYNTHprivatekeymaterial',
  // Precise coordinates must not survive beyond two decimals.
  latFull: '33.513847',
  lngFull: '36.276528',
} as const;

@Controller({ path: 'v1/things' })
class ProbeController {
  private readonly log = new Logger('ProbeController');

  @Post(':id')
  @HttpCode(200)
  receive(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    // A careless debug line of the kind the scrubber exists for.
    this.log.log({ msg: 'received body for debugging', id, body });
    this.log.log(`login attempt for ${SECRETS.email} with password=${SECRETS.password}`);
    return { ok: true };
  }

  @Get('fail/db')
  failDb() {
    throw new Error(
      `connect ECONNREFUSED postgres://app_user:${SECRETS.dbPassword}@db.internal:5432/hsm`,
    );
  }

  @Get('fail/cause')
  failCause() {
    const root = new Error(`upstream rejected Authorization: Bearer ${SECRETS.bearer}`);
    const mid = new Error(`token refresh failed for jwt ${SECRETS.jwt}`, { cause: root });
    throw new Error('request failed', { cause: mid });
  }

  @Get('fail/sdk')
  failSdk() {
    // Shaped like an AWS SDK v3 / nodemailer error: a presigned URL in the
    // message and request metadata hanging off the error object.
    const err = new Error(
      `PUT https://bucket.s3.example.test/k?X-Amz-Signature=${SECRETS.awsSignature}` +
        `&X-Amz-Security-Token=${SECRETS.awsSecurityToken} failed; ` +
        `smtp auth password: ${SECRETS.smtpPassword}`,
    ) as Error & Record<string, unknown>;
    err.name = 'S3ServiceException';
    err.$metadata = { httpStatusCode: 403, requestId: 'r1' };
    err.$response = {
      headers: { authorization: `AWS4-HMAC-SHA256 Signature=${SECRETS.awsSignature}` },
    };
    err.config = { auth: { pass: SECRETS.smtpPassword }, password: SECRETS.smtpPassword };
    throw err;
  }

  @Get('fail/pem')
  failPem() {
    throw new Error(
      `bad key -----BEGIN PRIVATE KEY-----\n${SECRETS.privateKeyBody}\n-----END PRIVATE KEY-----`,
    );
  }
}

interface LogLine {
  msg?: string;
  traceId?: string;
  req?: { method?: string; url?: string; headers: Record<string, string> };
}

class MemoryExporter implements SpanExporter {
  readonly spans: FinishedSpan[] = [];
  async export(spans: readonly FinishedSpan[]): Promise<void> {
    this.spans.push(...spans);
  }
}

describe('R23 privacy: logs, spans and metrics carry no synthetic secret', () => {
  let app: INestApplication;
  let logs = '';
  let metricsText = '';
  const exporter = new MemoryExporter();
  const responses: string[] = [];

  beforeAll(async () => {
    const sink = new Writable({
      write(chunk, _enc, cb) {
        logs += chunk.toString();
        cb();
      },
    });

    @Module({
      imports: [PinoLoggerModule.forRoot({ pinoHttp: [buildPinoHttpOptions('debug'), sink] })],
      controllers: [ProbeController],
      providers: [
        MetricsService,
        TelemetryService,
        HttpTelemetryMiddleware,
        { provide: AppConfigService, useValue: { isProduction: true, get: () => undefined } },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
    class ProbeModule implements NestModule {
      configure(consumer: MiddlewareConsumer) {
        consumer.apply(HttpTelemetryMiddleware).forRoutes('*');
      }
    }

    setTraceSampleRatio(1);
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoNestLogger));
    app.get(TelemetryService).enableSpanExport(exporter, { scheduleDelayMs: 1 });
    await app.init();

    const server = app.getHttpServer();
    const headers = {
      authorization: `Bearer ${SECRETS.bearer}`,
      cookie: `sid=${SECRETS.cookie}; refresh=${SECRETS.jwt}`,
      'x-api-key': SECRETS.apiKey,
      'proxy-authorization': `Basic ${SECRETS.apiKey}`,
      'x-refresh-token': SECRETS.jwt,
      'x-request-id': SECRETS.badRequestId,
    };

    const r1 = await request(server)
      .post(`/v1/things/abc123?token=${SECRETS.resetToken}&otp=${SECRETS.otp}`)
      .set(headers)
      .send({
        email: SECRETS.email,
        password: SECRETS.password,
        otp: SECRETS.otp,
        receipt: SECRETS.receipt,
        documentImage: `data:image/png;base64,${SECRETS.idImage}`,
        nested: { lat: Number(SECRETS.latFull), lng: Number(SECRETS.lngFull) },
        note: `meet at ${SECRETS.latFull}, ${SECRETS.lngFull}`,
      });
    expect(r1.status).toBe(200);
    responses.push(JSON.stringify(r1.body));

    for (const path of ['db', 'cause', 'sdk', 'pem']) {
      const r = await request(server).get(`/v1/things/fail/${path}`).set(headers);
      expect(r.status).toBe(500);
      responses.push(JSON.stringify(r.body));
    }

    await app.get(TelemetryService).spanPipeline?.flush();
    metricsText = await app.get(MetricsService).metrics();
  });

  afterAll(async () => {
    setTraceSampleRatio(0);
    await app?.close();
  });

  const SECRET_ENTRIES = Object.entries(SECRETS).filter(
    ([k]) => k !== 'latFull' && k !== 'lngFull',
  );

  it('wrote a log line for every request and error (the sink is live)', () => {
    expect(logs).toContain('request completed');
    expect(logs).toContain('Unhandled exception');
    expect(logs).toContain('received body for debugging');
  });

  it.each(SECRET_ENTRIES)('log stream does not contain %s', (_name, secret) => {
    expect(logs).not.toContain(secret);
  });

  it.each(SECRET_ENTRIES)('exported spans do not contain %s', (_name, secret) => {
    expect(exporter.spans.length).toBeGreaterThan(0);
    expect(JSON.stringify(exporter.spans)).not.toContain(secret);
  });

  it.each(SECRET_ENTRIES)('metrics exposition does not contain %s', (_name, secret) => {
    expect(metricsText).not.toContain(secret);
  });

  it.each(SECRET_ENTRIES)('client responses do not contain %s', (_name, secret) => {
    expect(responses.join('\n')).not.toContain(secret);
  });

  it('coarsens precise coordinates instead of logging them', () => {
    expect(logs).not.toContain(SECRETS.latFull);
    expect(logs).not.toContain(SECRETS.lngFull);
  });

  it('logs the path without its query string and only allowlisted headers', () => {
    const completed = logs
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LogLine)
      .find((l) => l.msg === 'request completed' && l.req?.method === 'POST');
    expect(completed?.req).toBeDefined();
    const req = completed!.req!;
    expect(req.url).toBe('/v1/things/abc123');
    expect(Object.keys(req.headers).sort()).toEqual(expect.arrayContaining(['content-type']));
    for (const h of [
      'authorization',
      'cookie',
      'x-api-key',
      'proxy-authorization',
      'x-refresh-token',
    ]) {
      expect(req.headers).not.toHaveProperty(h);
    }
    expect(req).not.toHaveProperty('remoteAddress');
    expect(req).not.toHaveProperty('query');
  });

  it('keeps the error class name on scrubbed errors', () => {
    const types = logs
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { err?: { type?: string } })
      .flatMap((l) => (l.err ? [l.err.type] : []));
    expect(types.length).toBeGreaterThan(0);
    expect(types).not.toContain(undefined);
    expect(types).not.toContain('Object');
  });

  it('correlates every request log line with a trace id', () => {
    const lines = logs
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LogLine)
      .filter((l) => l.msg === 'request completed' || l.msg === 'request errored');
    expect(lines.length).toBe(5);
    for (const l of lines) expect(l.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('labels HTTP metrics by route pattern, not by the concrete URL', () => {
    expect(metricsText).toMatch(
      /http_requests_total\{[^}]*route="\/v1\/things\/:id"[^}]*status="200"[^}]*\} 1/,
    );
    expect(metricsText).not.toContain('abc123');
  });
});
