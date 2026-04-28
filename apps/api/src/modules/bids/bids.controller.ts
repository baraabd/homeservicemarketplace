import {
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
  AcceptBidResponse,
  BidListResponse,
  BidSummary,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { BidsService } from './bids.service';
import { ListBidsQueryDto } from './dto/list-bids.query';

// /v1/me/requests/:requestId/bids — Seeker-facing bid surface.
//
// Read endpoints (slice 2.1) require JwtAuthGuard. The accept endpoint
// (slice 2.2) additionally requires CsrfGuard so a stolen access cookie
// alone cannot drive an accept from a hostile origin.
//
// `seekerUserId` is sourced exclusively from the authenticated session
// via @CurrentUser. Path params (`requestId`, `bidId`) are the only
// client input; the service layer verifies request ownership +
// bid-belongs-to-request before mutating, so a foreign requestId
// always yields 404 NOT_FOUND and never leaks the existence of any
// bids or bookings on it.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/requests/:requestId/bids', version: '1' })
export class BidsController {
  constructor(private readonly bids: BidsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Query() query: ListBidsQueryDto,
  ): Promise<BidListResponse> {
    return this.bids.listForRequest(user.id, requestId, query);
  }

  @Get(':bidId')
  @HttpCode(HttpStatus.OK)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Param('bidId') bidId: string,
  ): Promise<BidSummary> {
    return this.bids.detail(user.id, requestId, bidId);
  }

  @UseGuards(CsrfGuard)
  @Post(':bidId/accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Param('bidId') bidId: string,
  ): Promise<AcceptBidResponse> {
    return this.bids.accept(user.id, requestId, bidId);
  }
}
