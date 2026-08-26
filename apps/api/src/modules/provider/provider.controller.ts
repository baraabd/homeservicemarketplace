import { ProviderCapability } from '@homeservicemarketplace/contracts';
import { ProviderCapabilityGuard } from './guards/provider-capability.guard';
import { RequireCapability } from './guards/require-capability.decorator';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  GetProviderProfileResponse,
  ProviderOnboardingStatus,
  SubmitProviderForReviewResponse,
  UpdateProviderAvailabilityResponse,
  UpdateProviderProfileResponse,
  UpgradeToProviderResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { Roles } from '../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../iam/authorization/guards/roles.guard';
import { UpdateProviderAvailabilityDto } from './dto/update-provider-availability.dto';
import { UpdateProviderProfileDto } from './dto/update-provider-profile.dto';
import { UpgradeToProviderDto } from './dto/upgrade-to-provider.dto';
import { SubmitProviderForReviewDto } from './dto/submit-provider-for-review.dto';
import { ProviderOnboardingService } from './onboarding/provider-onboarding.service';
import { ProviderService } from './provider.service';

// /v1/me/provider/* — Provider-facing profile surface (Sprint 5 slice 5.1).
//
// Class-level guards: every route requires a valid session (JwtAuthGuard).
// Read/write profile + availability ALSO require the `provider` role —
// non-provider users get a hard 403 from RolesGuard before any service
// code runs. The upgrade route is the only path that does NOT require
// the provider role yet — that's how a seeker promotes themselves.
//
// `userId` is sourced exclusively from the authenticated session via
// @CurrentUser. Body DTOs declare only allowed fields; the global
// ValidationPipe's `forbidNonWhitelisted: true` rejects payloads that
// try to inject email / userId / role / status / reputation columns.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/provider', version: '1' })
export class ProviderController {
  constructor(
    private readonly provider: ProviderService,
    private readonly onboarding: ProviderOnboardingService,
  ) {}

  // Phase 4 — an upgrade is NOT an application. It grants the provider role
  // and opens a DRAFT profile. Reaching the admin review queue requires the
  // explicit submit-for-review call below, which enforces the completeness
  // policy first. Idempotent: calling it twice returns the existing profile.
  @UseGuards(CsrfGuard)
  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  upgrade(
    @CurrentUser() user: AuthenticatedUser,
    // Empty-body DTO. forbidNonWhitelisted rejects ANY field a client
    // tries to inject (userId, role, status, isAdmin, …). The body is
    // intentionally unused — userId comes from the authenticated session.
    @Body() _body: UpgradeToProviderDto,
  ): Promise<UpgradeToProviderResponse> {
    return this.provider.upgrade(user.id);
  }

  // Phase 4 — what the Provider app reads to decide whether Submit is
  // enabled, so it never re-derives the server's completeness policy.
  // Sprint 9B.8 — a READ of the caller's own onboarding status, so it follows
  // VIEW_OWN_PROFILE. Gating it on COMPLETE_ONBOARDING would 403 an ACCEPTED
  // provider asking about their own record, which is both wrong and a
  // regression: nothing about reading your status stops being reasonable once
  // you are onboarded.
  @UseGuards(ProviderCapabilityGuard, RolesGuard)
  @Roles('provider')
  @RequireCapability(ProviderCapability.ViewOwnProfile)
  @Get('onboarding')
  @HttpCode(HttpStatus.OK)
  getOnboarding(@CurrentUser() user: AuthenticatedUser): Promise<ProviderOnboardingStatus> {
    return this.onboarding.getStatus(user.id);
  }

  // Phase 4 — DRAFT → PENDING_REVIEW. Returns 422 with machine-readable
  // missing-field codes when the application is incomplete.
  // Sprint 9B.8 — the application itself. Distinct from editing: a suspended provider may not re-enter the queue.
  @UseGuards(ProviderCapabilityGuard, CsrfGuard, RolesGuard)
  @Roles('provider')
  @RequireCapability(ProviderCapability.SubmitForReview)
  @Post('submit-for-review')
  @HttpCode(HttpStatus.OK)
  submitForReview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _body: SubmitProviderForReviewDto,
  ): Promise<SubmitProviderForReviewResponse> {
    return this.onboarding.submitForReview(user.id);
  }

  // Phase 4 — PENDING_REVIEW → DRAFT. The counterpart to the edit lock: a
  // queued application cannot be edited, so the provider needs a visible way
  // out of the queue.
  // Sprint 9B.8 — the inverse of submitting, and gated with it — withdrawing is part of owning the application.
  @UseGuards(ProviderCapabilityGuard, CsrfGuard, RolesGuard)
  @Roles('provider')
  @RequireCapability(ProviderCapability.SubmitForReview)
  @Post('withdraw-review')
  @HttpCode(HttpStatus.OK)
  withdrawFromReview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() _body: SubmitProviderForReviewDto,
  ): Promise<SubmitProviderForReviewResponse> {
    return this.onboarding.withdrawFromReview(user.id);
  }

  // Sprint 9B.8 — a locked-out provider must still READ their own record, or the denial is a dead end they cannot even see.
  @UseGuards(ProviderCapabilityGuard, RolesGuard)
  @Roles('provider')
  @RequireCapability(ProviderCapability.ViewOwnProfile)
  @Get('profile')
  @HttpCode(HttpStatus.OK)
  getProfile(@CurrentUser() user: AuthenticatedUser): Promise<GetProviderProfileResponse> {
    return this.provider.get(user.id);
  }

  // Sprint 9B.8 — writing is a strictly stronger claim than reading. Rank 3 (SUSPENDED) grants VIEW_OWN_PROFILE and withholds EDIT_OWN_PROFILE; this is where that becomes real.
  @UseGuards(ProviderCapabilityGuard, CsrfGuard, RolesGuard)
  @Roles('provider')
  @RequireCapability(ProviderCapability.EditOwnProfile)
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProviderProfileDto,
  ): Promise<UpdateProviderProfileResponse> {
    return this.provider.update(user.id, body);
  }

  // Sprint 9B.8 — availability is profile state a suspended provider must not be able to change.
  @UseGuards(ProviderCapabilityGuard, CsrfGuard, RolesGuard)
  @Roles('provider')
  @RequireCapability(ProviderCapability.EditOwnProfile)
  @Patch('availability')
  @HttpCode(HttpStatus.OK)
  updateAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProviderAvailabilityDto,
  ): Promise<UpdateProviderAvailabilityResponse> {
    return this.provider.updateAvailability(user.id, body);
  }
}
