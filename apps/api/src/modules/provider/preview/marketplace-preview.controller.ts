import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ProviderCapability } from '@homeservicemarketplace/contracts';
import type { ProviderMarketplacePreviewResponse } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { ProviderCapabilityGuard } from '../guards/provider-capability.guard';
import { RequireCapability } from '../guards/require-capability.decorator';
import { MarketplacePreviewService } from './marketplace-preview.service';
import { PREVIEW_NOTICE } from './preview-copy';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';

// Sprint 9B.9 — the only route in the preview family, and it is a GET.
//
// docs/sprint-09b9/REDACTED_MARKETPLACE_PREVIEW.md
//
// There is deliberately no POST, PATCH or DELETE here, and no mutation
// identifier in the response that another route could accept. The audience for
// this surface is providers who may NOT act on the marketplace, so a mutation
// route would be a contradiction rather than a gap — and `ref` is a per-viewer
// pseudonym precisely so it cannot be posted back anywhere as a request id.
//
// Bidding, booking, wallet, earnings and conversations are all gated on
// capabilities this caller does not hold (SUBMIT_BID, MANAGE_BOOKINGS,
// VIEW_EARNINGS), which is enforced by ProviderCapabilityGuard on those
// families rather than restated here. Sprint 9B.8's route matrix is what keeps
// that true.

/** Tighter than the marketplace feed, because the audience is unverified.
 *  60 requests an hour is ample for a person browsing and useless for a
 *  harvest, especially against a total reach the policy already caps. */
const PREVIEW_THROTTLE = { default: { limit: 60, ttl: 60 * 60 * 1000 } } as const;

class MarketplacePreviewQueryDto {
  /** Opaque offset cursor. Length-capped so a hostile cursor cannot become a
   *  payload; the service ignores anything it cannot parse. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  cursor?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard, ProviderCapabilityGuard)
@Roles('provider')
@RequireCapability(ProviderCapability.PreviewMarketplace)
@Controller({ path: 'me/provider/marketplace-preview', version: '1' })
export class MarketplacePreviewController {
  constructor(private readonly preview: MarketplacePreviewService) {}

  @Throttle(PREVIEW_THROTTLE)
  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MarketplacePreviewQueryDto,
  ): Promise<ProviderMarketplacePreviewResponse> {
    const page = await this.preview.page(user.id, { cursor: query.cursor ?? null });

    // A disabled policy is a 200 with `available: false`, not a 404.
    //
    // Deliberate: the caller is an authenticated, eligible provider, and the
    // honest answer is "this is switched off", which the client renders as the
    // notice below. A 404 would be a worse experience AND a worse secret —
    // toggling between 404 and 200 as an operator flips the setting tells any
    // observer exactly when the policy changed.
    // `in` rather than `=== PREVIEW_DISABLED`: comparing to a const object
    // does not narrow the union for TypeScript, and a cast to make it compile
    // would defeat the point of having the two states in the type at all.
    if ('disabled' in page) {
      return {
        available: false,
        items: [],
        nextCursor: null,
        totalReach: 0,
        cellKm: 0,
        notice: PREVIEW_NOTICE,
      };
    }

    return {
      available: true,
      items: page.items,
      nextCursor: page.nextCursor,
      totalReach: page.totalReach,
      cellKm: page.cellKm,
      notice: PREVIEW_NOTICE,
    };
  }
}
