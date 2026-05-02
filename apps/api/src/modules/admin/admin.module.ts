import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminController } from './admin.controller';

// Admin module. Hosts every admin-side surface so the
// AuthenticationModule / AuthorizationModule / AdminAuditService
// wiring is shared across slices:
//
//   slice 6.0 ✓ AdminController         — module bootstrap + /health
//   slice 6.1   AdminUsersController    — list/search/suspend/restore
//   slice 6.2   AdminVerificationController — provider approve/reject
//   slice 6.3   AdminDisputesController — open/resolve disputes
//   slice 6.4   AdminAnalyticsController — read-only KPIs
//   slice 6.5   AdminSettingsController — platform settings
//   slice 6.6   AdminAuditController    — audit log read
//
// Repositories (UserRepository, RoleRepository,
// ProviderProfileRepository, AuditEventRepository,
// NotificationRepository, etc.) are provided globally by
// PersistenceModule. NotificationsModule is imported here so admin
// mutations can fan out user-facing notifications (e.g. provider
// approved → notify provider).
@Module({
  imports: [AuthenticationModule, AuthorizationModule, NotificationsModule],
  controllers: [AdminController],
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminModule {}
