import { Injectable } from '@nestjs/common';
import type { Permission, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreatePermissionInput {
  key: string;
  description?: string | null;
}

@Injectable()
export class PermissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  findById(id: string, tx?: PrismaTx): Promise<Permission | null> {
    return this.db(tx).permission.findUnique({ where: { id } });
  }

  findByKey(key: string, tx?: PrismaTx): Promise<Permission | null> {
    return this.db(tx).permission.findUnique({ where: { key } });
  }

  listAll(tx?: PrismaTx): Promise<Permission[]> {
    return this.db(tx).permission.findMany({ orderBy: { key: 'asc' } });
  }

  upsertByKey(input: CreatePermissionInput, tx?: PrismaTx): Promise<Permission> {
    return this.db(tx).permission.upsert({
      where: { key: input.key },
      update: { description: input.description ?? null },
      create: { key: input.key, description: input.description ?? null },
    });
  }
}
