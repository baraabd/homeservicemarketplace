import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { PlanVersionService } from './plan-version.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

export class MyPlanQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/u)
  subscriptionId?: string;
}

export class PlanCatalogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^[A-Za-z0-9_-]+$/u)
  cursor?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('provider')
@Controller({ path: 'money', version: '1' })
export class SubscriptionsController {
  constructor(
    private readonly plans: PlanVersionService,
    private readonly lifecycle: SubscriptionLifecycleService,
  ) {}

  @Get('plans')
  @Permissions('money:read:self')
  listPlans(@CurrentUser() user: AuthenticatedUser, @Query() query: PlanCatalogQueryDto) {
    return this.plans.listForUser(user.id, query);
  }

  @Get('my-plan')
  @Permissions('money:read:self')
  myPlan(@CurrentUser() user: AuthenticatedUser, @Query() query: MyPlanQueryDto) {
    return this.lifecycle.myPlan(user.id, query.subscriptionId);
  }
}
