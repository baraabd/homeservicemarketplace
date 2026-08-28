import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import {
  AdminServiceAreaPolicyService,
  type LadderSummary,
  type OverrideSummary,
} from './admin-service-area-policy.service';

// Sprint 9B.20 — versioned service-area expansion ladders, and the manual
// overrides that are the appeal path.
//
//   GET    /v1/admin/service-area/policies
//   POST   /v1/admin/service-area/policies
//   POST   /v1/admin/service-area/policies/:version/retire
//   POST   /v1/admin/service-area/overrides/:providerProfileId
//   DELETE /v1/admin/service-area/overrides/:providerProfileId
//
// There is deliberately NO update route for a ladder. They are append-only:
// correcting one means publishing a new version and retiring the old, so what
// a provider was judged against never changes after they were judged.
//
// Overrides are the opposite and deliberately so — they are per-person, they
// are meant to be revised, and their history lives in the audit log rather
// than in a version chain.

export class ExpansionTierDto {
  // The full semantic rules — rating-only tiers, sample floors, monotonicity,
  // the ceiling — live in parseExpansionLadder, which is unit-tested without a
  // database. This layer only rejects what is not even the right SHAPE, so the
  // rules have exactly one home.
  @IsString()
  @MaxLength(40)
  key!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  maxKm!: number;

  @IsObject()
  criteria!: Record<string, unknown>;
}

export class PublishExpansionPolicyDto {
  @IsString()
  @MaxLength(64)
  version!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO 3166-1 alpha-2 code.' })
  country?: string | null;

  @IsArray()
  tiers!: unknown[];

  @IsOptional()
  @IsISO8601()
  publishedAt?: string;
}

export class SetExpansionOverrideDto {
  @IsInt()
  @Min(1)
  // The blast radius, not the policy: the configured expansion ceiling is
  // checked in the service, where it can be read from settings.
  @Max(500)
  maxKm!: number;

  /** Why. Required — see AdminServiceAreaPolicyService.setOverride. */
  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/service-area', version: '1' })
export class AdminServiceAreaPolicyController {
  constructor(private readonly policies: AdminServiceAreaPolicyService) {}

  @Get('policies')
  @HttpCode(HttpStatus.OK)
  list(): Promise<{ policies: LadderSummary[] }> {
    return this.policies.list();
  }

  @UseGuards(CsrfGuard)
  @Post('policies')
  @HttpCode(HttpStatus.CREATED)
  async publish(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: PublishExpansionPolicyDto,
  ): Promise<{ policy: LadderSummary }> {
    const policy = await this.policies.publish(admin.id, {
      version: body.version,
      country: body.country ?? null,
      tiers: { tiers: body.tiers },
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    });
    return { policy };
  }

  @UseGuards(CsrfGuard)
  @Post('policies/:version/retire')
  @HttpCode(HttpStatus.OK)
  async retire(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('version') version: string,
  ): Promise<{ policy: LadderSummary }> {
    const policy = await this.policies.retire(admin.id, version);
    return { policy };
  }

  @UseGuards(CsrfGuard)
  @Post('overrides/:providerProfileId')
  @HttpCode(HttpStatus.OK)
  async setOverride(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('providerProfileId') providerProfileId: string,
    @Body() body: SetExpansionOverrideDto,
  ): Promise<{ override: OverrideSummary }> {
    const override = await this.policies.setOverride(admin.id, {
      providerProfileId,
      maxKm: body.maxKm,
      reason: body.reason,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });
    return { override };
  }

  @UseGuards(CsrfGuard)
  @Delete('overrides/:providerProfileId')
  @HttpCode(HttpStatus.OK)
  async clearOverride(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('providerProfileId') providerProfileId: string,
  ): Promise<{ override: OverrideSummary }> {
    const override = await this.policies.clearOverride(admin.id, providerProfileId);
    return { override };
  }
}
