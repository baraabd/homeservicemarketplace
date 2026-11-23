import { Injectable } from '@nestjs/common';
import {
  MONEY_CONTRACT_VERSION,
  type MoneyStripeSessionV1,
} from '@homeservicemarketplace/contracts';
import { AppConfigService } from '../../../config/app-config.service';
import { AppError } from '../../../shared/errors/app-error';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import { MoneyQueryService } from '../application/money-query.service';
import { StripeBindings, validatePayment } from '../adapters/stripe/stripe-bindings';
import { StripeSdk } from '../adapters/stripe/stripe-sdk';
import { StripeSandboxConfiguration, stripeError } from '../adapters/stripe/stripe-sandbox.config';

@Injectable()
export class StripeSessionService {
  constructor(
    private readonly queries: MoneyQueryService,
    private readonly bindings: StripeBindings,
    private readonly sdk: StripeSdk,
    private readonly stripe: StripeSandboxConfiguration,
    private readonly config: AppConfigService,
    private readonly permissions: PermissionResolverService,
  ) {}
  async session(userId: string, attemptId: string): Promise<MoneyStripeSessionV1> {
    await this.authorize(userId);
    const attempt = await this.queries.attempt(userId, attemptId);
    const intent = await this.queries.intent(userId, attempt.paymentIntentId);
    const result: MoneyStripeSessionV1 = {
      contractVersion: MONEY_CONTRACT_VERSION,
      attemptId,
      paymentIntentId: intent.id,
      amount: intent.total,
      state: 'PROCESSING',
      publishableKey: null,
      clientSecret: null,
    };
    if (intent.status === 'SUCCEEDED') return { ...result, state: 'CONFIRMED' };
    if (
      intent.status !== 'PROCESSING' ||
      attempt.status !== 'STARTED' ||
      new Date(intent.expiresAt).getTime() <= Date.now()
    )
      throw stripeError('STRIPE_ATTEMPT_NOT_PAYABLE', 409);
    const command = await this.bindings.eventCommand(intent.id, attemptId);
    if (!this.stripe.isConfigured(command.binding))
      throw stripeError('STRIPE_CONFIGURATION_UNAVAILABLE');
    if (!command.externalOperationId) return result; // Unknown dispatch: resume the same attempt.
    const key = this.config.get('MONEY_STRIPE_PUBLISHABLE_KEY');
    if (!/^pk_test_[A-Za-z0-9]{16,200}$/u.test(key))
      throw stripeError('STRIPE_CHECKOUT_UNAVAILABLE');
    let raw: unknown;
    try {
      raw = await (await this.sdk.transport()).paymentIntents.retrieve(command.externalOperationId);
    } catch {
      throw stripeError('STRIPE_CHECKOUT_UNAVAILABLE');
    }
    const payment = validatePayment(raw, command);
    // Permission, ownership and current intent state are repeated after network I/O.
    await this.authorize(userId);
    await this.queries.attempt(userId, attemptId);
    const fresh = await this.queries.intent(userId, intent.id);
    if (fresh.status === 'SUCCEEDED') return { ...result, state: 'CONFIRMED' };
    if (fresh.status !== 'PROCESSING' || new Date(fresh.expiresAt).getTime() <= Date.now())
      throw stripeError('STRIPE_ATTEMPT_NOT_PAYABLE', 409);
    this.stripe.requireEnabled();
    if (['processing', 'succeeded'].includes(payment.status)) return result;
    if (
      !['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(
        payment.status,
      )
    )
      throw stripeError('STRIPE_ATTEMPT_NOT_PAYABLE', 409);
    const secret = (raw as { client_secret?: unknown }).client_secret;
    if (
      typeof secret !== 'string' ||
      secret.length > 400 ||
      !secret.startsWith(payment.id + '_secret_') ||
      !/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/u.test(secret)
    )
      throw stripeError('STRIPE_CHECKOUT_UNAVAILABLE');
    return { ...result, state: 'AWAITING_PAYMENT', publishableKey: key, clientSecret: secret };
  }
  private async authorize(userId: string) {
    if (!(await this.permissions.resolveFreshForUser(userId)).has('money:purchase:self'))
      throw new AppError('FORBIDDEN', 'Current purchase authority is required.', 403);
  }
}
