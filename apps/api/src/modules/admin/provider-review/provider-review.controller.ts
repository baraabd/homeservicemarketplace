import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ApproveProviderReviewDto, RequestProviderReviewChangesDto } from './provider-review.dto';
import { AdminProviderReviewService } from './provider-review.service';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
@Permissions('user:read:any')
@Controller({ path: 'admin/providers/:providerProfileId/review', version: '1' })
export class AdminProviderReviewController {
  constructor(private readonly reviews: AdminProviderReviewService) {}

  @Get()
  get(@CurrentUser() actor: AuthenticatedUser, @Param('providerProfileId') id: string) {
    return this.reviews.get(actor, id);
  }

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Permissions('user:read:any', 'verification:decide')
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('providerProfileId') id: string,
    @Body() input: ApproveProviderReviewDto,
  ) {
    return this.reviews.approve(actor, id, input);
  }

  @Post('request-changes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Permissions('user:read:any', 'verification:decide')
  requestChanges(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('providerProfileId') id: string,
    @Body() input: RequestProviderReviewChangesDto,
  ) {
    return this.reviews.requestChanges(actor, id, input);
  }
}
