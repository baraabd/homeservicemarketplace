import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { MONEY_CONTRACT_VERSION } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { RefundRecoveryService } from '../recovery/refund-recovery.service';

export class RefundRecoveryScopeDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/u)
  paymentConfirmationId!: string;
}

export class RefundRecoveryDto extends RefundRecoveryScopeDto {
  @IsIn([MONEY_CONTRACT_VERSION])
  contractVersion!: typeof MONEY_CONTRACT_VERSION;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/u)
  expectedStateRevision!: string;

  @IsIn(['QUERY', 'DISPATCH'])
  operation!: 'QUERY' | 'DISPATCH';

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/u)
  approvalReference?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
@Controller({ path: 'money/review/refunds', version: '1' })
export class RefundController {
  constructor(private readonly recovery: RefundRecoveryService) {}

  @Get(':id/recovery')
  @Permissions('money:review:read')
  inspect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') refundId: string,
    @Query() scope: RefundRecoveryScopeDto,
  ) {
    return this.recovery.inspect(user.id, refundId, scope.paymentConfirmationId);
  }

  @Post(':id/recovery')
  @UseGuards(CsrfGuard)
  @Permissions('money:refund:review')
  replay(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Param('id') refundId: string,
    @Body() input: RefundRecoveryDto,
  ) {
    return this.recovery.replay(user.id, key, refundId, input);
  }
}
