import { RequireCapability } from '../guards/require-capability.decorator';
import { ProviderCapability } from '@homeservicemarketplace/contracts';
import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import type {
  ListEarningsTransactionsResponse,
  ProviderEarningsSummary,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { ProviderCapabilityGuard } from '../guards/provider-capability.guard';
import { ListEarningsTransactionsQueryDto } from './dto/list-earnings-transactions.query';
import { ProviderWalletService } from './provider-wallet.service';

// /v1/me/provider/earnings — Provider wallet read model
// (Sprint 5 slice 5.6).
//
// Read-only. Same auth posture as the other provider surfaces:
// JwtAuthGuard + RolesGuard('provider') + ProviderCapabilityGuard. No
// CSRF (no mutations).
@UseGuards(JwtAuthGuard, RolesGuard, ProviderCapabilityGuard)
@Roles('provider')
// Sprint 9B.8 — money already earned. Rank 4 grants VIEW_EARNINGS: a restricted provider may still see what they are owed.
@RequireCapability(ProviderCapability.ViewEarnings)
@Controller({ path: 'me/provider/earnings', version: '1' })
export class ProviderWalletController {
  constructor(private readonly wallet: ProviderWalletService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  summary(@CurrentUser() user: AuthenticatedUser): Promise<ProviderEarningsSummary> {
    return this.wallet.summary(user.id);
  }

  @Get('transactions')
  @HttpCode(HttpStatus.OK)
  transactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListEarningsTransactionsQueryDto,
  ): Promise<ListEarningsTransactionsResponse> {
    return this.wallet.transactions(user.id, query);
  }
}
