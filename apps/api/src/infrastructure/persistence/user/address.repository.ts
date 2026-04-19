import { Injectable } from '@nestjs/common';
import type { Address, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateAddressInput {
  userId: string;
  label?: string | null;
  street: string;
  city: string;
  state?: string | null;
  zipCode?: string | null;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
}

export interface UpdateAddressInput {
  label?: string | null;
  street?: string;
  city?: string;
  state?: string | null;
  zipCode?: string | null;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
}

@Injectable()
export class AddressRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  listForUser(userId: string, tx?: PrismaTx): Promise<Address[]> {
    return this.db(tx).address.findMany({
      where: { userId },
      // Put the default first for predictable UI rendering; then newest → oldest
      // with an id tiebreaker so the order is stable under cursor pagination
      // if/when it's added.
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  findById(id: string, tx?: PrismaTx): Promise<Address | null> {
    return this.db(tx).address.findUnique({ where: { id } });
  }

  countForUser(userId: string, tx?: PrismaTx): Promise<number> {
    return this.db(tx).address.count({ where: { userId } });
  }

  create(input: CreateAddressInput, tx?: PrismaTx): Promise<Address> {
    return this.db(tx).address.create({ data: input });
  }

  update(id: string, input: UpdateAddressInput, tx?: PrismaTx): Promise<Address> {
    return this.db(tx).address.update({ where: { id }, data: input });
  }

  delete(id: string, tx?: PrismaTx): Promise<Address> {
    return this.db(tx).address.delete({ where: { id } });
  }

  // Clear the default flag on every OTHER address for this user. Used inside
  // the same transaction that flips the new default, keeping the invariant
  // "at most one default per user" atomic under concurrent PATCH/POST.
  clearDefaultForUserExcept(userId: string, exceptId: string, tx?: PrismaTx) {
    return this.db(tx).address.updateMany({
      where: { userId, id: { not: exceptId }, isDefault: true },
      data: { isDefault: false },
    });
  }

  findOldestForUser(userId: string, tx?: PrismaTx): Promise<Address | null> {
    return this.db(tx).address.findFirst({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
