import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ListPendingCategoriesResponse,
  PendingCategorySummary,
} from '@homeservicemarketplace/contracts';

import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import {
  ListPendingCategoriesQueryDto,
  ReviewCategoryApplicationDto,
} from './dto/admin-category-applications.dto';
import { AdminCategoryApplicationsService } from './admin-category-applications.service';

// Sprint 7.x — admin queue for ProviderCategoryApplication.
//
// Mirrors the conventions used by AdminDisputesController / the rest
// of the admin surface:
//   - JwtAuthGuard + RolesGuard at the class level
//   - @Roles('admin') (the same string used elsewhere)
//   - Mutations additionally guarded by CsrfGuard
//   - Versioned route: /v1/admin/category-applications
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/category-applications', version: '1' })
export class AdminCategoryApplicationsController {
  constructor(private readonly applications: AdminCategoryApplicationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(@Query() query: ListPendingCategoriesQueryDto): Promise<ListPendingCategoriesResponse> {
    return this.applications.list(query);
  }

  @UseGuards(CsrfGuard)
  @Patch(':applicationId/review')
  @HttpCode(HttpStatus.OK)
  review(
    @Param('applicationId') applicationId: string,
    @Body() body: ReviewCategoryApplicationDto,
  ): Promise<PendingCategorySummary> {
    return this.applications.review(applicationId, body);
  }
}
