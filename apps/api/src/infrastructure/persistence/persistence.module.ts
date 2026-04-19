import { Global, Module } from '@nestjs/common';

import { AuditEventRepository } from './iam/audit-event.repository';
import { PermissionRepository } from './iam/permission.repository';
import { RoleRepository } from './iam/role.repository';
import { SessionRepository } from './iam/session.repository';
import { UserRepository } from './iam/user.repository';
import { VerificationTokenRepository } from './iam/verification-token.repository';
import { AddressRepository } from './user/address.repository';
import { UserProfileRepository } from './user/user-profile.repository';

@Global()
@Module({
  providers: [
    UserRepository,
    RoleRepository,
    PermissionRepository,
    SessionRepository,
    VerificationTokenRepository,
    AuditEventRepository,
    UserProfileRepository,
    AddressRepository,
  ],
  exports: [
    UserRepository,
    RoleRepository,
    PermissionRepository,
    SessionRepository,
    VerificationTokenRepository,
    AuditEventRepository,
    UserProfileRepository,
    AddressRepository,
  ],
})
export class PersistenceModule {}
