import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AddressDto } from '@homeservicemarketplace/contracts';
import type { Address } from '@homeservicemarketplace/database';

import {
  AddressRepository,
  type CreateAddressInput,
} from '../../../infrastructure/persistence/user/address.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { CreateAddressDto } from '../dto/create-address.dto';
import type { UpdateAddressDto } from '../dto/update-address.dto';

@Injectable()
export class AddressService {
  constructor(
    private readonly repo: AddressRepository,
    private readonly tx: TransactionRunner,
  ) {}

  async list(userId: string): Promise<AddressDto[]> {
    const rows = await this.repo.listForUser(userId);
    return rows.map(toAddressDto);
  }

  // --- Create -------------------------------------------------------------
  // Domain invariants enforced here, all inside one transaction:
  //   1. First address for a user is ALWAYS default, regardless of input.
  //   2. When the caller marks this address default, every other address of
  //      the same user is flipped to isDefault=false in the same tx so at
  //      most one default exists at any time.
  async create(userId: string, input: CreateAddressDto): Promise<AddressDto> {
    return this.tx.run(async (trx) => {
      const existingCount = await this.repo.countForUser(userId, trx);
      const isFirst = existingCount === 0;
      const wantsDefault = input.isDefault === true;
      const willBeDefault = isFirst || wantsDefault;

      const data: CreateAddressInput = {
        userId,
        label: input.label ?? null,
        street: input.street,
        city: input.city,
        state: input.state ?? null,
        zipCode: input.zipCode ?? null,
        country: input.country,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        isDefault: willBeDefault,
      };

      const created = await this.repo.create(data, trx);
      if (willBeDefault) {
        await this.repo.clearDefaultForUserExcept(userId, created.id, trx);
      }
      return toAddressDto(created);
    });
  }

  // --- Update -------------------------------------------------------------
  // Ownership check runs inside the transaction so a concurrent delete can't
  // race us into updating a row the caller no longer owns.
  async update(userId: string, addressId: string, input: UpdateAddressDto): Promise<AddressDto> {
    return this.tx.run(async (trx) => {
      const row = await this.repo.findById(addressId, trx);
      assertOwnership(row, userId);

      const willPromote = input.isDefault === true;
      // Never let a PATCH un-set the last default: if the caller explicitly
      // sets isDefault=false AND this row is the only default, fail loudly
      // rather than silently producing a user with zero default addresses.
      // (To "change default", the caller promotes another row.)
      if (input.isDefault === false && row!.isDefault) {
        throw new ForbiddenException({
          code: 'ADDRESS_DEFAULT_MUST_EXIST',
          message:
            'Cannot unset the only default address. Promote another address to default first.',
        });
      }

      const updated = await this.repo.update(
        addressId,
        {
          label: input.label,
          street: input.street,
          city: input.city,
          state: input.state,
          zipCode: input.zipCode,
          country: input.country,
          latitude: input.latitude,
          longitude: input.longitude,
          ...(willPromote ? { isDefault: true } : {}),
        },
        trx,
      );
      if (willPromote) {
        await this.repo.clearDefaultForUserExcept(userId, updated.id, trx);
      }
      return toAddressDto(updated);
    });
  }

  // --- Delete -------------------------------------------------------------
  // If the deleted row was the default AND the user still has other rows,
  // the oldest remaining address is promoted. This mirrors the "first is
  // default" rule in reverse: a user is never left with addresses but no
  // default.
  async remove(userId: string, addressId: string): Promise<void> {
    await this.tx.run(async (trx) => {
      const row = await this.repo.findById(addressId, trx);
      assertOwnership(row, userId);

      const wasDefault = row!.isDefault;
      await this.repo.delete(addressId, trx);

      if (wasDefault) {
        const replacement = await this.repo.findOldestForUser(userId, trx);
        if (replacement) {
          await this.repo.update(replacement.id, { isDefault: true }, trx);
          await this.repo.clearDefaultForUserExcept(userId, replacement.id, trx);
        }
      }
    });
  }

  // --- Set default --------------------------------------------------------
  async setDefault(userId: string, addressId: string): Promise<AddressDto> {
    return this.tx.run(async (trx) => {
      const row = await this.repo.findById(addressId, trx);
      assertOwnership(row, userId);
      if (!row!.isDefault) {
        await this.repo.update(addressId, { isDefault: true }, trx);
      }
      await this.repo.clearDefaultForUserExcept(userId, addressId, trx);
      const updated = await this.repo.findById(addressId, trx);
      return toAddressDto(updated!);
    });
  }
}

// Treat "address not found" and "address belongs to someone else" as the
// same 404. Returning 403 would leak existence.
function assertOwnership(row: Address | null, userId: string): asserts row is Address {
  if (!row || row.userId !== userId) {
    throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND' });
  }
}

function toAddressDto(row: Address): AddressDto {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    street: row.street,
    city: row.city,
    state: row.state,
    zipCode: row.zipCode,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
