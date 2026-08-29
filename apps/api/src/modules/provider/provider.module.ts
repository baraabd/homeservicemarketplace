import { ProviderPortfolioController } from './portfolio/provider-portfolio.controller';
import { ProviderPortfolioService } from './portfolio/provider-portfolio.service';
// Sprint 9B.22 — the customer-facing projection, served to its own owner.
import { ProviderPublicProfileController } from './public-profile/provider-public-profile.controller';
import { ProviderPublicProfileService } from './public-profile/provider-public-profile.service';
import { MarketplacePreviewController } from './preview/marketplace-preview.controller';
import { MarketplacePreviewService } from './preview/marketplace-preview.service';
import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AvailableRequestsController } from './available-requests/available-requests.controller';
import { AvailableRequestsService } from './available-requests/available-requests.service';
import {
  ProviderBidsController,
  ProviderBidsLegacyController,
} from './bids/provider-bids.controller';
import { ProviderBidsService } from './bids/provider-bids.service';
import { ProviderCategoriesController } from './categories/provider-categories.controller';
import { ProviderCategoriesService } from './categories/provider-categories.service';
import { ProviderBookingsCanonicalController } from './bookings/provider-bookings-canonical.controller';
import { ProviderBookingsController } from './bookings/provider-bookings.controller';
import { ProviderBookingsService } from './bookings/provider-bookings.service';
import { ProviderJobsController } from './feed/provider-jobs.controller';
import { ProviderJobsService } from './feed/provider-jobs.service';
import { AuditModule } from '../iam/audit/audit.module';
import { ProviderCapabilitiesController } from './capability/provider-capabilities.controller';
import { ProviderCapabilityModule } from './capability/provider-capability.module';
import { ProviderOnboardingService } from './onboarding/provider-onboarding.service';
import { ProviderOnboardingWizardController } from './onboarding/provider-onboarding-wizard.controller';
import { ProviderOnboardingWizardService } from './onboarding/provider-onboarding-wizard.service';
// Sprint 9B.20 — earned service-area expansion. Default off.
import { ProviderServiceAreaExpansionService } from './onboarding/service-area/expansion/provider-service-area-expansion.service';
import { ProviderAvatarService } from './onboarding/avatar/provider-avatar.service';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';
import { ProviderEarningsController } from './wallet/provider-earnings.controller';
import { ProviderEarningsService } from './wallet/provider-earnings.service';
import { ProviderWalletController } from './wallet/provider-wallet.controller';
import { ProviderWalletService } from './wallet/provider-wallet.service';

// Provider module. Hosts every provider-side surface so the
// AuthenticationModule / AuthorizationModule / ProviderActiveGuard
// wiring is shared across slices:
//
//   slice 5.1   ProviderController     — profile + skills + availability
//   slice 5.2   ProviderJobsController — available-jobs feed
//   slice 5.3   ProviderBidsController — submit-bid, my-bids, withdraw
//   slice 5.4+  (TBD)                  — provider booking lifecycle
//   slice 5.6+  (TBD)                  — earnings read model
//
// Repositories (UserRepository, RoleRepository, ProviderProfileRepository,
// ServiceCategoryRepository, ServiceRequestRepository,
// ServiceRequestEventRepository, BidRepository) are provided globally by
// PersistenceModule; TransactionRunner by PrismaModule;
// NotificationsService by NotificationsModule.
@Module({
  // AuditModule: the onboarding service writes a PROVIDER_ONBOARDING_SUBMITTED
  // audit row inside the same transaction as the state transition, and Sprint 2
  // adds PROVIDER_CATEGORY_APPLIED / PROVIDER_CATEGORY_REMOVED on the same
  // terms.
  // ProviderCapabilityModule owns ProviderActiveGuard and the capability
  // service it needs. Importing it rather than re-declaring them here is what
  // keeps ONE owner for the provider authorization gate — a second declaration
  // is how the Sprint 7 boot crash happened.
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    NotificationsModule,
    AuditModule,
    ProviderCapabilityModule,
    // Sprint 9B.17 — the avatar finalize step reads the uploaded object back
    // out of storage before linking it, so this module needs the public
    // StoragePort. Restricted evidence storage is a DIFFERENT token and is
    // deliberately not reachable from here.
    StorageModule,
  ],
  controllers: [
    ProviderController,
    // Sprint 9B.9 — the redacted preview. Read-only, and the only route in its
    // family; see the controller for why there is no mutation counterpart.
    MarketplacePreviewController,
    // Sprint 9B.10 — the provider's public gallery. EDIT_OWN_PROFILE, because
    // a portfolio is profile content.
    ProviderPortfolioController,
    // Sprint 9B.22 — read-only preview of the public projection.
    ProviderPublicProfileController,
    // Sprint 2 — /me/provider/categories/applications. A separate controller
    // rather than more routes on ProviderController: applying for a skill is
    // moderated and asynchronous, editing a profile is neither, and the two
    // sat one method apart for long enough that one silently did the other's
    // job.
    ProviderCategoriesController,
    ProviderJobsController,
    AvailableRequestsController,
    ProviderBidsController,
    ProviderBidsLegacyController,
    ProviderBookingsController,
    ProviderBookingsCanonicalController,
    ProviderWalletController,
    ProviderEarningsController,
    // Sprint 7 — GET /v1/me/provider/capabilities. Guarded by JwtAuthGuard
    // only: it EXPLAINS the provider gate, so gating it on that gate would
    // hide the answer from exactly the providers who need it.
    ProviderCapabilitiesController,
    // Sprint 8 — the onboarding wizard. A separate controller from
    // ProviderController because it is a different surface with different
    // gating: every route here must be reachable by a DRAFT provider who holds
    // no marketplace capability at all.
    ProviderOnboardingWizardController,
  ],
  providers: [
    MarketplacePreviewService,
    ProviderPortfolioService,
    ProviderPublicProfileService,
    ProviderService,
    ProviderJobsService,
    AvailableRequestsService,
    ProviderBidsService,
    ProviderBookingsService,
    ProviderWalletService,
    ProviderEarningsService,
    // Phase 4 — DRAFT → submit-for-review → PENDING_REVIEW.
    ProviderOnboardingService,
    // Sprint 8 — the wizard: get, per-step patch, submit, withdraw.
    ProviderOnboardingWizardService,
    // Sprint 9B.20 — resolves the earned radius ceiling the wizard serves.
    // Behind provider_service_area_expansion_enabled, which defaults to false:
    // with it off this service short-circuits before reading a single signal.
    ProviderServiceAreaExpansionService,
    // Sprint 9B.17 — avatar finalize. Depends on the wizard service so the
    // photo is written through the SAME versioned step path as every other
    // field rather than a second write path with its own rules.
    ProviderAvatarService,
    // Sprint 2 — provider-side skill applications.
    ProviderCategoriesService,
  ],
  // Re-exported so existing importers of ProviderModule keep resolving the
  // guard and the capability service without also having to know about
  // ProviderCapabilityModule.
  exports: [ProviderService, ProviderOnboardingService, ProviderCapabilityModule],
})
export class ProviderModule {}
