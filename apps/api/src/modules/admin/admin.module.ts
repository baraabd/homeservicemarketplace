import { Module } from '@nestjs/common';

import { AdminAccessModule } from '../iam/admin-access/admin-access.module';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminController } from './admin.controller';
import { AdminRolesController, AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminVerificationController } from './verification/admin-verification.controller';
import { AdminVerificationService } from './verification/admin-verification.service';
import { AdminAnalyticsController } from './analytics/admin-analytics.controller';
import { AdminAnalyticsService } from './analytics/admin-analytics.service';
import { AdminDisputesController } from './disputes/admin-disputes.controller';
import { AdminDisputesService } from './disputes/admin-disputes.service';
import { AdminFinancialsController } from './financials/admin-financials.controller';
import { AdminFinancialsService } from './financials/admin-financials.service';
import { AdminAuditController } from './audit/admin-audit.controller';
import { AdminNotificationsController } from './notifications/admin-notifications.controller';
import { AdminSettingsController } from './settings/admin-settings.controller';
import { AdminSettingsService } from './settings/admin-settings.service';
import { AdminCategoryApplicationsController } from './category-applications/admin-category-applications.controller';
import { AdminCategoryApplicationsService } from './category-applications/admin-category-applications.service';
import { AdminAccessRequestsController } from './access-requests/admin-access-requests.controller';

// Admin module. Hosts every admin-side surface so the
// AuthenticationModule / AuthorizationModule / AdminAuditService
// wiring is shared across slices:
//
//   slice 6.0 ✓ AdminController            — module bootstrap + /health
//   slice 6.1 ✓ AdminUsersController       — list/search/suspend/restore
//   slice 6.2   AdminVerificationController — provider approve/reject
//   slice 6.3   AdminDisputesController    — open/resolve disputes
//   slice 6.4   AdminAnalyticsController   — read-only KPIs
//   slice 6.5   AdminSettingsController    — platform settings
//   slice 6.6   AdminAuditController       — audit log read
//
// Repositories (UserRepository, RoleRepository,
// ProviderProfileRepository, AuditEventRepository,
// NotificationRepository, etc.) are provided globally by
// PersistenceModule. NotificationsModule is imported here so admin
// mutations can fan out user-facing notifications (e.g. provider
// approved → notify provider).
@Module({
  // AdminAccessModule exports the AdminAccessService the review controller
  // below reuses — one lifecycle implementation for both sides of the axis.
  imports: [AuthenticationModule, AuthorizationModule, NotificationsModule, AdminAccessModule],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminRolesController,
    AdminVerificationController,
    AdminDisputesController,
    AdminAnalyticsController,
    AdminFinancialsController,
    AdminSettingsController,
    AdminAuditController,
    AdminNotificationsController,
    AdminCategoryApplicationsController,
    // Phase 4 — admin access-request review queue.
    AdminAccessRequestsController,
  ],
  providers: [
    AdminAuditService,
    AdminUsersService,
    AdminVerificationService,
    AdminDisputesService,
    AdminAnalyticsService,
    AdminFinancialsService,
    AdminSettingsService,
    AdminCategoryApplicationsService,
  ],
  exports: [AdminAuditService],
})
export class AdminModule {}
