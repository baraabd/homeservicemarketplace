import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import type { GetProfileResponse, UpdateProfileResponse } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

// /v1/me/profile — Seeker-facing editable-profile surface.
//
// Read endpoint requires JwtAuthGuard. Mutating endpoint additionally
// requires CsrfGuard so a stolen access cookie alone cannot drive
// profile updates from a hostile origin.
//
// `userId` is sourced exclusively from the authenticated session via
// @CurrentUser. The PATCH body DTO declares only firstName / lastName
// / phoneNumber / city / bio; the global ValidationPipe's
// `forbidNonWhitelisted: true` rejects payloads that try to inject
// email / userId / role / status / password.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/profile', version: '1' })
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  get(@CurrentUser() user: AuthenticatedUser): Promise<GetProfileResponse> {
    return this.profile.get(user.id);
  }

  @UseGuards(CsrfGuard)
  @Patch()
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfileDto,
  ): Promise<UpdateProfileResponse> {
    return this.profile.update(user.id, body);
  }
}
