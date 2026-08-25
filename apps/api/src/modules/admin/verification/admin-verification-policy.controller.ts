import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type {
  ListVerificationPoliciesResponse,
  VerificationPolicyMutationResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { AdminVerificationPolicyService } from './admin-verification-policy.service';

// Sprint 9B.2 — versioned verification requirement policies.
//
//   GET  /v1/admin/verification/policies
//   POST /v1/admin/verification/policies
//   POST /v1/admin/verification/policies/:version/retire
//
// There is deliberately NO update route. Policies are append-only: correcting
// one means publishing a new version and retiring the old, so what a provider
// was judged against never changes after they were judged.
//
// Its own controller rather than more routes on AdminVerificationController:
// that one is per-PROVIDER (`admin/providers/:id/...`), this one is
// per-POLICY. Sharing a path prefix would put a global configuration surface
// behind a route shaped like a single provider's record.

const DOCUMENT_KINDS = [
  'INDIVIDUAL_IDENTITY',
  'BUSINESS_REGISTRATION',
  'AUTHORIZED_REPRESENTATIVE_IDENTITY',
  'CATEGORY_LICENSE',
] as const;

export class PolicyRequirementsDto {
  // The full semantic rules — unsatisfiable sets, category scope, the document
  // ceiling — live in parsePolicyRequirements, which is unit-tested without a
  // database. This layer only rejects what is not even the right SHAPE, so the
  // rules have exactly one home.
  @IsArray()
  @IsIn(DOCUMENT_KINDS, { each: true })
  documents!: string[];

  @IsBoolean()
  verificationRequired!: boolean;
}

export class PublishVerificationPolicyDto {
  @IsString()
  @MaxLength(64)
  version!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO 3166-1 alpha-2 code.' })
  country?: string | null;

  @IsOptional()
  @IsIn(['INDIVIDUAL', 'BUSINESS'])
  providerType?: 'INDIVIDUAL' | 'BUSINESS' | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string | null;

  @IsObject()
  @ValidateNested()
  @Type(() => PolicyRequirementsDto)
  requirements!: PolicyRequirementsDto;

  @IsOptional()
  @IsISO8601()
  publishedAt?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/verification/policies', version: '1' })
export class AdminVerificationPolicyController {
  constructor(private readonly policies: AdminVerificationPolicyService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(): Promise<ListVerificationPoliciesResponse> {
    return this.policies.list() as unknown as Promise<ListVerificationPoliciesResponse>;
  }

  @UseGuards(CsrfGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async publish(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: PublishVerificationPolicyDto,
  ): Promise<VerificationPolicyMutationResponse> {
    const policy = await this.policies.publish(admin.id, {
      version: body.version,
      country: body.country ?? null,
      providerType: body.providerType ?? null,
      categoryId: body.categoryId ?? null,
      requirements: body.requirements,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    });
    return { policy } as unknown as VerificationPolicyMutationResponse;
  }

  @UseGuards(CsrfGuard)
  @Post(':version/retire')
  @HttpCode(HttpStatus.OK)
  async retire(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('version') version: string,
  ): Promise<VerificationPolicyMutationResponse> {
    const policy = await this.policies.retire(admin.id, version);
    return { policy } as unknown as VerificationPolicyMutationResponse;
  }
}
