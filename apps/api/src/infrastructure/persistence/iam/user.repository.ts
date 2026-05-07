import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaTx, User } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateUserInput {
  email: string;
  passwordHash?: string | null;
  firstName: string;
  lastName: string;
  isActive?: boolean;
}

export interface UpdateUserInput {
  email?: string;
  passwordHash?: string | null;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  findById(id: string, tx?: PrismaTx): Promise<User | null> {
    return this.db(tx).user.findFirst({ where: { id, deletedAt: null } });
  }

  findByEmail(email: string, tx?: PrismaTx): Promise<User | null> {
    return this.db(tx).user.findFirst({ where: { email, deletedAt: null } });
  }

  list(
    args: { take?: number; skip?: number; cursor?: string } = {},
    tx?: PrismaTx,
  ): Promise<User[]> {
    const take = Math.min(Math.max(args.take ?? 50, 1), 200);
    const where: Prisma.UserWhereInput = { deletedAt: null };
    return this.db(tx).user.findMany({
      where,
      take,
      skip: args.skip,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      // Compound order ensures cursor-by-id is deterministic even when two
      // rows share the same createdAt (without the `id` tiebreaker, cursor
      // pagination can skip or duplicate rows — a correctness bug).
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  // Sprint 6.1: admin-side search. `q` matches email / firstName /
  // lastName case-insensitively (Postgres ILIKE). `status` and
  // `roleName` are exact filters. Cursor pagination by id descending
  // (matches the seeker patterns).
  searchForAdmin(
    args: {
      q?: string;
      status?: string;
      roleName?: string;
      take: number;
      cursor?: string;
    },
    tx?: PrismaTx,
  ): Promise<User[]> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(args.status ? { status: args.status as Prisma.UserWhereInput['status'] } : {}),
      ...(args.roleName ? { userRoles: { some: { role: { name: args.roleName } } } } : {}),
      ...(args.q
        ? {
            OR: [
              { email: { contains: args.q, mode: 'insensitive' } },
              { firstName: { contains: args.q, mode: 'insensitive' } },
              { lastName: { contains: args.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.db(tx).user.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  create(input: CreateUserInput, tx?: PrismaTx): Promise<User> {
    return this.db(tx).user.create({ data: input });
  }

  update(id: string, input: UpdateUserInput, tx?: PrismaTx): Promise<User> {
    // extendedWhereUnique (GA in Prisma 5.7+): refuse to update soft-deleted rows.
    // Without this filter, a caller could silently mutate a deleted user.
    return this.db(tx).user.update({ where: { id, deletedAt: null }, data: input });
  }

  softDelete(id: string, tx?: PrismaTx): Promise<User> {
    return this.db(tx).user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  assignRole(userId: string, roleId: string, tx?: PrismaTx): Promise<void> {
    return this.db(tx)
      .userRole.upsert({
        where: { userId_roleId: { userId, roleId } },
        update: {},
        create: { userId, roleId },
      })
      .then(() => undefined);
  }

  removeRole(userId: string, roleId: string, tx?: PrismaTx): Promise<void> {
    return this.db(tx)
      .userRole.deleteMany({ where: { userId, roleId } })
      .then(() => undefined);
  }

  listRoles(userId: string, tx?: PrismaTx) {
    return this.db(tx).userRole.findMany({
      where: { userId },
      include: { role: true },
    });
  }
}
