import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type {
  CreateVerificationCaseResponse,
  CurrentVerificationCaseResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../../iam/authentication/guards/csrf.guard';
import type { AuthenticatedUser } from '../../../iam/authentication/types/authenticated-user';
import { ProviderVerificationCaseService } from './provider-verification-case.service';

// Sprint 9B.2 — the provider's own verification case.
//
//   POST /v1/me/provider/verification/case
//   GET  /v1/me/provider/verification/case
//
// Guarded by JwtAuthGuard only, for the same reason as
// ProviderCapabilitiesController: this is the surface that EXPLAINS what a
// provider must do to become verified, so gating it behind verification would
// hide the answer from exactly the people who need it. Ownership is not a
// guard concern here either — the service derives the provider profile from
// the authenticated user and never accepts a profile id, so there is no id to
// authorise.
//
// The POST carries CsrfGuard because it mutates; the GET does not.

export class CreateVerificationCaseDto {
  /**
   * Client-generated replay key. Constrained rather than free text because it
   * is stored, indexed and echoed back — a URL-safe token, not a payload.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'idempotencyKey may contain only letters, digits, dot, underscore and hyphen.',
  })
  idempotencyKey?: string;
}

@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/provider/verification', version: '1' })
export class ProviderVerificationCaseController {
  constructor(private readonly cases: ProviderVerificationCaseService) {}

  @UseGuards(CsrfGuard)
  @Post('case')
  @HttpCode(HttpStatus.OK)
  // 200, not 201: this endpoint frequently RESUMES rather than creates, and a
  // status that alternated between 200 and 201 would invite clients to branch
  // on it. `created` in the body says which happened.
  createOrResume(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateVerificationCaseDto,
  ): Promise<CreateVerificationCaseResponse> {
    return this.cases.createOrResume(user.id, {
      idempotencyKey: body.idempotencyKey ?? null,
    }) as unknown as Promise<CreateVerificationCaseResponse>;
  }

  @Get('case')
  @HttpCode(HttpStatus.OK)
  current(@CurrentUser() user: AuthenticatedUser): Promise<CurrentVerificationCaseResponse> {
    return this.cases.current(user.id) as unknown as Promise<CurrentVerificationCaseResponse>;
  }
}
