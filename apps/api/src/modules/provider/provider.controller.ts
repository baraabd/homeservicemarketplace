import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  GetProviderProfileResponse,
  UpdateProviderAvailabilityResponse,
  UpdateProviderProfileResponse,
  UpgradeToProviderResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { Roles } from '../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../iam/authorization/guards/roles.guard';
import { UpdateProviderAvailabilityDto } from './dto/update-provider-availability.dto';
import { UpdateProviderProfileDto } from './dto/update-provider-profile.dto';
import { UpgradeToProviderDto } from './dto/upgrade-to-provider.dto';
import { ProviderService } from './provider.service';

// /v1/me/provider/* — Provider-facing profile surface (Sprint 5 slice 5.1).
//
// Class-level guards: every route requires a valid session (JwtAuthGuard).
// Read/write profile + availability ALSO require the `provider` role —
// non-provider users get a hard 403 from RolesGuard before any service
// code runs. The upgrade route is the only path that does NOT require
// the provider role yet — that's how a seeker promotes themselves.
//
// `userId` is sourced exclusively from the authenticated session via
// @CurrentUser. Body DTOs declare only allowed fields; the global
// ValidationPipe's `forbidNonWhitelisted: true` rejects payloads that
// try to inject email / userId / role / status / reputation columns.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/provider', version: '1' })
export class ProviderController {
  constructor(private readonly provider: ProviderService) {}

  @UseGuards(CsrfGuard)
  @Post('upgrade')
  @HttpCode(HttpStatus.OK)
  upgrade(
    @CurrentUser() user: AuthenticatedUser,
    // Empty-body DTO. forbidNonWhitelisted rejects ANY field a client
    // tries to inject (userId, role, status, isAdmin, …). The body is
    // intentionally unused — userId comes from the authenticated session.
    @Body() _body: UpgradeToProviderDto,
  ): Promise<UpgradeToProviderResponse> {
    return this.provider.upgrade(user.id);
  }

  @UseGuards(RolesGuard)
  @Roles('provider')
  @Get('profile')
  @HttpCode(HttpStatus.OK)
  getProfile(@CurrentUser() user: AuthenticatedUser): Promise<GetProviderProfileResponse> {
    return this.provider.get(user.id);
  }

  @UseGuards(CsrfGuard, RolesGuard)
  @Roles('provider')
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProviderProfileDto,
  ): Promise<UpdateProviderProfileResponse> {
    return this.provider.update(user.id, body);
  }

  @UseGuards(CsrfGuard, RolesGuard)
  @Roles('provider')
  @Patch('availability')
  @HttpCode(HttpStatus.OK)
  updateAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProviderAvailabilityDto,
  ): Promise<UpdateProviderAvailabilityResponse> {
    return this.provider.updateAvailability(user.id, body);
  }
}
