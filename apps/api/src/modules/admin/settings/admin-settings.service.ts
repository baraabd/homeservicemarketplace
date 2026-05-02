import { Injectable } from '@nestjs/common';
import type {
  AdminSettingValue,
  ListSettingsResponse,
  SettingMutationResponse,
} from '@homeservicemarketplace/contracts';
import type { AuditEventType, Prisma } from '@homeservicemarketplace/database';

import {
  PlatformSettingRepository,
  type PlatformSettingRow,
} from '../../../infrastructure/persistence/settings/platform-setting.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AdminAuditService } from '../admin-audit.service';

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly settings: PlatformSettingRepository,
    private readonly audit: AdminAuditService,
    private readonly tx: TransactionRunner,
  ) {}

  async list(): Promise<ListSettingsResponse> {
    const rows = await this.settings.list();
    return { items: rows.map(toSummary) };
  }

  async detail(key: string): Promise<AdminSettingValue> {
    const row = await this.settings.findByKey(key);
    if (!row) throw new AppError('NOT_FOUND', 'Setting not found.', 404);
    return toSummary(row);
  }

  async upsert(adminUserId: string, key: string, value: unknown): Promise<SettingMutationResponse> {
    const result = await this.tx.run(async (tx) => {
      const previous = await this.settings.findByKey(key, tx);
      const next = await this.settings.upsert(
        { key, value: value as Prisma.JsonValue, updatedBy: adminUserId },
        tx,
      );
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_SETTING_UPDATED' as AuditEventType,
          metadata: {
            key,
            previousValue: previous?.value ?? null,
            newValue: value as Prisma.JsonValue,
          },
        },
        tx,
      );
      return next;
    });
    return { setting: toSummary(result) };
  }

  async remove(adminUserId: string, key: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const previous = await this.settings.findByKey(key, tx);
      if (!previous) throw new AppError('NOT_FOUND', 'Setting not found.', 404);
      await this.settings.delete(key, tx);
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_SETTING_UPDATED' as AuditEventType,
          metadata: {
            key,
            action: 'deleted',
            previousValue: previous.value,
            newValue: null,
          },
        },
        tx,
      );
    });
  }
}

function toSummary(row: PlatformSettingRow): AdminSettingValue {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}
