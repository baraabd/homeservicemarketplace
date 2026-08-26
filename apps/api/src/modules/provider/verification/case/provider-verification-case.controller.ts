import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type {
  CreateVerificationCaseResponse,
  CurrentVerificationCaseResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../../iam/authentication/guards/csrf.guard';
import type { AuthenticatedUser } from '../../../iam/authentication/types/authenticated-user';
import { ProviderVerificationCaseService } from './provider-verification-case.service';
import {
  VerificationCaseWorkflowService,
  type CaseCommandResult,
} from './verification-case-workflow.service';

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

class SubmitVerificationCaseDto {
  /**
   * The state the client believed the case was in.
   *
   * OPTIONAL, and a concurrency token rather than an instruction: the server
   * never moves the case to this state, it only refuses when the case has moved
   * on since the client read it. A client that omits it is simply not
   * protected against acting on a stale view.
   */
  @IsOptional()
  @IsIn(['DRAFT', 'ACTION_REQUIRED'])
  expectedState?: 'DRAFT' | 'ACTION_REQUIRED';
}

@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/provider/verification', version: '1' })
export class ProviderVerificationCaseController {
  constructor(
    private readonly cases: ProviderVerificationCaseService,
    private readonly workflow: VerificationCaseWorkflowService,
  ) {}

  @UseGuards(CsrfGuard)
  @Post('case/submit')
  @HttpCode(HttpStatus.OK)
  // 200, not 202: by the time this returns the case IS submitted. A replayed
  // submission returns 200 as well, with changed=false — the outcome the caller
  // asked for is true either way, and an error would be a lie about a case that
  // is in exactly the state they wanted.
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SubmitVerificationCaseDto,
  ): Promise<CaseCommandResult> {
    // No case id in the path: a provider has exactly one active case, and
    // making them carry its id would let them name someone else's.
    return this.workflow.submitOwnCase(user.id, { expectedState: body.expectedState });
  }

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
