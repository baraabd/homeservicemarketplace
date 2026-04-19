import { Injectable } from '@nestjs/common';
import type { ProfileDto } from '@homeservicemarketplace/contracts';
import type { UserProfile } from '@homeservicemarketplace/database';

import { UserProfileRepository } from '../../../infrastructure/persistence/user/user-profile.repository';
import type { UpdateProfileDto } from '../dto/update-profile.dto';

@Injectable()
export class ProfileService {
  constructor(private readonly repo: UserProfileRepository) {}

  // Lazy-init strategy: the first GET after registration auto-creates an
  // empty profile row. This keeps the frontend round-trip a plain GET →
  // 200 with a stable shape, instead of teaching the client to handle
  // 404-then-create.
  async getOrCreate(userId: string): Promise<ProfileDto> {
    const existing = await this.repo.findByUserId(userId);
    if (existing) return toProfileDto(existing);
    const created = await this.repo.upsert(userId, {});
    return toProfileDto(created);
  }

  async update(userId: string, input: UpdateProfileDto): Promise<ProfileDto> {
    // Upsert here too — the user may PATCH before they've ever GET'd.
    // The userId unique index guarantees a single row.
    const row = await this.repo.upsert(userId, {
      avatarUrl: input.avatarUrl,
      phoneNumber: input.phoneNumber,
      bio: input.bio,
    });
    return toProfileDto(row);
  }
}

function toProfileDto(row: UserProfile): ProfileDto {
  return {
    id: row.id,
    userId: row.userId,
    avatarUrl: row.avatarUrl,
    phoneNumber: row.phoneNumber,
    bio: row.bio,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
