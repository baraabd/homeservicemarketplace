import { Body, Controller, Get, Param, Patch, Res, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { PortfolioMediaService } from '../../media/portfolio-media.service';
import { servePortfolioMedia } from '../../media/serve-portfolio-media';
import { AdminPortfolioService } from './admin-portfolio.service';

export class ReviewAdminPortfolioItemDto {
  @IsIn(['APPROVE', 'REJECT']) action!: 'APPROVE' | 'REJECT';
  @IsInt() @Min(1) expectedRevision!: number;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
@Controller({ path: 'admin/providers/:providerProfileId/portfolio', version: '1' })
export class AdminPortfolioController {
  constructor(
    private readonly portfolio: AdminPortfolioService,
    private readonly media: PortfolioMediaService,
  ) {}

  @Get()
  @Permissions('portfolio:read')
  list(@CurrentUser() user: AuthenticatedUser, @Param('providerProfileId') profileId: string) {
    return this.portfolio.list(user.id, profileId);
  }

  @Get(':itemId/media')
  @Permissions('portfolio:read')
  async image(
    @Param('providerProfileId') profileId: string,
    @Param('itemId') itemId: string,
    @Res() res: Response,
  ): Promise<void> {
    await servePortfolioMedia(res, await this.media.openForReviewer(profileId, itemId));
  }

  @Patch(':itemId/review')
  @UseGuards(CsrfGuard)
  @Permissions('portfolio:review')
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('providerProfileId') profileId: string,
    @Param('itemId') itemId: string,
    @Body() body: ReviewAdminPortfolioItemDto,
  ) {
    return this.portfolio.review(user.id, profileId, itemId, body);
  }
}
