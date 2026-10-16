import type { ArgumentsHost } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import type { AppConfigService } from '../../config/app-config.service';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { buildRequestBodyParser } from './request-body';

function server(production: boolean) {
  const app = express();
  const filter = new AllExceptionsFilter({ isProduction: production } as AppConfigService);
  app.use(buildRequestBodyParser());
  app.use((req, res) => {
    const body: unknown = req.body;
    res.json({ bytes: Buffer.isBuffer(body) ? Buffer.byteLength(body) : 0 });
  });
  app.use(
    (error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      filter.catch(error, {
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      } as ArgumentsHost);
    },
  );
  return app;
}

describe.each([true, false])('R26 HTTP parser boundary (production=%s)', (production) => {
  it('rejects malformed JSON without echoing submitted content in any environment', async () => {
    const sentinel = randomUUID();
    const res = await request(server(production))
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ password: sentinel }).slice(0, -1) + ',');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain(sentinel);
    expect(JSON.stringify(res.body)).not.toMatch(/password|SyntaxError|stack/);
  });
  it('maps an oversized JSON request to a safe 413', async () => {
    const res = await request(server(production))
      .post('/v1/auth/login')
      .send({ value: 'x'.repeat(1024 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    if (production) expect(res.body.error).not.toHaveProperty('details');
    else
      expect(res.body.error.details).toEqual({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large.',
      });
  });
  it('refuses unsupported encoding without reflecting it', async () => {
    const res = await request(server(production))
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'r26-private-encoding')
      .send('{}');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(JSON.stringify(res.body)).not.toContain('r26-private-encoding');
  });
  it('bounds early-error correlation IDs before normal request middleware runs', async () => {
    const res = await request(server(production))
      .post('/v1/auth/login')
      .set('X-Request-ID', 'sensitive-correlation-'.repeat(100))
      .set('Content-Type', 'application/json')
      .send('{');
    expect(res.body.error.requestId).toBeUndefined();
  });
  it('preserves opaque signed bytes and enforces the smaller feedback limit', async () => {
    const data = Buffer.from('not-json\u0000\u00ff');
    const ok = await request(server(production))
      .post('/v1/mail/feedback/provider')
      .set('Content-Type', 'application/json')
      .send(data.toString());
    expect(ok.status).toBe(200);
    expect(ok.body.bytes).toBe(data.length);
    const large = await request(server(production))
      .post('/v1/mail/feedback/provider')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(256 * 1024 + 1));
    expect(large.status).toBe(413);
  });
  it('allows a legitimate raw upload and refuses bytes beyond its 10 MiB cap', async () => {
    const ok = await request(server(production))
      .put('/v1/media/uploads/fixture')
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(1024 * 1024 + 1));
    expect(ok.status).toBe(200);
    expect(ok.body.bytes).toBe(1024 * 1024 + 1);
    const large = await request(server(production))
      .put('/v1/media/uploads/fixture')
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(10 * 1024 * 1024 + 1));
    expect(large.status).toBe(413);
  });
});
