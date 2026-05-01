import { Injectable } from '@nestjs/common';
import type { AddressSummary } from '@homeservicemarketplace/contracts';
import type { Address } from '@homeservicemarketplace/database';

import {
  AddressRepository,
  type CreateAddressInput,
  type UpdateAddressInput,
} from '../../infrastructure/persistence/addresses/address.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';

@Injectable()
export class AddressesService {
  constructor(
    private readonly addresses: AddressRepository,
    private readonly tx: TransactionRunner,
  ) {}

  // List the authenticated user's saved addresses. Soft-deleted rows
  // are dropped at the repository layer so this surface only ever sees
  // live data.
  async list(userId: string): Promise<AddressSummary[]> {
    const rows = await this.addresses.listForUser(userId);
    return rows.map(toSummary);
  }

  // Create a new address. When the row is the user's first, or the
  // payload sets `isDefault: true`, the create + demote-previous-default
  // happens inside a single transaction so the at-most-one-default
  // invariant is preserved even under concurrent writes.
  async create(userId: string, input: Omit<CreateAddressInput, 'userId'>): Promise<AddressSummary> {
    const created = await this.tx.run(async (tx) => {
      const existingCount = await this.addresses.countForUser(userId, tx);
      // First-ever address is always default — the UX expectation is
      // "you've added your first address, of course it's your default".
      const shouldBeDefault = input.isDefault === true || existingCount === 0;
      if (shouldBeDefault) {
        await this.addresses.clearDefaultExcept(userId, null, tx);
      }
      return this.addresses.create({ ...input, userId, isDefault: shouldBeDefault }, tx);
    });
    return toSummary(created);
  }

  // Patch an existing owned address. The composite where in the
  // repository ensures we cannot mutate another user's row even if a
  // foreign id is presented. A zero-row update is mapped to NOT_FOUND
  // so the client can't distinguish "doesn't exist" from "owned by
  // someone else" — that's the right answer for an authorization check.
  async update(
    userId: string,
    addressId: string,
    input: UpdateAddressInput,
  ): Promise<AddressSummary> {
    const result = await this.addresses.updateOwned(addressId, userId, input);
    if (result.count === 0) {
      throw new AppError('NOT_FOUND', 'Address not found.', 404);
    }
    const reloaded = await this.addresses.findOwned(addressId, userId);
    if (!reloaded) {
      // Should be unreachable — the update just succeeded — but defend
      // against a concurrent soft-delete racing the read.
      throw new AppError('NOT_FOUND', 'Address not found.', 404);
    }
    return toSummary(reloaded);
  }

  // Promote an owned address to default. Demotes any other defaults the
  // user has (including soft-delete edge cases) inside the same
  // transaction; if the row is gone or not owned, returns NOT_FOUND.
  async setDefault(userId: string, addressId: string): Promise<AddressSummary> {
    const promoted = await this.tx.run(async (tx) => {
      const owned = await this.addresses.findOwned(addressId, userId, tx);
      if (!owned) {
        throw new AppError('NOT_FOUND', 'Address not found.', 404);
      }
      // Demote everyone else for this user first, THEN promote this row.
      // Doing it in this order means there is never a window where two
      // rows are simultaneously default for the same user, even if
      // another writer interleaves.
      await this.addresses.clearDefaultExcept(userId, addressId, tx);
      await this.addresses.setDefaultOwned(addressId, userId, tx);
      // Re-read inside the same tx to return the post-state.
      return this.addresses.findOwned(addressId, userId, tx);
    });
    if (!promoted) {
      throw new AppError('NOT_FOUND', 'Address not found.', 404);
    }
    return toSummary(promoted);
  }

  // Soft-delete an owned address. Deleting the current default is
  // rejected when the user still has other addresses — we deliberately
  // do NOT auto-promote a replacement. Reasons:
  //   1) Promotion would silently change which address is "default" from
  //      under the user; surprising side effects from a delete are bad.
  //   2) Forcing the user to set another default first keeps the
  //      authoritative choice in their hands.
  // If it is the only remaining address, the soft-delete proceeds (there
  // is nothing to promote).
  async remove(userId: string, addressId: string): Promise<void> {
    await this.tx.run(async (tx) => {
      const owned = await this.addresses.findOwned(addressId, userId, tx);
      if (!owned) {
        throw new AppError('NOT_FOUND', 'Address not found.', 404);
      }
      if (owned.isDefault) {
        const remaining = await this.addresses.countForUser(userId, tx);
        if (remaining > 1) {
          throw new AppError(
            'CONFLICT',
            'Cannot delete the default address while other addresses exist. Set another address as default first.',
            409,
          );
        }
      }
      const result = await this.addresses.softDeleteOwned(addressId, userId, tx);
      if (result.count === 0) {
        throw new AppError('NOT_FOUND', 'Address not found.', 404);
      }
    });
  }
}

// Persistence row → wire DTO. Drops infra-only fields (createdAt,
// updatedAt, deletedAt, userId) so the row shape never escapes the
// module boundary. Centralized here so every endpoint maps identically.
function toSummary(row: Address): AddressSummary {
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    line1: row.line1,
    city: row.city,
    country: row.country,
    lat: row.lat,
    lng: row.lng,
    isDefault: row.isDefault,
  };
}
