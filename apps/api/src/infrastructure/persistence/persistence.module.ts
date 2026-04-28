import { Global, Module } from '@nestjs/common';

import { AddressRepository } from './addresses/address.repository';
import { BidRepository } from './bids/bid.repository';
import { ProviderProfileRepository } from './bids/provider-profile.repository';
import { AuditEventRepository } from './iam/audit-event.repository';
import { PermissionRepository } from './iam/permission.repository';
import { RoleRepository } from './iam/role.repository';
import { SessionRepository } from './iam/session.repository';
import { UserRepository } from './iam/user.repository';
import { VerificationTokenRepository } from './iam/verification-token.repository';
import { ServiceRequestRepository } from './requests/service-request.repository';
import { ServiceRequestEventRepository } from './requests/service-request-event.repository';
import { ServiceCategoryRepository } from './services/service-category.repository';

@Global()
@Module({
  providers: [
    UserRepository,
    RoleRepository,
    PermissionRepository,
    SessionRepository,
    VerificationTokenRepository,
    AuditEventRepository,
    ServiceCategoryRepository,
    AddressRepository,
    ServiceRequestRepository,
    ServiceRequestEventRepository,
    ProviderProfileRepository,
    BidRepository,
  ],
  exports: [
    UserRepository,
    RoleRepository,
    PermissionRepository,
    SessionRepository,
    VerificationTokenRepository,
    AuditEventRepository,
    ServiceCategoryRepository,
    AddressRepository,
    ServiceRequestRepository,
    ServiceRequestEventRepository,
    ProviderProfileRepository,
    BidRepository,
  ],
})
export class PersistenceModule {}
