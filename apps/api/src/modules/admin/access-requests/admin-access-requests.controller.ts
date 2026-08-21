import {
  Body,
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
  AdminAccessRequestMutationResponse,
  AdminAccessRequestReviewItem,
  ListAdminAccessRequestsResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { AdminAccessService } from '../../iam/admin-access/admin-access.service';
import { DecideAdminAccessRequestDto } from './dto/decide-admin-access-request.dto';
import { ListAdminAccessRequestsQueryDto } from './dto/list-admin-access-requests.query';

// /v1/admin/access-requests — the REVIEWER's side of the admin access axis.
//
// Guarded twice, deliberately:
//   RolesGuard('admin')            — must currently hold the admin role, and
//                                    role changes revoke sessions so a revoked
//                                    admin cannot reach this with an old token.
//   PermissionsGuard('admin:access:grant')
//                                  — granting admin access is a narrower
//                                    capability than "is an admin". Splitting
//                                    it means the ability to mint new
//                                    administrators can be withheld from
//                                    day-to-day admin roles later without
//                                    touching this controller.
//
// The service additionally refuses self-review, which no guard can express.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
@Permissions('admin:access:grant')
@Controller({ path: 'admin/access-requests', version: '1' })
export class AdminAccessRequestsController {
  constructor(private readonly adminAccess: AdminAccessService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(@Query() query: ListAdminAccessRequestsQueryDto): Promise<ListAdminAccessRequestsResponse> {
    return this.adminAccess.listForReview(query);
  }

  @Get(':requestId')
  @HttpCode(HttpStatus.OK)
  detail(@Param('requestId') requestId: string): Promise<AdminAccessRequestReviewItem> {
    return this.adminAccess.detail(requestId);
  }

  @UseGuards(CsrfGuard)
  @Post(':requestId/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body() body: DecideAdminAccessRequestDto,
  ): Promise<AdminAccessRequestMutationResponse> {
    return { request: await this.adminAccess.approve(reviewer.id, requestId, body) };
  }

  @UseGuards(CsrfGuard)
  @Post(':requestId/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() reviewer: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body() body: DecideAdminAccessRequestDto,
  ): Promise<AdminAccessRequestMutationResponse> {
    return { request: await this.adminAccess.reject(reviewer.id, requestId, body) };
  }
}
