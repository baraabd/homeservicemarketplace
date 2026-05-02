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
  DisputeMutationResponse,
  DisputeSummary,
  ListAdminDisputesResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import {
  ListAdminDisputesQueryDto,
  OpenDisputeDto,
  ResolveDisputeDto,
} from './dto/admin-disputes.dto';
import { AdminDisputesService } from './admin-disputes.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/disputes', version: '1' })
export class AdminDisputesController {
  constructor(private readonly disputes: AdminDisputesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(@Query() query: ListAdminDisputesQueryDto): Promise<ListAdminDisputesResponse> {
    return this.disputes.list(query);
  }

  @Get(':disputeId')
  @HttpCode(HttpStatus.OK)
  detail(@Param('disputeId') disputeId: string): Promise<DisputeSummary> {
    return this.disputes.detail(disputeId);
  }

  @UseGuards(CsrfGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  open(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: OpenDisputeDto,
  ): Promise<DisputeMutationResponse> {
    return this.disputes.open(admin.id, body);
  }

  @UseGuards(CsrfGuard)
  @Post(':disputeId/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('disputeId') disputeId: string,
    @Body() body: ResolveDisputeDto,
  ): Promise<DisputeMutationResponse> {
    return this.disputes.resolve(admin.id, disputeId, body);
  }
}
