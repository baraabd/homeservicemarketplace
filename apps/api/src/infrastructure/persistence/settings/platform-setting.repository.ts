import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Sprint 6.5: platform settings persistence. Like the dispute
// repository, uses an inline typed stub so we don't depend on a
// fresh `prisma generate` (Windows DLL lock from running nest watch).
export interface PlatformSettingRow {
  key: string;
  value: Prisma.JsonValue;
  updatedAt: Date;
  updatedBy: string | null;
}

@Injectable()
export class PlatformSettingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return (tx ?? this.prisma.client) as unknown as {
      platformSetting: {
        findMany: (args: unknown) => Promise<PlatformSettingRow[]>;
        findUnique: (args: { where: { key: string } }) => Promise<PlatformSettingRow | null>;
        upsert: (args: {
          where: { key: string };
          create: PlatformSettingRow;
          update: Partial<PlatformSettingRow>;
        }) => Promise<PlatformSettingRow>;
        delete: (args: { where: { key: string } }) => Promise<PlatformSettingRow>;
      };
    };
  }

  list(tx?: PrismaTx): Promise<PlatformSettingRow[]> {
    return this.db(tx).platformSetting.findMany({ orderBy: [{ key: 'asc' }] });
  }

  findByKey(key: string, tx?: PrismaTx): Promise<PlatformSettingRow | null> {
    return this.db(tx).platformSetting.findUnique({ where: { key } });
  }

  upsert(
    input: { key: string; value: Prisma.JsonValue; updatedBy: string },
    tx?: PrismaTx,
  ): Promise<PlatformSettingRow> {
    return this.db(tx).platformSetting.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        value: input.value,
        updatedAt: new Date(),
        updatedBy: input.updatedBy,
      },
      update: { value: input.value, updatedBy: input.updatedBy },
    });
  }

  delete(key: string, tx?: PrismaTx): Promise<PlatformSettingRow> {
    return this.db(tx).platformSetting.delete({ where: { key } });
  }
}
