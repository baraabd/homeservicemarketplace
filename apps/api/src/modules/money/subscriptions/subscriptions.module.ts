import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../../iam/authentication/authentication.module';
import { AuthorizationModule } from '../../iam/authorization/authorization.module';
import { AuditModule } from '../../iam/audit/audit.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EntitlementUsageService } from '../entitlements/entitlement-usage.service';
import { SUBSCRIPTION_CLOCK, systemSubscriptionClock } from '../entitlements/entitlement-policy';
import { PlanVersionService } from './plan-version.service';
import { SubscriptionActivationParticipant } from './subscription-activation.participant';
import {
  SUBSCRIPTION_LIFECYCLE_POLICY,
  SubscriptionLifecycleService,
  unresolvedSubscriptionPolicy,
} from './subscription-lifecycle.service';
import { SubscriptionOutboxHandler } from './subscription-outbox.handler';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  imports: [AuthenticationModule, AuthorizationModule, AuditModule, NotificationsModule],
  controllers: [SubscriptionsController],
  providers: [
    PlanVersionService,
    EntitlementUsageService,
    SubscriptionLifecycleService,
    SubscriptionActivationParticipant,
    SubscriptionOutboxHandler,
    { provide: SUBSCRIPTION_CLOCK, useValue: systemSubscriptionClock },
    { provide: SUBSCRIPTION_LIFECYCLE_POLICY, useValue: unresolvedSubscriptionPolicy },
  ],
  exports: [
    PlanVersionService,
    EntitlementUsageService,
    SubscriptionLifecycleService,
    SubscriptionActivationParticipant,
    SubscriptionOutboxHandler,
    SUBSCRIPTION_CLOCK,
    SUBSCRIPTION_LIFECYCLE_POLICY,
  ],
})
export class SubscriptionsModule {}
