import {
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
  AdminUserMutationResponse,
  AdminUserSummary,
  ListAdminUsersResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query';
import { AdminUsersService } from './admin-users.service';

// /v1/admin/users — Admin user control (Sprint 6.1).
//
// JwtAuthGuard + RolesGuard('admin'); mutations also use CsrfGuard.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/users', version: '1' })
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(@Query() query: ListAdminUsersQueryDto): Promise<ListAdminUsersResponse> {
    return this.users.list(query);
  }

  @Get(':userId')
  @HttpCode(HttpStatus.OK)
  detail(@Param('userId') userId: string): Promise<AdminUserSummary> {
    return this.users.detail(userId);
  }

  @UseGuards(CsrfGuard)
  @Post(':userId/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<AdminUserMutationResponse> {
    return this.users.suspend(admin.id, userId);
  }

  @UseGuards(CsrfGuard)
  @Post(':userId/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<AdminUserMutationResponse> {
    return this.users.restore(admin.id, userId);
  }
}
