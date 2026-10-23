import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  FINANCIAL_RECORD_KINDS,
  type FinancialRecordKind,
} from '@homeservicemarketplace/contracts';
import type { Response } from 'express';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Permissions } from '../../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { FinancialExportService } from './financial-export.service';
import { FinancialReportService } from './financial-report.service';

export class FinancialPageDto {
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
}

export class FinancialRecordsDto extends FinancialPageDto {
  @IsOptional()
  @IsIn(FINANCIAL_RECORD_KINDS)
  kind: FinancialRecordKind = 'PAYMENT';

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/u)
  currency?: string;
}

export class FinancialSummaryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/u)
  currency?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
@Controller({ path: 'money/operations', version: '1' })
export class FinancialReportController {
  constructor(
    private readonly reports: FinancialReportService,
    private readonly exports: FinancialExportService,
  ) {}

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('money:review:read')
  summary(@CurrentUser() user: AuthenticatedUser, @Query() input: FinancialSummaryDto) {
    return this.reports.summary(user.id, input.currency);
  }

  @Get('records')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('money:review:read')
  records(@CurrentUser() user: AuthenticatedUser, @Query() input: FinancialRecordsDto) {
    return this.reports.records(user.id, 'ADMIN', input);
  }

  @Get('records/:kind/:id')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('money:review:read')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    return this.reports.detail(user.id, 'ADMIN', kind, id);
  }

  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header(
    'Access-Control-Expose-Headers',
    'Content-Disposition, X-Export-Has-More, X-Export-Row-Count',
  )
  @Permissions('money:review:read')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() input: FinancialRecordsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.exports.export(user.id, input);
    response.setHeader('Content-Disposition', 'attachment; filename="financial-operations.csv"');
    response.setHeader('X-Export-Has-More', String(result.hasMore));
    response.setHeader('X-Export-Row-Count', String(result.count));
    return new StreamableFile(result.bytes, {
      type: 'text/csv; charset=utf-8',
      length: result.bytes.length,
    });
  }

  @Get('reconciliation')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('money:review:read')
  reconciliation(@CurrentUser() user: AuthenticatedUser, @Query() input: FinancialPageDto) {
    return this.reports.reconciliation(user.id, input);
  }

  @Get('reconciliation/exceptions/:id')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('money:review:read')
  exception(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reports.exception(user.id, id);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('provider')
@Controller({ path: 'money/history', version: '1' })
export class ProviderFinancialHistoryController {
  constructor(private readonly reports: FinancialReportService) {}

  @Get('records')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('money:read:self')
  records(@CurrentUser() user: AuthenticatedUser, @Query() input: FinancialRecordsDto) {
    return this.reports.records(user.id, 'PROVIDER', input);
  }

  @Get('records/:kind/:id')
  @Header('Cache-Control', 'private, no-store')
  @Permissions('money:read:self')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    return this.reports.detail(user.id, 'PROVIDER', kind, id);
  }
}
