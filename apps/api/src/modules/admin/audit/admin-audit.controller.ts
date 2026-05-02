import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type {
  AdminAuditEvent,
  AdminAuditLog,
  ListAdminAuditLogsResponse,
  ListAuditEventsResponse,
} from '@homeservicemarketplace/contracts';

import { AuditEventRepository } from '../../../infrastructure/persistence/iam/audit-event.repository';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { redactSensitive } from './admin-audit-redaction';

class ListAuditEventsQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  type?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  userId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  cursor?: string;
}

class ListAdminAuditLogsQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  actor?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  action?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  cursor?: string;
}

const DEFAULT_PAGE_SIZE = 50;

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin', version: '1' })
export class AdminAuditController {
  constructor(private readonly events: AuditEventRepository) {}

  @Get('audit')
  @HttpCode(HttpStatus.OK)
  async listLegacy(@Query() query: ListAuditEventsQueryDto): Promise<ListAuditEventsResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.events.list({
      type: query.type,
      userId: query.userId,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items: AdminAuditEvent[] = page.map((row) => ({
      id: row.id,
      userId: row.userId,
      type: row.type,
      metadata: redactSensitive((row.metadata as Record<string, unknown> | null) ?? {}),
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    }));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  @Get('audit-logs')
  @HttpCode(HttpStatus.OK)
  async list(@Query() query: ListAdminAuditLogsQueryDto): Promise<ListAdminAuditLogsResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.events.list({
      type: query.action,
      userId: query.actor,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items: AdminAuditLog[] = page.map((row) => ({
      id: row.id,
      actor: row.userId,
      action: row.type,
      metadata: redactSensitive((row.metadata as Record<string, unknown> | null) ?? {}),
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    }));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }
}
