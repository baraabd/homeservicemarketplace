import { Controller, Get, HttpCode, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import type {
  ProviderAvailableRequestDetailResponse,
  ProviderAvailableRequestListResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ProviderActiveGuard } from '../guards/provider-active.guard';
import { ListAvailableRequestsQueryDto } from './dto/list-available-requests.query';
import { AvailableRequestsService } from './available-requests.service';

// /v1/provider/available-requests — Provider available-requests
// feed (Sprint 5.2 canonical path).
//
// Class-level guards (in order):
//   1. JwtAuthGuard            — authenticated session required.
//   2. RolesGuard('provider')  — provider-role users only.
//   3. ProviderActiveGuard     — only ACTIVE provider profiles.
//      DRAFT, PENDING_REVIEW, SUSPENDED, REJECTED → 403 with
//      `{ code: 'FORBIDDEN' }`.
//
// `providerUserId` and `providerProfileId` are sourced exclusively
// from the authenticated session via @CurrentUser; the wire never
// carries them.
@UseGuards(JwtAuthGuard, RolesGuard, ProviderActiveGuard)
@Roles('provider')
@Controller({ path: 'provider/available-requests', version: '1' })
export class AvailableRequestsController {
  constructor(private readonly requests: AvailableRequestsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAvailableRequestsQueryDto,
  ): Promise<ProviderAvailableRequestListResponse> {
    return this.requests.list(user.id, query);
  }

  @Get(':requestId')
  @HttpCode(HttpStatus.OK)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ): Promise<ProviderAvailableRequestDetailResponse> {
    return this.requests.detail(user.id, requestId);
  }
}
