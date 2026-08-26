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
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import {
  VerificationCaseWorkflowService,
  type CaseCommandResult,
} from '../../provider/verification/case/verification-case-workflow.service';
import {
  AdminVerificationQueueService,
  type VerificationQueuePage,
} from './admin-verification-queue.service';
import { AdminVerificationCaseService } from './admin-verification-case.service';
import { AuditEventRepository } from '../../../infrastructure/persistence/iam/audit-event.repository';

// Sprint 9B.5 — the reviewer's two commands on a verification case.
//
// Routed by CASE ID rather than by provider, because the commands act on a
// case: a provider can have a history of them, and "the current one" is a
// question with a different answer depending on when you ask. The reviewer view
// already returns the id it is looking at, so the client has it.
//
// Separate from AdminVerificationController on purpose. That controller owns
// the PROVIDER STATUS axis (approve/reject/suspend/reactivate on a profile).
// These are the CASE axis. Sprint 9B.1 established that the two axes are
// distinct and must not be merged into a synthetic combined table; keeping them
// on separate controllers is that separation made structural rather than
// remembered.
//
// Guarded by `verification:decide` rather than by "is an admin": every admin
// being able to move every case makes the decision record meaningless, which is
// the same reasoning that gives evidence reads their own narrow permission.

class AssignCaseDto {
  /** Concurrency token. See the provider submit DTO — the server never moves
   *  the case TO this state, it only refuses when the case has moved on. */
  @IsOptional()
  @IsIn(['SUBMITTED', 'IN_REVIEW'])
  expectedState?: 'SUBMITTED' | 'IN_REVIEW';
}

class RequestActionDto {
  /** Required by the transition table, and validated here so the refusal is a
   *  400 about the request rather than a 500 about the database enum. */
  @IsIn([
    'DOCUMENT_MISSING',
    'DOCUMENT_ILLEGIBLE',
    'DOCUMENT_EXPIRED',
    'DOCUMENT_MISMATCH',
    'BUSINESS_NOT_REGISTERED',
    'REPRESENTATIVE_NOT_AUTHORIZED',
    'LICENSE_MISSING_FOR_CATEGORY',
    'LICENSE_EXPIRED',
    'OTHER',
  ])
  reasonCode!: string;

  /**
   * What specifically the provider must fix.
   *
   * Stored on the CASE, which is access-controlled and is deleted with the
   * evidence. It never reaches the decision row, the audit metadata or the
   * notification — those outlive the case and travel further than it does.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsIn(['SUBMITTED', 'IN_REVIEW'])
  expectedState?: 'SUBMITTED' | 'IN_REVIEW';
}

class RejectCaseDto {
  /**
   * Mandatory. The transition table marks rejection as requiring a reason, and
   * this is validated at the edge so the refusal is a 400 about the request
   * rather than a 500 about a database enum.
   *
   * Closing a case against someone without recording why is the one thing a
   * permanent record must never allow.
   */
  @IsIn([
    'DOCUMENT_MISSING',
    'DOCUMENT_ILLEGIBLE',
    'DOCUMENT_EXPIRED',
    'DOCUMENT_MISMATCH',
    'SUSPECTED_FORGERY',
    'DUPLICATE_IDENTITY',
    'BUSINESS_NOT_REGISTERED',
    'REPRESENTATIVE_NOT_AUTHORIZED',
    'LICENSE_MISSING_FOR_CATEGORY',
    'LICENSE_EXPIRED',
    'TRUST_AND_SAFETY_ACTION',
    'OTHER',
  ])
  reasonCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsIn(['SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED'])
  expectedState?: 'SUBMITTED' | 'IN_REVIEW' | 'ACTION_REQUIRED';
}

class ListQueueDto {
  @IsOptional()
  @IsIn(['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED', 'VERIFIED', 'REJECTED', 'EXPIRED'])
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  policyVersion?: string;

  /** Matched against the provider's display name. Search NARROWS the queue; it
   *  never widens it past the state filter. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}

class ListCaseAuditDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('verification:decide')
@Controller({ path: 'admin/verification/cases', version: '1' })
export class AdminVerificationCaseCommandsController {
  constructor(
    private readonly workflow: VerificationCaseWorkflowService,
    private readonly queue: AdminVerificationQueueService,
    private readonly cases: AdminVerificationCaseService,
    private readonly audit: AuditEventRepository,
  ) {}

  /** The work list. Oldest first, live cases by default. */
  @Get()
  @HttpCode(HttpStatus.OK)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListQueueDto,
  ): Promise<VerificationQueuePage> {
    return this.queue.list(
      {
        state: query.state as never,
        policyVersion: query.policyVersion,
        search: query.search,
        limit: query.limit,
        cursor: query.cursor,
      },
      user.id,
    );
  }

  /** One SPECIFIC case, by its own id — not "the newest for this provider". */
  @Get(':caseId')
  @HttpCode(HttpStatus.OK)
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
  ): Promise<unknown> {
    return this.cases.forCase(caseId, user.id) as Promise<unknown>;
  }

  /**
   * What happened to THIS application.
   *
   * Scoped to the case rather than the provider: a provider can have several
   * cases over time, and a merged trail answers a question nobody asked.
   */
  @Get(':caseId/audit')
  @HttpCode(HttpStatus.OK)
  async caseAudit(
    @Param('caseId') caseId: string,
    @Query() query: ListCaseAuditDto,
  ): Promise<{ items: unknown[]; nextCursor: string | null }> {
    const take = Math.min(query.limit ?? 25, 100);
    const rows = await this.audit.listForVerificationCase({
      caseId,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    return {
      items: page.map((r) => ({
        id: r.id,
        type: r.type as string,
        actorUserId: r.userId ?? null,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  @UseGuards(CsrfGuard)
  @Post(':caseId/assign')
  @HttpCode(HttpStatus.OK)
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() body: AssignCaseDto,
  ): Promise<CaseCommandResult> {
    return this.workflow.assign(user.id, { caseId, expectedState: body.expectedState });
  }

  @UseGuards(CsrfGuard)
  @Post(':caseId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() body: RejectCaseDto,
  ): Promise<CaseCommandResult> {
    return this.workflow.reject(user.id, {
      caseId,
      reasonCode: body.reasonCode as never,
      note: body.note ?? null,
      expectedState: body.expectedState,
    });
  }

  @UseGuards(CsrfGuard)
  @Post(':caseId/request-action')
  @HttpCode(HttpStatus.OK)
  requestAction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('caseId') caseId: string,
    @Body() body: RequestActionDto,
  ): Promise<CaseCommandResult> {
    return this.workflow.requestAction(user.id, {
      caseId,
      reasonCode: body.reasonCode as never,
      note: body.note ?? null,
      expectedState: body.expectedState,
    });
  }
}
