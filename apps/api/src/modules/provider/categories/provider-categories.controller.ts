import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ApplyForCategoryResponse,
  ListMyCategoryApplicationsResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ApplyForCategoryDto } from './dto/apply-for-category.dto';
import { ListMyCategoryApplicationsQueryDto } from './dto/list-my-category-applications.query';
import { ProviderCategoriesService } from './provider-categories.service';

// /v1/me/provider/categories/applications — the provider's own skill
// applications (Sprint 2).
//
// The route is under /me for the same reason the rest of the provider surface
// is: the subject is the session user, and no path or body parameter names
// whose applications these are. Ownership cannot be expressed wrongly because
// it cannot be expressed at all.
//
// Guards mirror the sibling provider routes exactly — session, then the
// provider role, then CSRF on the mutation. A seeker with a valid session is
// stopped by RolesGuard before any service code runs.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('provider')
@Controller({ path: 'me/provider/categories/applications', version: '1' })
export class ProviderCategoriesController {
  constructor(private readonly categories: ProviderCategoriesService) {}

  // 201: an application was created and is queued. Deliberately NOT 200 — the
  // provider gained nothing they can use yet, and a 200 next to the profile
  // PATCH's 200 would blur exactly the distinction this sprint draws.
  @UseGuards(CsrfGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ApplyForCategoryDto,
  ): Promise<ApplyForCategoryResponse> {
    return this.categories.apply(user.id, body);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyCategoryApplicationsQueryDto,
  ): Promise<ListMyCategoryApplicationsResponse> {
    return this.categories.listMine(user.id, query);
  }
}
