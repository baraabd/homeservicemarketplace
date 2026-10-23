import { MoneyCommandService } from '../../application/money-command.service';
import { AppError } from '../../../../shared/errors/app-error';
import {
  STRIPE_ADAPTER_ID,
  StripeSandboxConfiguration,
  stripeError,
} from '../../adapters/stripe/stripe-sandbox.config';

export class StripeWebhookService {
  constructor(
    private readonly configuration: StripeSandboxConfiguration,
    private readonly commands: MoneyCommandService,
  ) {}
  async receive(
    rawBody: unknown,
    signature: unknown,
  ): Promise<{ received: true; processing: 'PENDING' | 'COMPLETE' }> {
    if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string')
      throw stripeError('STRIPE_RAW_BODY_REQUIRED', 400);
    const settings = this.configuration.requireEnabled();
    let accepted: Awaited<ReturnType<MoneyCommandService['acceptExternalEvent']>>;
    try {
      // R24 validates via the configured collection adapter and commits inbox
      // evidence before returning. A DB failure must never receive a 2xx ACK.
      accepted = await this.commands.acceptExternalEvent({
        adapterId: STRIPE_ADAPTER_ID,
        mode: 'SANDBOX',
        accountReference: settings.accountReference,
        payload: rawBody,
        headers: { 'stripe-signature': signature },
      });
    } catch (error) {
      // Preserve safe domain failures, never reflect raw database/provider text.
      if (error instanceof AppError) throw error;
      throw stripeError('STRIPE_INBOX_UNAVAILABLE', 503);
    }
    if (accepted.status === 'PROCESSED') return { received: true, processing: 'COMPLETE' };
    // ACK certifies durable receipt only; the registered inbox job processes
    // it after commit and retries across restarts. No unawaited in-memory work.
    return { received: true, processing: 'PENDING' };
  }
}
