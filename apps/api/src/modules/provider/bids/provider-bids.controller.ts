import { ProviderCapability } from '@homeservicemarketplace/contracts';
import { RequireCapability } from '../guards/require-capability.decorator';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ListMyBidsResponse,
  SubmitBidResponse,
  WithdrawBidResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ProviderCapabilityGuard } from '../guards/provider-capability.guard';
import { ListMyBidsQueryDto } from './dto/list-my-bids.query';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { ProviderBidsService } from './provider-bids.service';

// Provider bid surface (Sprint 5 slice 5.3 + Sprint 7.1 canonical paths).
//
// Sprint 7.1 mounts the same handlers at TWO base paths:
//   • `/v1/provider/bids`     — canonical (preferred for new clients)
//   • `/v1/me/provider/bids`  — legacy (kept callable for existing clients)
//
// Both paths run the identical guard chain and call the identical
// service methods, so the wire shape and behaviour is the same. The
// frontend was migrated to canonical in Sprint 7.1; the legacy path
// stays mounted as a backwards-compatibility surface.
//
// Class-level guards (in order):
//   1. JwtAuthGuard — authenticated session required.
//   2. RolesGuard('provider') — only provider-role users; everyone else
//      gets 403 before any service code runs.
//   3. ProviderCapabilityGuard — Sprint 9B.8. The class declares
//      VIEW_MARKETPLACE (browsing your own bid history is a marketplace
//      surface); the two MUTATIONS below re-declare SUBMIT_BID, because
//      taking on new work is a strictly stronger claim than looking at it.
//      A provider whose grant lapsed can still read what they bid; they
//      cannot bid again.
//
// Mutating routes additionally use CsrfGuard so a stolen access cookie
// alone cannot drive a bid submission / withdrawal from a hostile
// origin.
//
// `providerUserId` is sourced exclusively from the authenticated
// session via @CurrentUser. The DTOs do NOT declare providerId or
// providerUserId; the global ValidationPipe's `forbidNonWhitelisted: true`
// rejects payloads that try to inject them.
@UseGuards(JwtAuthGuard, RolesGuard, ProviderCapabilityGuard)
@RequireCapability(ProviderCapability.ViewMarketplace)
@Roles('provider')
@Controller({ path: 'provider/bids', version: '1' })
export class ProviderBidsController {
  constructor(private readonly bids: ProviderBidsService) {}

  @UseGuards(CsrfGuard)
  @RequireCapability(ProviderCapability.SubmitBid)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SubmitBidDto,
  ): Promise<SubmitBidResponse> {
    return this.bids.submit(user.id, body);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyBidsQueryDto,
  ): Promise<ListMyBidsResponse> {
    return this.bids.list(user.id, query);
  }

  @UseGuards(CsrfGuard)
  @RequireCapability(ProviderCapability.SubmitBid)
  @Post(':bidId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bidId') bidId: string,
  ): Promise<WithdrawBidResponse> {
    return this.bids.withdraw(user.id, bidId);
  }
}

// Sprint 7.1 — backwards-compatibility shim. Same handlers, same
// guards, same service. Existing clients on `/v1/me/provider/bids`
// keep working until they're migrated. New clients should prefer
// the canonical `/v1/provider/bids` controller above.
//
// Sprint 9B.8 — "same guards" now has to include the per-route capability
// declarations, and it is the whole reason this shim is dangerous: a legacy
// twin that gates more weakly than its canonical partner is not a shim, it is
// a bypass, and it is the one an attacker would find first. The declarations
// below are duplicated deliberately rather than inherited, and a route-parity
// test walks both families over the same fixtures.
@UseGuards(JwtAuthGuard, RolesGuard, ProviderCapabilityGuard)
@RequireCapability(ProviderCapability.ViewMarketplace)
@Roles('provider')
@Controller({ path: 'me/provider/bids', version: '1' })
export class ProviderBidsLegacyController {
  constructor(private readonly bids: ProviderBidsService) {}

  @UseGuards(CsrfGuard)
  @RequireCapability(ProviderCapability.SubmitBid)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SubmitBidDto,
  ): Promise<SubmitBidResponse> {
    return this.bids.submit(user.id, body);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyBidsQueryDto,
  ): Promise<ListMyBidsResponse> {
    return this.bids.list(user.id, query);
  }

  @UseGuards(CsrfGuard)
  @RequireCapability(ProviderCapability.SubmitBid)
  @Post(':bidId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bidId') bidId: string,
  ): Promise<WithdrawBidResponse> {
    return this.bids.withdraw(user.id, bidId);
  }
}
