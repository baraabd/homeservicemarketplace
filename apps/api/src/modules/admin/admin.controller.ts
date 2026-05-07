import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import type { AdminHealthResponse } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { Roles } from '../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../iam/authorization/guards/roles.guard';

// /v1/admin — Admin module bootstrap (Sprint 6.0).
//
// Class-level guards: every admin route requires JwtAuthGuard +
// RolesGuard('admin'). Sub-controllers added in Sprints 6.1 → 6.6
// reuse the same guards and the AdminAuditService for mutation audit
// trails.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  // GET /v1/admin/health — admin-role-gated ping. Used by the
  // runtime harness (Sprint 6.7) to confirm a) the admin module
  // is mounted and b) the role guard admits the seeded admin
  // account. Never reveals state; never writes audit.
  @Get('health')
  @HttpCode(HttpStatus.OK)
  health(@CurrentUser() user: AuthenticatedUser): AdminHealthResponse {
    return {
      ok: true,
      adminUserId: user.id,
      serverTime: new Date().toISOString(),
    };
  }
}
