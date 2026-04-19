import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { ProfileDto } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { ProfileService } from '../services/profile.service';

@UseGuards(JwtAuthGuard)
@Controller({ path: 'profiles', version: '1' })
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<ProfileDto> {
    return this.profiles.getOrCreate(user.id);
  }

  @Patch('me')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfileDto,
  ): Promise<ProfileDto> {
    return this.profiles.update(user.id, body);
  }
}
