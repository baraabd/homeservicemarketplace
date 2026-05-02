import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import type {
  AdminFinancialsSummary,
  ListAdminFinancialsBookingsResponse,
  ListAdminFinancialsProviderEarningsResponse,
} from '@homeservicemarketplace/contracts';

import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { AdminFinancialsService } from './admin-financials.service';
import { ListAdminFinancialsBookingsQueryDto } from './dto/list-financials-bookings.query';
import { ListAdminFinancialsProviderEarningsQueryDto } from './dto/list-financials-provider-earnings.query';

// /v1/admin/financials — Sprint 6.4 read-only financials.
//
// Three GET routes; no mutations, no CSRF. Class-level
// JwtAuthGuard + RolesGuard('admin'). Same auth posture as the
// existing /v1/admin/analytics/*.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/financials', version: '1' })
export class AdminFinancialsController {
  constructor(private readonly financials: AdminFinancialsService) {}

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  summary(): Promise<AdminFinancialsSummary> {
    return this.financials.summary();
  }

  @Get('bookings')
  @HttpCode(HttpStatus.OK)
  bookings(
    @Query() query: ListAdminFinancialsBookingsQueryDto,
  ): Promise<ListAdminFinancialsBookingsResponse> {
    return this.financials.listBookings(query);
  }

  @Get('provider-earnings')
  @HttpCode(HttpStatus.OK)
  providerEarnings(
    @Query() query: ListAdminFinancialsProviderEarningsQueryDto,
  ): Promise<ListAdminFinancialsProviderEarningsResponse> {
    return this.financials.listProviderEarnings(query);
  }
}
