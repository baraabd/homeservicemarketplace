import 'reflect-metadata';
import { Catch, type ArgumentsHost, type ExceptionFilter, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express, { type Response } from 'express';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { AppError } from '../../../../shared/errors/app-error';
import { IS_PUBLIC_KEY } from '../../../iam/authentication/decorators/public.decorator';
import { STRIPE_BODY_LIMIT } from '../../adapters/stripe/stripe-sandbox.config';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Catch(AppError)
class SafeErrorFilter implements ExceptionFilter {
  catch(error: AppError, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(error.status).json({ code: error.code });
  }
}
// Isolated real HTTP parser/controller test; service is an explicit contract double.
describe('R29 exact signed HTTP endpoint', () => {
  let app: INestApplication;
  const receive = jest.fn().mockResolvedValue({ received: true, processing: 'PENDING' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [{ provide: StripeWebhookService, useValue: { receive } }],
    }).compile();
    app = module.createNestApplication({ bodyParser: false });
    const router = express.Router();
    router.post(
      '/v1/money/webhooks/stripe',
      express.raw({ type: 'application/json', limit: STRIPE_BODY_LIMIT, inflate: false }),
    );
    router.use(express.json());
    app.use(router);
    app.useGlobalFilters(new SafeErrorFilter());
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('preserves whitespace and bytes on the exact POST route', async () => {
    const raw = '{ "fixture":  1 }\n';
    const result = await request(app.getHttpServer())
      .post('/v1/money/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 'signed')
      .send(raw);
    expect(result.status).toBe(200);
    expect(receive).toHaveBeenLastCalledWith(Buffer.from(raw), 'signed');
  });
  it.each(['/v1/money/webhooks/stripe/extra', '/v1/money/webhooks/other'])(
    'does not expose a wildcard route %s',
    async (path) => {
      expect((await request(app.getHttpServer()).post(path).send({})).status).toBe(404);
    },
  );
  it('rejects GET and non-JSON content', async () => {
    expect((await request(app.getHttpServer()).get('/v1/money/webhooks/stripe')).status).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/money/webhooks/stripe')
          .set('content-type', 'text/plain')
          .send('body')
      ).status,
    ).toBe(400);
  });
  it('bounds raw request bytes before service dispatch', async () => {
    const before = receive.mock.calls.length;
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/money/webhooks/stripe')
          .set('content-type', 'application/json')
          .send('x'.repeat(STRIPE_BODY_LIMIT + 1))
      ).status,
    ).toBe(413);
    expect(receive.mock.calls.length).toBe(before);
  });
  it('rejects compressed body reinterpretation', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/money/webhooks/stripe')
          .set('content-type', 'application/json')
          .set('content-encoding', 'gzip')
          .send('bytes')
      ).status,
    ).toBe(415);
  });
  it('marks only the signed method public, with no class-wide auth exemption', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, StripeWebhookController.prototype.receive)).toBe(
      true,
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, StripeWebhookController)).toBeUndefined();
  });
});
