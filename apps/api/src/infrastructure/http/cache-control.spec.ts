import { HttpException, type ArgumentsHost } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import type { AppConfigService } from '../../config/app-config.service';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { privateApiCacheControl } from './cache-control';
import { buildRequestBodyParser } from './request-body';

function server() {
  const app = express();
  const filter = new AllExceptionsFilter({ isProduction: true } as AppConfigService);
  app.use(privateApiCacheControl);
  app.use(buildRequestBodyParser());
  app.get(['/v1', '/v1/private'], (_req, res) => res.json({ synthetic: true }));
  app.get('/v1/error/:status', (req, _res, next) => {
    next(new HttpException({ code: 'SYNTHETIC_ERROR' }, Number(req.params.status)));
  });
  app.get('/v1/media/public/fixture', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send('synthetic public media');
  });
  app.get('/v1/explicit-private', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ synthetic: true });
  });
  app.get('/metrics', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.send('synthetic_metric 1');
  });
  app.get(['/healthz', '/v10/public'], (_req, res) => res.send('ok'));
  app.all(['/v1/media/uploads/fixture', '/v1/mail/feedback/provider'], (req, res) => {
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

function expectPrivateNoStore(value: string | undefined) {
  const directives = (value ?? '')
    .toLowerCase()
    .split(',')
    .map((part) => part.trim());
  expect(directives).toContain('private');
  expect(directives).toContain('no-store');
  expect(directives).not.toContain('public');
}

describe('R27 early private API cache policy', () => {
  it.each(['/v1/private', '/V1/PRIVATE?synthetic=1', '/v1'])(
    'protects the same case-insensitive namespace as Express: %s',
    async (path) => {
      const res = await request(server()).get(path);
      expect(res.status).toBe(200);
      expectPrivateNoStore(res.headers['cache-control']);
    },
  );

  it.each([401, 403, 404, 429])(
    'retains privacy through a downstream %s rejection',
    async (status) => {
      const res = await request(server()).get(`/v1/error/${status}`);
      expect(res.status).toBe(status);
      expectPrivateNoStore(res.headers['cache-control']);
    },
  );

  it('sets privacy before malformed JSON is rejected', async () => {
    const res = await request(server())
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(res.status).toBe(400);
    expectPrivateNoStore(res.headers['cache-control']);
  });

  it('retains privacy for oversized and unsupported-encoding parser failures', async () => {
    const large = await request(server())
      .post('/v1/auth/login')
      .send({ synthetic: 'x'.repeat(1024 * 1024) });
    expect(large.status).toBe(413);
    expectPrivateNoStore(large.headers['cache-control']);
    const encoded = await request(server())
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'r27-unsupported')
      .send('{}');
    expect(encoded.status).toBe(415);
    expectPrivateNoStore(encoded.headers['cache-control']);
  });

  it('preserves exact raw upload and signed-feedback bytes', async () => {
    const bytes = Buffer.from('synthetic\u0000opaque');
    for (const path of ['/v1/media/uploads/fixture', '/v1/mail/feedback/provider']) {
      const res = await request(server())
        .post(path)
        .set('Content-Type', 'application/octet-stream')
        .send(bytes);
      expect(res.status).toBe(200);
      expect(res.body.bytes).toBe(bytes.length);
      expectPrivateNoStore(res.headers['cache-control']);
    }
  });

  it('allows later explicit public-media and private route policies to replace the default', async () => {
    const publicMedia = await request(server()).get('/v1/media/public/fixture');
    expect(publicMedia.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const privateRoute = await request(server()).get('/v1/explicit-private');
    expect(privateRoute.headers['cache-control']).toBe('no-store');
  });

  it('leaves metrics and paths outside the versioned API to their existing policies', async () => {
    const metrics = await request(server()).get('/metrics');
    expect(metrics.headers['cache-control']).toBe('no-store');
    for (const path of ['/healthz', '/v10/public']) {
      const res = await request(server()).get(path);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBeUndefined();
    }
  });
});
