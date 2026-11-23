import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
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
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  fromMoneyWire,
  toMoneyWire,
  type ManualReviewDecisionRequestV1,
} from '@homeservicemarketplace/contracts';
import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { MoneyAmountDto } from '../api/money.controller';
import { ManualReviewService, manualInvalid } from './manual-review.service';
import { ReceiptUploadService } from './receipt-upload.service';
import { ReceiptReadService } from './receipt-read.service';
import {
  ManualRefundReviewService,
  type ManualRefundEvidenceInput,
} from './manual-refund-review.service';
import { ManualEventProcessingJob } from './manual-event-processing.job';

class VersionDto {
  @IsInt() @Min(0) @Max(2147483647) expectedVersion!: number;
}
class ReservationDto extends VersionDto {
  @IsIn(['image/jpeg', 'image/png', 'application/pdf']) contentType!: string;
  @IsInt() @Min(1) @Max(10 * 1024 * 1024) sizeBytes!: number;
  @IsOptional() @IsString() @MaxLength(255) filename?: string;
}
class DecisionDto extends VersionDto implements ManualReviewDecisionRequestV1 {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/u) receiptVersionId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/u) inspectionId!: string;
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_REPLACEMENT'])
  action!: ManualReviewDecisionRequestV1['action'];
  @IsString() @MaxLength(2000) providerMessage!: string;
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/u) settlementId?: string;
}
class SettlementDto {
  @IsString() @MaxLength(200) reference!: string;
  @IsDefined() @ValidateNested() @Type(() => MoneyAmountDto) amount!: MoneyAmountDto;
  @IsISO8601({ strict: true }) @MaxLength(40) occurredAt!: string;
  @IsIn(['SANDBOX_OPERATOR_SIMULATION']) evidenceSource!: 'SANDBOX_OPERATOR_SIMULATION';
}
class RefundEvidenceDto {
  @IsIn(['DISPATCH', 'CONFIRM_SUCCEEDED', 'CONFIRM_FAILED'])
  type!: ManualRefundEvidenceInput['type'];
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,128}$/u) externalOperationId!: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsDefined() @ValidateNested() @Type(() => MoneyAmountDto) amount!: MoneyAmountDto;
  @IsIn(['SANDBOX_OPERATOR_SIMULATION']) evidenceSource!: 'SANDBOX_OPERATOR_SIMULATION';
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string;
}
class QueueDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/u) cursor?: string;
}

const PRIVATE = 'private, no-store, max-age=0, must-revalidate';
const UPLOAD_BUDGET = { default: { limit: 30, ttl: 60 * 60 * 1000 } };

/** Controller registration belongs to MoneyModule; this avoids a circular
 * module import while keeping the domain services independently composable. */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('provider')
@Controller({ path: 'money/manual', version: '1' })
export class ManualPaymentController {
  constructor(
    private readonly review: ManualReviewService,
    private readonly uploads: ReceiptUploadService,
  ) {}

  @Get('intents/:id')
  @Header('Cache-Control', PRIVATE)
  @Permissions('money:read:self')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.review.detail(user.id, id);
  }

  @Post('intents/:id/receipts')
  @UseGuards(CsrfGuard)
  @Permissions('money:purchase:self')
  @Throttle(UPLOAD_BUDGET)
  reserve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() input: ReservationDto,
  ) {
    return this.uploads.reserve(user.id, key, id, input);
  }

  @Put('receipts/:assetId/content')
  @UseGuards(CsrfGuard)
  @Permissions('money:purchase:self')
  @Throttle(UPLOAD_BUDGET)
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId') assetId: string,
    @Headers('content-type') type: string | undefined,
    @Req() request: Request,
  ) {
    const contentType = (type ?? '').split(';')[0]!.trim();
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(contentType))
      throw manualInvalid('INVALID_RECEIPT_TYPE');
    return this.uploads.upload(user.id, assetId, request, contentType);
  }

  @Post('receipts/:assetId/finalize')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Permissions('money:purchase:self')
  @Throttle(UPLOAD_BUDGET)
  finalize(@CurrentUser() user: AuthenticatedUser, @Param('assetId') assetId: string) {
    return this.uploads.finalize(user.id, assetId);
  }

  @Post('intents/:id/submit')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Permissions('money:purchase:self')
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() input: VersionDto,
  ) {
    return this.review.submit(user.id, key, id, input.expectedVersion);
  }
}

/** Both owners and explicitly authorized finance reviewers use the same
 * private route. Identity-evidence privileges are never consulted. */
@UseGuards(JwtAuthGuard)
@Controller({ path: 'money/manual/receipts', version: '1' })
export class ManualReceiptReadController {
  constructor(private readonly reads: ReceiptReadService) {}
  @Get(':assetId/content')
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId') assetId: string,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader('Cache-Control', PRIVATE);
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const result = await this.reads.read(user.id, assetId);
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', 'attachment; filename="receipt"');
    response.setHeader('Content-Length', String(result.bytes.length));
    if (result.inspectionId) response.setHeader('X-Receipt-Inspection-Id', result.inspectionId);
    response.send(result.bytes);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
@Controller({ path: 'money/manual/review', version: '1' })
export class ManualFinanceReviewController {
  constructor(
    private readonly review: ManualReviewService,
    private readonly refunds: ManualRefundReviewService,
    private readonly processor: ManualEventProcessingJob,
  ) {}

  @Get('intents')
  @Header('Cache-Control', PRIVATE)
  @Permissions('money:review:read')
  queue(@CurrentUser() user: AuthenticatedUser, @Query() query: QueueDto) {
    return this.review.queue(user.id, query.cursor);
  }

  @Get('intents/:id')
  @Header('Cache-Control', PRIVATE)
  @Permissions('money:review:read')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.review.detail(user.id, id, true);
  }

  @Post('intents/:id/settlements')
  @UseGuards(CsrfGuard)
  @Permissions('money:receipt:settlement')
  settlement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() input: SettlementDto,
  ) {
    return this.review.recordSettlement(user.id, key, id, {
      ...input,
      amount: toMoneyWire(fromMoneyWire(input.amount)),
    });
  }

  @Post('intents/:id/decisions')
  @HttpCode(202)
  @UseGuards(CsrfGuard)
  @Permissions('money:receipt:review')
  async decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() input: DecisionDto,
  ) {
    const result = await this.review.decide(user.id, key, id, input);
    if (result.approval) await this.processor.process(id);
    return this.review.detail(user.id, id, true);
  }

  @Post('refunds/:id/evidence')
  @UseGuards(CsrfGuard)
  @Permissions('money:refund:review')
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() input: RefundEvidenceDto,
  ) {
    return this.refunds.record(user.id, key, id, {
      ...input,
      amount: toMoneyWire(fromMoneyWire(input.amount)),
    });
  }

  @Post('intents/:id/retry')
  @HttpCode(202)
  @UseGuards(CsrfGuard)
  @Permissions('money:receipt:review')
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() input: VersionDto,
  ) {
    await this.review.retry(user.id, key, id, input.expectedVersion);
    await this.processor.process(id);
    return this.review.detail(user.id, id, true);
  }
}
