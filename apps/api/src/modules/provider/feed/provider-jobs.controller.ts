import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import type { ListAvailableJobsResponse } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ProviderActiveGuard } from '../guards/provider-active.guard';
import { ListAvailableJobsQueryDto } from './dto/list-available-jobs.query';
import { ProviderJobsService } from './provider-jobs.service';

// /v1/me/provider/jobs/* — Provider marketplace feed (Sprint 5 slice 5.2).
//
// Class-level guards (in order):
//   1. JwtAuthGuard       — authenticated session required.
//   2. RolesGuard('provider') — only provider-role users reach this
//      surface; everyone else gets 403 before any service code runs.
//   3. ProviderActiveGuard — only ACTIVE provider profiles reach the
//      feed. DRAFT, PENDING_REVIEW, SUSPENDED, REJECTED all 403 with
//      a stable `{ code: 'FORBIDDEN' }` envelope.
//
// `providerUserId` is sourced exclusively from the authenticated
// session via @CurrentUser. The DTO declares only the four legal query
// keys (categoryId, city, limit, cursor); the global ValidationPipe's
// `forbidNonWhitelisted: true` rejects payloads that try to inject
// providerId, providerUserId, status, or anything else.
@UseGuards(JwtAuthGuard, RolesGuard, ProviderActiveGuard)
@Roles('provider')
@Controller({ path: 'me/provider/jobs', version: '1' })
export class ProviderJobsController {
  constructor(private readonly jobs: ProviderJobsService) {}

  @Get('available')
  @HttpCode(HttpStatus.OK)
  available(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAvailableJobsQueryDto,
  ): Promise<ListAvailableJobsResponse> {
    return this.jobs.listAvailable(user.id, query);
  }
}
