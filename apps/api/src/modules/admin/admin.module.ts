import { Module } from '@nestjs/common';

import { AdminAccessModule } from '../iam/admin-access/admin-access.module';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAuditService } from './admin-audit.service';
// Sprint 9B.2 — AdminVerificationPolicyService writes its audit row through the
// IAM AuditService (allowlisted metadata, same transaction as the write).
// AuthenticationModule imports AuditModule but does not re-export it, so the
// import has to be explicit here.
import { AuditModule } from '../iam/audit/audit.module';
import { AdminController } from './admin.controller';
import { AdminRolesController, AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { ProviderVerificationModule } from '../provider/verification/provider-verification.module';
import { AdminVerificationController } from './verification/admin-verification.controller';
import { AdminVerificationCaseCommandsController } from './verification/admin-verification-case-commands.controller';
import { AdminVerificationQueueService } from './verification/admin-verification-queue.service';
import { AdminVerificationPolicyController } from './verification/admin-verification-policy.controller';
import { AdminVerificationPolicyService } from './verification/admin-verification-policy.service';
import { VerificationSettingsService } from '../provider/verification/verification-settings.service';
import { AdminVerificationService } from './verification/admin-verification.service';
import { AdminVerificationCaseService } from './verification/admin-verification-case.service';
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
import { AdminCatalogController } from './catalog/admin-catalog.controller';
import { AdminCatalogService } from './catalog/admin-catalog.service';

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
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    NotificationsModule,
    AdminAccessModule,
    AuditModule,
    // Exports VerificationCaseWorkflowService, the only class allowed to act on
    // the case transition table.
    ProviderVerificationModule,
  ],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminRolesController,
    AdminVerificationController,
    // Sprint 9B.5 — the CASE axis, deliberately its own controller. The one
    // above owns the PROVIDER STATUS axis; 9B.1 established that the two must
    // not be merged, and separate controllers make that structural.
    AdminVerificationCaseCommandsController,
    // Sprint 9B.2 — versioned requirement policies. Per-POLICY, so its own
    // controller rather than more routes under admin/providers/:id.
    AdminVerificationPolicyController,
    AdminDisputesController,
    AdminAnalyticsController,
    AdminFinancialsController,
    AdminSettingsController,
    AdminAuditController,
    AdminNotificationsController,
    AdminCategoryApplicationsController,
    // Phase 4 — admin access-request review queue.
    AdminAccessRequestsController,
    // Sprint 8 — the service-category tree and the equipment catalogue. Both
    // decide what a provider can claim to do, so both are admin-only and
    // fully audited; neither has a delete route.
    AdminCatalogController,
  ],
  providers: [
    AdminVerificationQueueService,
    AdminAuditService,
    AdminUsersService,
    AdminVerificationService,
    AdminVerificationCaseService,
    AdminVerificationPolicyService,
    // Reads verification_policy_max_documents through the canonical
    // PlatformSettingRepository. Provided here rather than exported from the
    // provider module so admin does not import the provider domain.
    VerificationSettingsService,
    AdminDisputesService,
    AdminAnalyticsService,
    AdminFinancialsService,
    AdminSettingsService,
    AdminCategoryApplicationsService,
    AdminCatalogService,
  ],
  exports: [AdminAuditService],
})
export class AdminModule {}
