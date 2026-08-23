import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminCategoryMutationResponse,
  AdminCategoryTreeResponse,
  AdminEquipmentListResponse,
  AdminEquipmentMutationResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { AdminCatalogService } from './admin-catalog.service';
import {
  CreateAdminCategoryDto,
  CreateAdminEquipmentDto,
  UpdateAdminCategoryDto,
  UpdateAdminEquipmentDto,
} from './dto/admin-catalog.dto';

// /v1/admin/catalog/* — Sprint 8.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// The category tree and the equipment list decide what a provider can claim to
// do and what a seeker can search for, so this whole surface is admin-only and
// every mutation is audited with before/after values.
//
// NO DELETE ROUTE, deliberately. A category a provider holds cannot be removed
// without silently revoking a competency an admin once approved, and an
// equipment code a saved draft references cannot be removed without breaking
// that draft. Retiring is `PATCH { isActive: false }`.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/catalog', version: '1' })
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  /** The whole tree, pre-nested, INCLUDING retired rows — a screen that hides
   *  retired categories cannot un-retire one. */
  @Get('categories')
  @HttpCode(HttpStatus.OK)
  categories(): Promise<AdminCategoryTreeResponse> {
    return this.catalog.categoryTree();
  }

  @UseGuards(CsrfGuard)
  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  createCategory(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: CreateAdminCategoryDto,
  ): Promise<AdminCategoryMutationResponse> {
    return this.catalog.createCategory(admin.id, body);
  }

  /** Rename, re-parent, retire, or change selectability.
   *
   *  Re-parenting is checked against the ancestor chain: the database CHECK
   *  only catches a category naming itself, and A to B to A would otherwise
   *  produce a tree that makes recursive reads hang rather than error. */
  @UseGuards(CsrfGuard)
  @Patch('categories/:id')
  @HttpCode(HttpStatus.OK)
  updateCategory(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateAdminCategoryDto,
  ): Promise<AdminCategoryMutationResponse> {
    return this.catalog.updateCategory(admin.id, id, body);
  }

  @Get('equipment')
  @HttpCode(HttpStatus.OK)
  equipment(): Promise<AdminEquipmentListResponse> {
    return this.catalog.listEquipment();
  }

  @UseGuards(CsrfGuard)
  @Post('equipment')
  @HttpCode(HttpStatus.CREATED)
  createEquipment(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: CreateAdminEquipmentDto,
  ): Promise<AdminEquipmentMutationResponse> {
    return this.catalog.createEquipment(admin.id, body);
  }

  @UseGuards(CsrfGuard)
  @Patch('equipment/:id')
  @HttpCode(HttpStatus.OK)
  updateEquipment(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateAdminEquipmentDto,
  ): Promise<AdminEquipmentMutationResponse> {
    return this.catalog.updateEquipment(admin.id, id, body);
  }
}
