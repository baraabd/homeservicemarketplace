import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { ProviderCapability } from '@homeservicemarketplace/contracts';
import type { ProviderPublicProfilePreviewResponse } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { ProviderCapabilityGuard } from '../guards/provider-capability.guard';
import { RequireCapability } from '../guards/require-capability.decorator';
import { ProviderPublicProfileService, type PreviewLang } from './provider-public-profile.service';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';

// Sprint 9B.22 — "show me what a customer sees".
//
//   GET /v1/me/provider/public-profile/preview
//
// docs/sprint-09b22/PUBLIC_PROFILE_AND_PORTFOLIO.md
//
// READ ONLY, and its own controller rather than another route on the onboarding
// wizard: a public profile is not an onboarding concept. It outlives the
// application, it is the same projection a customer-facing route will serve,
// and hanging it off the wizard would tie its lifetime to a draft that gets
// submitted and closed.
//
// EDIT_OWN_PROFILE, matching the portfolio controller beside it — the people
// who may change a headline are the people who may preview it. There is no path
// parameter naming a provider, so there is no surface on which to ask for
// somebody else's; ownership is a WHERE clause in the service on top of that.
//
// No CSRF guard, because there is no mutation here. No throttle beyond the
// global backstop: it is one indexed read of the caller's own row.

export class PublicProfilePreviewQuery {
  /** Which language the localised parts (specialty labels) come back in.
   *  Whitelisted rather than free text — it selects a column. */
  @IsOptional()
  @IsIn(['en', 'ar'])
  lang?: PreviewLang;
}

@UseGuards(JwtAuthGuard, RolesGuard, ProviderCapabilityGuard)
@Roles('provider')
@RequireCapability(ProviderCapability.EditOwnProfile)
@Controller({ path: 'me/provider/public-profile', version: '1' })
export class ProviderPublicProfileController {
  constructor(private readonly service: ProviderPublicProfileService) {}

  @Get('preview')
  @HttpCode(HttpStatus.OK)
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PublicProfilePreviewQuery,
  ): Promise<ProviderPublicProfilePreviewResponse> {
    return this.service.preview(user.id, query.lang ?? 'en');
  }
}
