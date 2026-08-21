import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type {
  AdminAccessRequestSummary,
  MyAdminAccessResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../authentication/types/authenticated-user';
import { AdminAccessService } from './admin-access.service';
import { SubmitAdminAccessRequestDto } from './dto/submit-admin-access-request.dto';

// /v1/me/admin-access — the APPLICANT's side of the admin access axis.
//
// Phase 4: a public signup never grants the admin role. An Admin-themed signup
// creates an ordinary account; wanting admin access means submitting a request
// here, which a different authorized administrator then approves or rejects
// via /v1/admin/access-requests.
//
// Every route is scoped to the caller's own session identity — there is no
// `userId` parameter anywhere, so one user can never read or mutate another
// user's request.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/admin-access', version: '1' })
export class AdminAccessController {
  constructor(private readonly adminAccess: AdminAccessService) {}

  // The surface every "am I an admin?" screen should read, instead of
  // inferring admin standing from `User.status`.
  @Get()
  @HttpCode(HttpStatus.OK)
  getMine(@CurrentUser() user: AuthenticatedUser): Promise<MyAdminAccessResponse> {
    return this.adminAccess.getMine(user.id);
  }

  @UseGuards(CsrfGuard)
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SubmitAdminAccessRequestDto,
  ): Promise<AdminAccessRequestSummary> {
    return this.adminAccess.submit(user.id, body);
  }

  @UseGuards(CsrfGuard)
  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthenticatedUser): Promise<AdminAccessRequestSummary> {
    return this.adminAccess.cancelMine(user.id);
  }
}
