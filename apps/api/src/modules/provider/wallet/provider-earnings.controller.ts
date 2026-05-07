import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import type {
  EarningsChart,
  EarningsChartRange,
  EarningsSummary,
  ListProviderEarningsTransactionsResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ProviderActiveGuard } from '../guards/provider-active.guard';
import { ProviderEarningsChartQueryDto } from './dto/provider-earnings-chart.query';
import { ProviderEarningsListQueryDto } from './dto/provider-earnings-list.query';
import { ProviderEarningsService } from './provider-earnings.service';

const DEFAULT_CHART_RANGE: EarningsChartRange = '30d';

// /v1/provider/earnings — Canonical provider wallet read model
// (Sprint 5.6 refined). Read-only. Same auth posture as the other
// canonical provider surfaces: JwtAuthGuard + RolesGuard('provider')
// + ProviderActiveGuard. No CSRF (no mutations).
//
// The legacy /v1/me/provider/earnings controller stays in place for
// backward compatibility while the frontend migrates; both share the
// same BookingRepository aggregate so they cannot diverge.
@UseGuards(JwtAuthGuard, RolesGuard, ProviderActiveGuard)
@Roles('provider')
@Controller({ path: 'provider/earnings', version: '1' })
export class ProviderEarningsController {
  constructor(private readonly earnings: ProviderEarningsService) {}

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  summary(@CurrentUser() user: AuthenticatedUser): Promise<EarningsSummary> {
    return this.earnings.summary(user.id);
  }

  @Get('transactions')
  @HttpCode(HttpStatus.OK)
  transactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProviderEarningsListQueryDto,
  ): Promise<ListProviderEarningsTransactionsResponse> {
    return this.earnings.transactions(user.id, query);
  }

  @Get('chart')
  @HttpCode(HttpStatus.OK)
  chart(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProviderEarningsChartQueryDto,
  ): Promise<EarningsChart> {
    return this.earnings.chart(user.id, query.range ?? DEFAULT_CHART_RANGE);
  }
}
