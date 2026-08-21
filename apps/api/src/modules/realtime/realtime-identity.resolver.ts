import { Injectable } from '@nestjs/common';
import type { ProviderProfileStatus } from '@homeservicemarketplace/database';

import { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import { UserRepository } from '../../infrastructure/persistence/iam/user.repository';

// D-4 — CURRENT authorization facts for a socket, read from the database.
//
// The gateway used to derive room membership from the JWT `roles` claim and
// from the mere existence of a provider profile:
//
//   - `roles.includes('admin')` joined the `admin` room. A token minted before
//     an admin role was revoked kept its holder in the admin broadcast room
//     for the rest of the token's life, because nothing re-read the roles.
//   - any user with a ProviderProfile row joined `provider:{id}`, regardless of
//     whether that profile was DRAFT, PENDING_REVIEW, SUSPENDED, or REJECTED.
//     REST refused those users at ProviderActiveGuard; the socket did not, so
//     the marketplace fan-out reached providers who could not legally act on it.
//
// Both are fixed by resolving roles and provider status here, from the same
// rows REST authorizes against, at handshake time.
//
// The lookup is deliberately NOT cached: a handshake happens once per
// connection (not per message), so this is a cold-path cost, and caching it
// would reintroduce exactly the staleness that made the JWT claim wrong.

export interface RealtimeIdentity {
  roles: string[];
  providerProfileId: string | null;
  providerStatus: ProviderProfileStatus | null;
}

@Injectable()
export class RealtimeIdentityResolver {
  constructor(
    private readonly users: UserRepository,
    private readonly providerProfiles: ProviderProfileRepository,
  ) {}

  async resolve(userId: string): Promise<RealtimeIdentity> {
    const [roleRows, profile] = await Promise.all([
      this.users.listRoles(userId),
      this.providerProfiles.findByUserId(userId),
    ]);

    return {
      roles: roleRows.map((r) => r.role.name),
      providerProfileId: profile?.id ?? null,
      providerStatus: profile?.status ?? null,
    };
  }
}

// The ONLY provider-profile status that may join marketplace rooms. DRAFT and
// PENDING_REVIEW have not been approved; SUSPENDED and REJECTED have had
// approval withdrawn or refused. This mirrors ProviderActiveGuard exactly so
// REST and realtime cannot disagree about who is a live provider.
export function providerMayJoinMarketplaceRooms(
  status: ProviderProfileStatus | null,
): status is 'ACTIVE' {
  return status === 'ACTIVE';
}

// Admin room membership is decided by the CURRENT role assignment, never by
// the token's `roles` claim.
export function hasAdminAccess(roles: readonly string[]): boolean {
  return roles.includes('admin');
}
