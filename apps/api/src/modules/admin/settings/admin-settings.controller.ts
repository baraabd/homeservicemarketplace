import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminSettingValue,
  ListSettingsResponse,
  SettingMutationResponse,
  UpsertSettingRequest,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { AdminSettingsService } from './admin-settings.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/settings', version: '1' })
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(): Promise<ListSettingsResponse> {
    return this.settings.list();
  }

  @Get(':key')
  @HttpCode(HttpStatus.OK)
  detail(@Param('key') key: string): Promise<AdminSettingValue> {
    return this.settings.detail(key);
  }

  @UseGuards(CsrfGuard)
  @Put(':key')
  @HttpCode(HttpStatus.OK)
  upsert(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('key') key: string,
    @Body() body: UpsertSettingRequest,
  ): Promise<SettingMutationResponse> {
    return this.settings.upsert(admin.id, key, body.value);
  }

  @UseGuards(CsrfGuard)
  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() admin: AuthenticatedUser, @Param('key') key: string): Promise<void> {
    await this.settings.remove(admin.id, key);
  }
}
