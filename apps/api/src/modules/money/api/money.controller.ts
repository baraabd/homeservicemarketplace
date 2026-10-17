import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsDefined,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MONEY_CONTRACT_VERSION,
  PAYMENT_METHODS,
  fromMoneyWire,
  toMoneyWire,
  MoneyWireError,
  type MoneyContractVersion,
  type MoneyPurchaseRequestV1,
  type PaymentMethod,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { MoneyCommandService } from '../application/money-command.service';
import { MoneyQueryService } from '../application/money-query.service';
import { AppError } from '../../../shared/errors/app-error';

export class MoneyVersionDto {
  @IsIn([MONEY_CONTRACT_VERSION])
  contractVersion!: MoneyContractVersion;
}

export class MoneyPurchaseDto extends MoneyVersionDto implements MoneyPurchaseRequestV1 {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/u)
  planVersionId!: string;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  couponCode?: string;
}

export class MoneyAmountDto {
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,18})$/u)
  amountMinor!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/u)
  currency!: string;
}

export class MoneyRefundRequestDto extends MoneyVersionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/u)
  paymentConfirmationId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyAmountDto)
  amount!: MoneyAmountDto;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,63}$/u)
  reasonCode!: string;
}

export class MoneyReceiptDto extends MoneyVersionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/u)
  paymentIntentId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/u)
  receiptMediaAssetId!: string;
}

export class MoneyPageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^[A-Za-z0-9_-]+$/u)
  cursor?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/u)
  currency?: string;
}

export class MoneyFinancialQueryDto {
  @IsString()
  @Matches(/^[A-Z]{3}$/u)
  currency!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(40)
  asOf?: string;
}

// The current session supplies the user. No userId, providerProfileId,
// amount/quote authority, ledger account or mode field exists on purchase DTOs.
// Services repeat fresh database authorization before writes and key replays.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('provider')
@Controller({ path: 'money', version: '1' })
export class MoneyController {
  constructor(
    private readonly commands: MoneyCommandService,
    private readonly queries: MoneyQueryService,
  ) {}

  @Post('quotes')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Permissions('money:purchase:self')
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Body() input: MoneyPurchaseDto,
  ) {
    return this.commands.quote(user.id, key, input);
  }

  @Post('intents')
  @UseGuards(CsrfGuard)
  @Permissions('money:purchase:self')
  createIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Body() input: MoneyPurchaseDto,
  ) {
    return this.commands.createIntent(user.id, key, input);
  }

  @Get('intents')
  @Permissions('money:read:self')
  intents(@CurrentUser() user: AuthenticatedUser, @Query() query: MoneyPageDto) {
    return this.queries.listIntents(user.id, query);
  }

  @Get('intents/:id')
  @Permissions('money:read:self')
  intent(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queries.intent(user.id, id);
  }

  @Post('intents/:id/attempts')
  @HttpCode(202)
  @UseGuards(CsrfGuard)
  @Permissions('money:purchase:self')
  startCollection(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() _version: MoneyVersionDto,
  ) {
    return this.commands.startCollection(user.id, key, id);
  }

  @Get('attempts/:id')
  @Permissions('money:read:self')
  attempt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queries.attempt(user.id, id);
  }

  @Post('attempts/:id/resume')
  @HttpCode(202)
  @UseGuards(CsrfGuard)
  @Permissions('money:purchase:self')
  resumeCollection(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() _version: MoneyVersionDto,
  ) {
    return this.commands.resumeCollection(user.id, key, id);
  }

  @Post('intents/:id/cancel')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Permissions('money:purchase:self')
  cancelIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() _version: MoneyVersionDto,
  ) {
    return this.commands.cancelIntent(user.id, key, id);
  }

  @Get('subscriptions')
  @Permissions('money:read:self')
  subscriptions(@CurrentUser() user: AuthenticatedUser, @Query() query: MoneyPageDto) {
    return this.queries.subscriptions(user.id, query);
  }

  @Get('subscriptions/:id')
  @Permissions('money:read:self')
  subscription(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queries.subscription(user.id, id);
  }

  @Get('subscriptions/:id/usage')
  @Permissions('money:read:self')
  usage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: MoneyPageDto,
  ) {
    return this.queries.usage(user.id, id, query);
  }

  @Post('refund-requests')
  @HttpCode(202)
  @UseGuards(CsrfGuard)
  @Permissions('money:refund:request:self')
  requestRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Body() input: MoneyRefundRequestDto,
  ) {
    try {
      // The accepted parser checks the exact PostgreSQL BIGINT range without
      // ever coercing through a JavaScript number.
      return this.commands.requestRefund(user.id, key, {
        ...input,
        amount: toMoneyWire(fromMoneyWire(input.amount)),
      });
    } catch (error) {
      if (error instanceof MoneyWireError) {
        throw new AppError('VALIDATION_ERROR', 'A canonical money amount is required.', 400, {
          reason: error.code,
        });
      }
      throw error;
    }
  }

  @Get('refund-requests')
  @Permissions('money:read:self')
  refundRequests(@CurrentUser() user: AuthenticatedUser, @Query() query: MoneyPageDto) {
    return this.queries.listRefundRequests(user.id, query);
  }

  @Get('refund-requests/:id')
  @Permissions('money:read:self')
  refundRequest(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.queries.refundRequest(user.id, id);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
@Controller({ path: 'money/review', version: '1' })
export class MoneyReviewController {
  constructor(
    private readonly commands: MoneyCommandService,
    private readonly queries: MoneyQueryService,
  ) {}

  @Get('intents')
  @Permissions('money:review:read')
  intents(@CurrentUser() user: AuthenticatedUser, @Query() query: MoneyPageDto) {
    return this.queries.reviewIntents(user.id, query);
  }

  @Get('refund-requests')
  @Permissions('money:review:read')
  refundRequests(@CurrentUser() user: AuthenticatedUser, @Query() query: MoneyPageDto) {
    return this.queries.reviewRefundRequests(user.id, query);
  }

  @Get('financials')
  @Permissions('money:review:read')
  financials(@CurrentUser() user: AuthenticatedUser, @Query() query: MoneyFinancialQueryDto) {
    return this.queries.reviewFinancials(user.id, query);
  }

  @Get('exceptions')
  @Permissions('money:review:read')
  exceptions(@CurrentUser() user: AuthenticatedUser, @Query() query: MoneyPageDto) {
    return this.queries.reviewExceptions(user.id, query);
  }

  @Post('receipts/accept')
  @HttpCode(202)
  @UseGuards(CsrfGuard)
  @Permissions('money:receipt:review')
  acceptReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Body() input: MoneyReceiptDto,
  ) {
    return this.commands.acceptReceipt(user.id, key, input);
  }

  @Post('refund-requests/:id/reserve')
  @UseGuards(CsrfGuard)
  @Permissions('money:refund:review')
  reserveRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() _version: MoneyVersionDto,
  ) {
    return this.commands.reserveRefund(user.id, key, id);
  }

  @Post('refunds/:id/dispatch')
  @HttpCode(202)
  @UseGuards(CsrfGuard)
  @Permissions('money:refund:review')
  dispatchRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() _version: MoneyVersionDto,
  ) {
    return this.commands.dispatchRefund(user.id, key, id);
  }

  @Post('refunds/:id/query')
  @HttpCode(202)
  @UseGuards(CsrfGuard)
  @Permissions('money:refund:review')
  queryRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string,
    @Param('id') id: string,
    @Body() _version: MoneyVersionDto,
  ) {
    return this.commands.queryRefund(user.id, key, id);
  }
}
