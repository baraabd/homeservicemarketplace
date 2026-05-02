import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import type { AdminAnalyticsResponse } from '@homeservicemarketplace/contracts';

import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { AdminAnalyticsService } from './admin-analytics.service';

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
}
