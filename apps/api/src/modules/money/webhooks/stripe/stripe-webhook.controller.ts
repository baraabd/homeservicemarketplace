import { Controller, HttpCode, Post, Req, Inject } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../../iam/authentication/decorators/public.decorator';
import { StripeWebhookService } from './stripe-webhook.service';
import { stripeError } from '../../adapters/stripe/stripe-sandbox.config';

/** Exact signed endpoint. No cookie authentication or global CSRF exemption. */
@Controller({ path: 'money/webhooks/stripe', version: '1' })
export class StripeWebhookController {
  constructor(@Inject(StripeWebhookService) private readonly webhook: StripeWebhookService) {}
  @Public()
  @Post()
  @HttpCode(200)
  receive(@Req() request: Request) {
    if (request.headers['content-encoding'] !== undefined || !request.is('application/json'))
      throw stripeError('STRIPE_CONTENT_TYPE_INVALID', 400);
    return this.webhook.receive(request.body as unknown, request.headers['stripe-signature']);
  }
}
