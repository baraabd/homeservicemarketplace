import { Injectable } from '@nestjs/common';
import type { Address, AddressType, Prisma, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateAddressInput {
  userId: string;
  label: string;
  type: AddressType;
  line1: string;
  city: string;
  country: string;
  lat?: number | null;
  lng?: number | null;
  isDefault?: boolean;
}

export interface UpdateAddressInput {
  label?: string;
  type?: AddressType;
  line1?: string;
  city?: string;
  country?: string;
  lat?: number | null;
  lng?: number | null;
}

// Saved-address persistence. Every read site filters `deletedAt: null`
// so soft-deleted rows never escape the repository. Mutating call sites
// either match on { id, userId, deletedAt: null } (extendedWhereUnique)
// or use the soft-delete helper — there is no path that can update or
// hard-delete another user's row.
@Injectable()
export class AddressRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  listForUser(userId: string, tx?: PrismaTx): Promise<Address[]> {
    return this.db(tx).address.findMany({
      where: { userId, deletedAt: null },
      // Default first, then most recently created — matches the UX of
      // "the default address is the first thing the user sees".
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  // Returns the row only when it belongs to the given user AND is not
  // soft-deleted. Used at every ownership-checked call site.
  findOwned(addressId: string, userId: string, tx?: PrismaTx): Promise<Address | null> {
    return this.db(tx).address.findFirst({
      where: { id: addressId, userId, deletedAt: null },
    });
  }

  findCurrentDefault(userId: string, tx?: PrismaTx): Promise<Address | null> {
    return this.db(tx).address.findFirst({
      where: { userId, isDefault: true, deletedAt: null },
    });
  }

  countForUser(userId: string, tx?: PrismaTx): Promise<number> {
    return this.db(tx).address.count({
      where: { userId, deletedAt: null },
    });
  }

  create(input: CreateAddressInput, tx?: PrismaTx): Promise<Address> {
    const data: Prisma.AddressCreateInput = {
      label: input.label,
      type: input.type,
      line1: input.line1,
      city: input.city,
      country: input.country,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      isDefault: input.isDefault ?? false,
      user: { connect: { id: input.userId } },
    };
    return this.db(tx).address.create({ data });
  }

  // Updates only when the row is owned and not soft-deleted; the
  // composite where prevents cross-user mutation even if the caller
  // passes a foreign id by mistake.
  updateOwned(
    addressId: string,
    userId: string,
    input: UpdateAddressInput,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).address.updateMany({
      where: { id: addressId, userId, deletedAt: null },
      data: input,
    });
  }

  // Demote every default row for the user except (optionally) one.
  // Used by setDefault to clear the previous default before promoting
  // the new one — both writes happen inside a single transaction so a
  // crash between them never leaves the user with two defaults.
  clearDefaultExcept(
    userId: string,
    exceptId: string | null,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).address.updateMany({
      where: {
        userId,
        deletedAt: null,
        isDefault: true,
        ...(exceptId !== null ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  setDefaultOwned(addressId: string, userId: string, tx?: PrismaTx): Promise<Prisma.BatchPayload> {
    return this.db(tx).address.updateMany({
      where: { id: addressId, userId, deletedAt: null },
      data: { isDefault: true },
    });
  }

  softDeleteOwned(addressId: string, userId: string, tx?: PrismaTx): Promise<Prisma.BatchPayload> {
    return this.db(tx).address.updateMany({
      where: { id: addressId, userId, deletedAt: null },
      data: { deletedAt: new Date(), isDefault: false },
    });
  }
}
