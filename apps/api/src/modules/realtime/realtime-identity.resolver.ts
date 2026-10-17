import { Injectable } from '@nestjs/common';
import type { ProviderProfileStatus } from '@homeservicemarketplace/database';
import { ProviderCapability } from '@homeservicemarketplace/contracts';

import { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import { UserRepository } from '../../infrastructure/persistence/iam/user.repository';
import { RoleRepository } from '../../infrastructure/persistence/iam/role.repository';
import { ProviderCapabilityService } from '../provider/capability/provider-capability.service';

// Current authorization facts come from the same durable roles, permissions
// and provider capabilities used by REST. Resolve at handshake, sensitive
// subscription/delivery and periodic recheck; caching token claims or grants
// here would keep revoked access alive after a missed security notification.

export interface RealtimeIdentity {
  roles: string[];
  permissions: string[];
  providerProfileId: string | null;
  providerStatus: ProviderProfileStatus | null;
  mayViewMarketplace: boolean;
}

@Injectable()
export class RealtimeIdentityResolver {
  constructor(
    private readonly users: UserRepository,
    private readonly providerProfiles: ProviderProfileRepository,
    private readonly roleRepository: RoleRepository,
    private readonly capabilities: ProviderCapabilityService,
  ) {}

  async resolve(userId: string): Promise<RealtimeIdentity> {
    const [roleRows, profile, permissions, mayViewMarketplace] = await Promise.all([
      this.users.listRoles(userId),
      this.providerProfiles.findByUserId(userId),
      this.roleRepository.listPermissionKeysForUser(userId),
      this.capabilities.can(userId, ProviderCapability.ViewMarketplace),
    ]);

    const roles = roleRows.filter((r) => r.role.deletedAt === null).map((r) => r.role.name);
    return {
      roles,
      permissions,
      providerProfileId: profile?.id ?? null,
      providerStatus: profile?.status ?? null,
      mayViewMarketplace: roles.includes('provider') && mayViewMarketplace,
    };
  }
}

// Legacy security-bus status eviction signal. Admission and every protected
// delivery additionally use current provider capabilities and role above.
export function providerMayJoinMarketplaceRooms(
  status: ProviderProfileStatus | null,
): status is 'ACTIVE' {
  return status === 'ACTIVE';
}

// Admin room membership is decided by the CURRENT role assignment, never by
// the token's `roles` claim.
export function hasAdminAccess(roles: readonly string[], permissions: readonly string[]): boolean {
  // The admin provider review reads require BOTH current role and this grant.
  // Removing a permission must take effect even if the role name survives.
  return roles.includes('admin') && permissions.includes('user:read:any');
}
