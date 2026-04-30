import { Injectable } from '@nestjs/common';
import type {
  GetProfileResponse,
  ProfileSummary,
  UpdateProfileRequest,
  UpdateProfileResponse,
} from '@homeservicemarketplace/contracts';
import type { User, UserProfile } from '@homeservicemarketplace/database';

import { UserRepository } from '../../infrastructure/persistence/iam/user.repository';
import { UserProfileRepository } from '../../infrastructure/persistence/profiles/user-profile.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';

@Injectable()
export class ProfileService {
  constructor(
    private readonly users: UserRepository,
    private readonly profiles: UserProfileRepository,
    private readonly tx: TransactionRunner,
  ) {}

  // ─── get ───────────────────────────────────────────────────────────────────
  async get(userId: string): Promise<GetProfileResponse> {
    const user = await this.users.findById(userId);
    if (!user) {
      // Should be unreachable — JwtAuthGuard already validated the
      // session — but defend against a concurrent soft-delete.
      throw new AppError('NOT_FOUND', 'User not found.', 404);
    }
    const profile = await this.profiles.findByUserId(userId);
    return { profile: toSummary(user, profile) };
  }

  // ─── update ────────────────────────────────────────────────────────────────
  // Inside one $transaction so a User name update + UserProfile upsert
  // either both succeed or both roll back. The DTO already filtered
  // out email / userId / role / status — this layer trusts the input
  // shape and only writes the documented fields.
  async update(userId: string, input: UpdateProfileRequest): Promise<UpdateProfileResponse> {
    const result = await this.tx.run(async (tx) => {
      const existing = await this.users.findById(userId, tx);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'User not found.', 404);
      }

      // Update auth-side fields on User (firstName / lastName) only
      // when the caller actually sent them.
      const userUpdate: { firstName?: string; lastName?: string } = {};
      if (input.firstName !== undefined) userUpdate.firstName = input.firstName;
      if (input.lastName !== undefined) userUpdate.lastName = input.lastName;
      const updatedUser = Object.keys(userUpdate).length
        ? await this.users.update(userId, userUpdate, tx)
        : existing;

      // Update profile-side fields on UserProfile (phone / city / bio).
      // The repository is responsible for the upsert semantics so a
      // user without an existing profile row gets one written on
      // first PATCH.
      const profileFieldsTouched =
        input.phoneNumber !== undefined || input.city !== undefined || input.bio !== undefined;
      const updatedProfile = profileFieldsTouched
        ? await this.profiles.upsertByUserId(
            {
              userId,
              phoneNumber: input.phoneNumber,
              city: input.city,
              bio: input.bio,
            },
            tx,
          )
        : await this.profiles.findByUserId(userId, tx);

      return { user: updatedUser, profile: updatedProfile };
    });

    return { profile: toSummary(result.user, result.profile) };
  }
}

// ─── DTO mapper ──────────────────────────────────────────────────────────────
function toSummary(user: User, profile: UserProfile | null): ProfileSummary {
  const firstName = user.firstName;
  const lastName = user.lastName;
  return {
    firstName,
    lastName,
    displayName: deriveDisplayName(firstName, lastName, user.email),
    initials: deriveInitials(firstName, lastName, user.email),
    email: user.email,
    phoneNumber: profile?.phoneNumber ?? null,
    city: profile?.city ?? null,
    bio: profile?.bio ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    // Prefer the profile updatedAt when present (the user most
    // recently edited the profile); otherwise fall back to the user
    // updatedAt so the wire never ships a missing timestamp.
    updatedAt: (profile?.updatedAt ?? user.updatedAt).toISOString(),
  };
}

// Match the frontend's deriveDisplayName / deriveInitials in
// apps/web/src/lib/use-auth-identity.ts so server-side and client-side
// strings stay identical.
function deriveDisplayName(first: string, last: string, email: string): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (f && l) return `${f} ${l}`;
  if (f) return f;
  if (l) return l;
  const local = (email ?? '').split('@')[0]?.trim();
  return local && local.length > 0 ? local : '';
}

function deriveInitials(first: string, last: string, email: string): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (f && l) return (f[0]! + l[0]!).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (l) return l.slice(0, 2).toUpperCase();
  const local = (email ?? '').split('@')[0]?.trim() ?? '';
  return local.slice(0, 2).toUpperCase();
}
