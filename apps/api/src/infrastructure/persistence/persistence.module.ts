import { Global, Module } from '@nestjs/common';

import { AuditEventRepository } from './iam/audit-event.repository';
import { PermissionRepository } from './iam/permission.repository';
import { RoleRepository } from './iam/role.repository';
import { SessionRepository } from './iam/session.repository';
import { UserRepository } from './iam/user.repository';
import { VerificationTokenRepository } from './iam/verification-token.repository';
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
  ],
  exports: [
    UserRepository,
    RoleRepository,
    PermissionRepository,
    SessionRepository,
    VerificationTokenRepository,
    AuditEventRepository,
    ServiceCategoryRepository,
  ],
})
export class PersistenceModule {}
