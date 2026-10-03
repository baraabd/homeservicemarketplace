import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  CreateSupportTicketRequest,
  SendSupportMessageRequest,
} from '@homeservicemarketplace/contracts';
import { SupportTicketStatus } from '@homeservicemarketplace/database';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { Permissions } from '../iam/authorization/decorators/permissions.decorator';
import { Roles } from '../iam/authorization/decorators/roles.decorator';
import { PermissionsGuard } from '../iam/authorization/guards/permissions.guard';
import { RolesGuard } from '../iam/authorization/guards/roles.guard';
import { SupportService } from './support.service';

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

class CreateSupportTicketDto implements CreateSupportTicketRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  @Matches(KEY_PATTERN)
  idempotencyKey!: string;
}

class SendSupportMessageDto implements SendSupportMessageRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(128)
  @Matches(KEY_PATTERN)
  idempotencyKey!: string;
}

class ListSupportDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class ListAdminSupportDto extends ListSupportDto {
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: SupportTicketStatus;
}

@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/support/tickets', version: '1' })
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSupportDto) {
    return this.support.listMine(user.id, query.limit, query.cursor);
  }

  @Get(':ticketId')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('ticketId') ticketId: string) {
    return this.support.detailMine(user.id, ticketId);
  }

  @Post()
  @UseGuards(CsrfGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateSupportTicketDto) {
    return this.support.createTicket(user.id, body);
  }

  @Post(':ticketId/messages')
  @UseGuards(CsrfGuard)
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
    @Body() body: SendSupportMessageDto,
  ) {
    return this.support.sendMine(user.id, ticketId, body);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('admin')
@Permissions('user:read:any')
@Controller({ path: 'admin/support/tickets', version: '1' })
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAdminSupportDto,
  ) {
    return this.support.listAdmin(user.id, query.status, query.limit, query.cursor);
  }

  @Get(':ticketId')
  detail(@CurrentUser() user: AuthenticatedUser, @Param('ticketId') ticketId: string) {
    return this.support.detailAdmin(user.id, ticketId);
  }

  @Post(':ticketId/messages')
  @UseGuards(CsrfGuard)
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ticketId') ticketId: string,
    @Body() body: SendSupportMessageDto,
  ) {
    return this.support.sendAdmin(user.id, ticketId, body);
  }

  @Post(':ticketId/close')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  close(@CurrentUser() user: AuthenticatedUser, @Param('ticketId') ticketId: string) {
    return this.support.closeAdmin(user.id, ticketId);
  }

  @Post(':ticketId/reopen')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  reopen(@CurrentUser() user: AuthenticatedUser, @Param('ticketId') ticketId: string) {
    return this.support.reopenAdmin(user.id, ticketId);
  }
}
