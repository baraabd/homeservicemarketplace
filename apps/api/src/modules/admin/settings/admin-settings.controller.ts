import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminSettingValue,
  AdminSettingsBulkResponse,
  SettingMutationResponse,
  UpdateAdminSettingsResponse,
  UpsertSettingRequest,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { AdminSettingsService } from './admin-settings.service';
import { UpdateAdminSettingsDto } from './dto/update-admin-settings.dto';

// /v1/admin/settings — Sprint 6.5 refined.
//
// Two surfaces:
//   • bulk (`GET /` + `PATCH /`)              — canonical UI surface
//   • keyed (`GET /:key`, `PUT /:key`, `DELETE /:key`) — legacy
//     ad-hoc surface
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/settings', version: '1' })
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  // Sprint 6.5 — canonical bulk read. Returns the whitelisted
  // values + their defaults + the schema describing each field's
  // editor + the timestamp of the most recent mutation.
  @Get()
  @HttpCode(HttpStatus.OK)
  bulk(): Promise<AdminSettingsBulkResponse> {
    return this.settings.getBulk();
  }

  // Sprint 6.5 — canonical bulk PATCH. Only whitelisted keys are
  // accepted; per-key type validation runs server-side.
  @UseGuards(CsrfGuard)
  @Patch()
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: UpdateAdminSettingsDto,
  ): Promise<UpdateAdminSettingsResponse> {
    return this.settings.updateBulk(admin.id, body.values);
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
