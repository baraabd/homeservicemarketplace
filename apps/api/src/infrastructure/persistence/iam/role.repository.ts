import { Injectable } from '@nestjs/common';
import type { PrismaTx, Role } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateRoleInput {
  name: string;
  description?: string | null;
  isSystem?: boolean;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
}

@Injectable()
export class RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  findById(id: string, tx?: PrismaTx): Promise<Role | null> {
    return this.db(tx).role.findFirst({ where: { id, deletedAt: null } });
  }

  findByName(name: string, tx?: PrismaTx): Promise<Role | null> {
    return this.db(tx).role.findFirst({ where: { name, deletedAt: null } });
  }

  listAll(tx?: PrismaTx): Promise<Role[]> {
    return this.db(tx).role.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  create(input: CreateRoleInput, tx?: PrismaTx): Promise<Role> {
    return this.db(tx).role.create({
      data: { name: input.name, description: input.description, isSystem: input.isSystem ?? false },
    });
  }

  update(id: string, input: UpdateRoleInput, tx?: PrismaTx): Promise<Role> {
    // extendedWhereUnique (GA in Prisma 5.7+): refuse to update soft-deleted rows.
    return this.db(tx).role.update({ where: { id, deletedAt: null }, data: input });
  }

  softDelete(id: string, tx?: PrismaTx): Promise<Role> {
    return this.db(tx).role.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  attachPermission(roleId: string, permissionId: string, tx?: PrismaTx): Promise<void> {
    return this.db(tx)
      .rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      })
      .then(() => undefined);
  }

  detachPermission(roleId: string, permissionId: string, tx?: PrismaTx): Promise<void> {
    return this.db(tx)
      .rolePermission.deleteMany({ where: { roleId, permissionId } })
      .then(() => undefined);
  }

  listPermissions(roleId: string, tx?: PrismaTx) {
    return this.db(tx).rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });
  }
}
