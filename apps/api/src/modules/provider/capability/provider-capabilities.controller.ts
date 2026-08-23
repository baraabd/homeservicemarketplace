import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import type { ProviderCapabilitiesResponse } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { ProviderCapabilityService } from './provider-capability.service';

// Sprint 7 — GET /v1/me/provider/capabilities. docs/adr/0006.
//
// Deliberately guarded by JwtAuthGuard ONLY:
//
//   * no RolesGuard('provider') — a user without the provider role gets a
//     well-formed all-denied answer with NO_PROVIDER_PROFILE, which is what
//     the "should I offer the upgrade?" screen needs. A 403 would force the
//     client to treat an error as a state.
//   * no ProviderActiveGuard — this endpoint EXPLAINS the gate; gating it on
//     the gate means the providers who most need the answer cannot get it.
//
// It leaks nothing: the response is derived entirely from the caller's own
// account and profile, and denial reasons are stable codes with no policy
// detail (no thresholds, no expiry dates, no internal rule names).
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/provider', version: '1' })
export class ProviderCapabilitiesController {
  constructor(private readonly capabilities: ProviderCapabilityService) {}

  @Get('capabilities')
  @HttpCode(HttpStatus.OK)
  get(@CurrentUser() user: AuthenticatedUser): Promise<ProviderCapabilitiesResponse> {
    return this.capabilities.for(user.id);
  }
}
