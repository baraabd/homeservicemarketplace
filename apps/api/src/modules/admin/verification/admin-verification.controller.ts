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
  AdminProviderMutationResponse,
  AdminVerificationCase,
  AdminProviderSummary,
  ListAdminProvidersResponse,
  ListProviderAuditEventsResponse,
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
import { ListProviderAuditQueryDto } from './dto/list-provider-audit.query';
import { UpdateReviewNotesDto } from './dto/update-review-notes.dto';
import { AdminVerificationService } from './admin-verification.service';
import { AdminVerificationCaseService } from './admin-verification-case.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/providers', version: '1' })
export class AdminVerificationController {
  constructor(
    private readonly verification: AdminVerificationService,
    private readonly cases: AdminVerificationCaseService,
  ) {}

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

  // Sprint 5.1.4: lift a suspension. Body-less; conditional on
  // status === SUSPENDED, anything else returns 409.
  @UseGuards(CsrfGuard)
  @Post(':providerProfileId/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('providerProfileId') providerProfileId: string,
  ): Promise<AdminProviderMutationResponse> {
    return this.verification.reactivate(admin.id, providerProfileId);
  }

  // Sprint 6.2: persist admin-facing review notes. Audited via
  // ADMIN_PROVIDER_NOTES_UPDATED. Does NOT fan out a notification —
  // these are an admin-private surface.
  @UseGuards(CsrfGuard)
  @Patch(':providerProfileId/review-notes')
  @HttpCode(HttpStatus.OK)
  updateReviewNotes(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('providerProfileId') providerProfileId: string,
    @Body() body: UpdateReviewNotesDto,
  ): Promise<AdminProviderMutationResponse> {
    return this.verification.updateReviewNotes(admin.id, providerProfileId, body.notes);
  }

  // Sprint 6.2: provider-scoped audit history. Returns ADMIN_PROVIDER_*
  // rows filtered by metadata.providerProfileId. Cursor-paginated; no
  // type filter on the wire — every audit row that touched this profile
  // is in the same timeline.
  @Get(':providerProfileId/audit')
  @HttpCode(HttpStatus.OK)
  audit(
    @Param('providerProfileId') providerProfileId: string,
    @Query() query: ListProviderAuditQueryDto,
  ): Promise<ListProviderAuditEventsResponse> {
    return this.verification.getAuditHistory(providerProfileId, query);
  }

  // Sprint 9B — the verification case, replacing the "documents ship in a
  // follow-up sprint" placeholder the admin UI has carried since Sprint 6.2.
  //
  // METADATA ONLY. No bytes, no storage key, no signed URL (docs/adr/0009).
  // Opening a document is a separate, audited, short-lived read, so this
  // payload stays safe to hold in the client's query cache.
  //
  // Returns null — not 404 — when the provider has never submitted. "No case
  // yet" is a state a reviewer must be able to see, not a failure the UI has
  // to special-case.
  @Get(':providerProfileId/verification')
  @HttpCode(HttpStatus.OK)
  verificationCase(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('providerProfileId') providerProfileId: string,
  ): Promise<AdminVerificationCase | null> {
    // The reviewer's id is passed so availableActions can already exclude a
    // self-review, rather than rendering buttons the mutation would refuse.
    return this.cases.forProvider(providerProfileId, admin.id);
  }
}
