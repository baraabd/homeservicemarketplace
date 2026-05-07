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
import { ProviderActiveGuard } from '../guards/provider-active.guard';
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
//   3. ProviderActiveGuard — only ACTIVE provider profiles may bid.
//      DRAFT, PENDING_REVIEW, SUSPENDED, REJECTED → 403.
//
// Mutating routes additionally use CsrfGuard so a stolen access cookie
// alone cannot drive a bid submission / withdrawal from a hostile
// origin.
//
// `providerUserId` is sourced exclusively from the authenticated
// session via @CurrentUser. The DTOs do NOT declare providerId or
// providerUserId; the global ValidationPipe's `forbidNonWhitelisted: true`
// rejects payloads that try to inject them.
@UseGuards(JwtAuthGuard, RolesGuard, ProviderActiveGuard)
@Roles('provider')
@Controller({ path: 'provider/bids', version: '1' })
export class ProviderBidsController {
  constructor(private readonly bids: ProviderBidsService) {}

  @UseGuards(CsrfGuard)
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
@UseGuards(JwtAuthGuard, RolesGuard, ProviderActiveGuard)
@Roles('provider')
@Controller({ path: 'me/provider/bids', version: '1' })
export class ProviderBidsLegacyController {
  constructor(private readonly bids: ProviderBidsService) {}

  @UseGuards(CsrfGuard)
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
  @Post(':bidId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bidId') bidId: string,
  ): Promise<WithdrawBidResponse> {
    return this.bids.withdraw(user.id, bidId);
  }
}
