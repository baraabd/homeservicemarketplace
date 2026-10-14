import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { AppConfigService } from '../../../config/app-config.service';
import { Public } from '../../../modules/iam/authentication/decorators/public.decorator';
import { MailMetrics } from '../mail.metrics';
import { verifyFeedbackSignature } from './feedback-signature';
import { feedbackBody, MailFeedbackService } from './mail-feedback.service';

/**
 * R21 — signed delivery feedback (bounces, complaints, deliveries).
 *
 * Public by necessity (the caller is the mail provider, not a user) and
 * therefore authenticated by signature alone. The signature covers the exact
 * request bytes, so this route needs the RAW body: main.ts must mount
 * `express.raw()` for /v1/mail/feedback ahead of the JSON parser (coordinator
 * change request CR-R21-01). Without it the body arrives pre-parsed and every
 * request is refused — fail closed, never "verify a re-serialisation".
 *
 * Responses are deliberately uninformative: 404 when disabled, 401 for any
 * authentication failure, 400 for a malformed authenticated body.
 */
@Controller({ path: 'mail/feedback', version: '1' })
export class MailFeedbackController {
  private readonly log = new Logger(MailFeedbackController.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly feedback: MailFeedbackService,
    private readonly metrics: MailMetrics,
  ) {}

  @Public()
  @Throttle({ default: { limit: 600, ttl: 60 * 1000 } })
  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: Request,
  ): Promise<{ applied: number; duplicate: number; unmatched: number }> {
    const secret = this.config.get('MAIL_FEEDBACK_SIGNING_SECRET');
    if (!secret) {
      this.metrics.feedbackRejectedTotal.inc({ reason: 'disabled' });
      throw new NotFoundException();
    }

    const raw: unknown = req.body;
    if (!Buffer.isBuffer(raw)) {
      this.metrics.feedbackRejectedTotal.inc({ reason: 'malformed' });
      this.log.error({ msg: 'mail.feedback.raw_body_unavailable' });
      throw new BadRequestException();
    }

    const verdict = verifyFeedbackSignature(
      secret,
      req.header('x-mail-feedback-timestamp'),
      req.header('x-mail-feedback-signature'),
      raw,
    );
    if (verdict !== 'ok') {
      this.metrics.feedbackRejectedTotal.inc({ reason: verdict });
      throw new UnauthorizedException();
    }

    let parsed;
    try {
      parsed = feedbackBody.safeParse(JSON.parse(raw.toString('utf8')));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      this.metrics.feedbackRejectedTotal.inc({ reason: 'malformed' });
      throw new BadRequestException();
    }
    return this.feedback.apply(parsed.data);
  }
}
