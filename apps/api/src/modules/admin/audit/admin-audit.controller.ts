import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { ListAuditEventsResponse } from '@homeservicemarketplace/contracts';

import { AuditEventRepository } from '../../../infrastructure/persistence/iam/audit-event.repository';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';

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

const DEFAULT_PAGE_SIZE = 50;

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller({ path: 'admin/audit', version: '1' })
export class AdminAuditController {
  constructor(private readonly events: AuditEventRepository) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Query() query: ListAuditEventsQueryDto): Promise<ListAuditEventsResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.events.list({
      type: query.type,
      userId: query.userId,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items = page.map((row) => ({
      id: row.id,
      userId: row.userId,
      type: row.type,
      metadata: (row.metadata as Record<string, unknown> | null) ?? {},
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    }));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }
}
