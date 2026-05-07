import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminUserMutationResponse,
  AdminUserSummary,
  ListAdminRolesResponse,
  ListAdminUsersResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ListAdminUsersQueryDto } from './dto/list-admin-users.query';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
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

  // Sprint 6.1 canonical PATCH path. The body's `status` is the
  // target value (ACTIVE / SUSPENDED / LOCKED). The legacy
  // /suspend and /restore POST routes below stay callable for
  // backward compat with the existing hsm-admin Postman folder 20.
  @UseGuards(CsrfGuard)
  @Patch(':userId/status')
  @HttpCode(HttpStatus.OK)
  setStatus(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() body: UpdateUserStatusDto,
  ): Promise<AdminUserMutationResponse> {
    return this.users.setStatus(admin.id, userId, body);
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

// /v1/admin/roles — read-only list of every Role row, used by the
// User Control filter chips so the UI never hardcodes role names.
// Lives in the same file because it's a one-method controller and
// shares the AdminUsersService dependency tree.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/roles', version: '1' })
export class AdminRolesController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(): Promise<ListAdminRolesResponse> {
    return this.users.listRoles();
  }
}
