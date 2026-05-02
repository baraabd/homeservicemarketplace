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
  AdminProviderMutationResponse,
  AdminProviderSummary,
  ListAdminProvidersResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import {
  AdminProviderApproveDto,
  AdminProviderRejectDto,
  AdminProviderSuspendDto,
} from './dto/admin-provider-decision.dto';
import { ListAdminProvidersQueryDto } from './dto/list-admin-providers.query';
import { AdminVerificationService } from './admin-verification.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/providers', version: '1' })
export class AdminVerificationController {
  constructor(private readonly verification: AdminVerificationService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(@Query() query: ListAdminProvidersQueryDto): Promise<ListAdminProvidersResponse> {
    return this.verification.list(query);
  }

  @Get(':providerProfileId')
  @HttpCode(HttpStatus.OK)
  detail(@Param('providerProfileId') providerProfileId: string): Promise<AdminProviderSummary> {
    return this.verification.detail(providerProfileId);
  }

  @UseGuards(CsrfGuard)
  @Post(':providerProfileId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('providerProfileId') providerProfileId: string,
    @Body() body: AdminProviderApproveDto,
  ): Promise<AdminProviderMutationResponse> {
    return this.verification.approve(admin.id, providerProfileId, body.note ?? null);
  }

  @UseGuards(CsrfGuard)
  @Post(':providerProfileId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('providerProfileId') providerProfileId: string,
    @Body() body: AdminProviderRejectDto,
  ): Promise<AdminProviderMutationResponse> {
    return this.verification.reject(admin.id, providerProfileId, body.reason);
  }

  @UseGuards(CsrfGuard)
  @Post(':providerProfileId/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('providerProfileId') providerProfileId: string,
    @Body() body: AdminProviderSuspendDto,
  ): Promise<AdminProviderMutationResponse> {
    return this.verification.suspend(admin.id, providerProfileId, body.reason);
  }
}
