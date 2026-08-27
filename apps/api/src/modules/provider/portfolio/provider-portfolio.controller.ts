import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ProviderCapability } from '@homeservicemarketplace/contracts';

import { ALLOWED_IMAGE_TYPES } from '../../../infrastructure/storage/content-type';
import type {
  ProviderPortfolioItem,
  ProviderPortfolioListResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { ProviderCapabilityGuard } from '../guards/provider-capability.guard';
import { RequireCapability } from '../guards/require-capability.decorator';
import { ProviderPortfolioService } from './provider-portfolio.service';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';

// Sprint 9B.10 — the provider's own gallery.
//
// docs/sprint-09b10/PROVIDER_PORTFOLIO.md
//
// EDIT_OWN_PROFILE, not a capability of its own. A portfolio is profile
// content: the same people who may change a headline may publish work samples,
// and the same people who may not — suspended, terminated — may not do either.
// Sprint 9B.8's route matrix already covers what that capability means in
// every provider state, so a new capability here would need its own row in
// that table to say exactly the same thing.
//
// Every route is scoped to the caller. There is no path parameter naming a
// provider, so there is no surface on which to attempt someone else's gallery;
// ownership is a WHERE clause in the service on top of that.

/** Tighter than the global backstop. Publishing is a write that creates a
 *  moderation obligation, and a loop that creates hundreds of items is a
 *  moderation queue nobody drains rather than a provider using the product. */
const PORTFOLIO_WRITE_THROTTLE = { default: { limit: 60, ttl: 60 * 60 * 1000 } } as const;

class CreatePortfolioItemDto {
  @IsString()
  @Length(1, 512)
  storageKey!: string;

  // Images only. The shared content-type module also allows video; the
  // portfolio deliberately does not — see portfolio-policy.ts.
  @IsString()
  @IsIn([...ALLOWED_IMAGE_TYPES])
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  serviceCategoryId?: string | null;

  /** Literal true. `@IsBoolean` would accept `false`, which is the one value
   *  that must not pass — a customer's home is in the photo. */
  @Equals(true)
  publicationRightAck!: true;
}

class UpdatePortfolioItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  serviceCategoryId?: string | null;
}

class ReorderPortfolioDto {
  @IsArray()
  // Bounded so a reorder cannot become an unbounded write loop. Comfortably
  // above the settings ceiling, because the ceiling can be raised and this is
  // an abuse bound rather than a product one.
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds!: string[];
}

@UseGuards(JwtAuthGuard, RolesGuard, ProviderCapabilityGuard)
@Roles('provider')
@RequireCapability(ProviderCapability.EditOwnProfile)
@Controller({ path: 'me/provider/portfolio', version: '1' })
export class ProviderPortfolioController {
  constructor(private readonly portfolio: ProviderPortfolioService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(@CurrentUser() user: AuthenticatedUser): Promise<ProviderPortfolioListResponse> {
    return this.portfolio.list(user.id);
  }

  @UseGuards(CsrfGuard)
  @Throttle(PORTFOLIO_WRITE_THROTTLE)
  @Post()
  // 200, not 201: the storage key makes this idempotent, so a retry returns
  // the item that already exists. A status alternating with whether the caller
  // happened to be first would invite clients to branch on it.
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreatePortfolioItemDto,
  ): Promise<ProviderPortfolioItem> {
    return this.portfolio.create(user.id, {
      ...body,
      publicationRightAck: true,
    });
  }

  @UseGuards(CsrfGuard)
  @Throttle(PORTFOLIO_WRITE_THROTTLE)
  @Patch(':itemId')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() body: UpdatePortfolioItemDto,
  ): Promise<ProviderPortfolioItem> {
    return this.portfolio.update(user.id, itemId, body);
  }

  @UseGuards(CsrfGuard)
  @Throttle(PORTFOLIO_WRITE_THROTTLE)
  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReorderPortfolioDto,
  ): Promise<ProviderPortfolioListResponse> {
    return this.portfolio.reorder(user.id, body.itemIds);
  }

  @UseGuards(CsrfGuard)
  @Throttle(PORTFOLIO_WRITE_THROTTLE)
  @Delete(':itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string): Promise<void> {
    return this.portfolio.remove(user.id, itemId);
  }
}
