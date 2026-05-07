import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import type {
  AdminAnalyticsOverview,
  AdminAnalyticsResponse,
  AdminAnalyticsRevenue,
} from '@homeservicemarketplace/contracts';

import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AnalyticsDateRangeQueryDto } from './dto/analytics-date-range.query';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/analytics', version: '1' })
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  summary(): Promise<AdminAnalyticsResponse> {
    return this.analytics.summary();
  }

  // Sprint 6.4 — date-range overview. Defaults to last 30 days when
  // `from`/`to` missing; service caps the range at 365 days.
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  overview(@Query() query: AnalyticsDateRangeQueryDto): Promise<AdminAnalyticsOverview> {
    return this.analytics.overview(query.from, query.to);
  }

  // Sprint 6.4 — daily revenue / fee / net buckets in the request range.
  @Get('revenue')
  @HttpCode(HttpStatus.OK)
  revenue(@Query() query: AnalyticsDateRangeQueryDto): Promise<AdminAnalyticsRevenue> {
    return this.analytics.revenue(query.from, query.to);
  }
}
