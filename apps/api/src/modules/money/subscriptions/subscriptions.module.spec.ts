import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { SubscriptionsModule } from './subscriptions.module';
import { SubscriptionActivationParticipant } from './subscription-activation.participant';
import { SubscriptionOutboxHandler } from './subscription-outbox.handler';
import {
  SUBSCRIPTION_LIFECYCLE_POLICY,
  unresolvedSubscriptionPolicy,
} from './subscription-lifecycle.service';

jest.mock('../../../config/config.module', () => ({ ConfigModule: class ConfigModule {} }));

describe('R31 default lifecycle composition', () => {
  it('exports its one real activation participant and durable handler', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      SubscriptionsModule,
    ) as unknown[];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, SubscriptionsModule) as unknown[];
    for (const service of [SubscriptionActivationParticipant, SubscriptionOutboxHandler]) {
      expect(providers.filter((value) => value === service)).toHaveLength(1);
      expect(exports).toContain(service);
    }
    expect(providers).toContainEqual({
      provide: SUBSCRIPTION_LIFECYCLE_POLICY,
      useValue: unresolvedSubscriptionPolicy,
    });
  });

  it('does not invent renewal, cancellation, refund or reminder policy defaults', () => {
    expect(unresolvedSubscriptionPolicy).toEqual({
      version: null,
      reminderLeadTimeMs: null,
      cancellation: 'BLOCKED',
      suspension: 'BLOCKED',
      refundEffect: 'BLOCKED',
    });
    expect(Object.isFrozen(unresolvedSubscriptionPolicy)).toBe(true);
  });
});
