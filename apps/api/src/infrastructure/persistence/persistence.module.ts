import { Global, Module } from '@nestjs/common';

import { PermissionRepository } from './iam/permission.repository';
import { RoleRepository } from './iam/role.repository';
import { UserRepository } from './iam/user.repository';

@Global()
@Module({
  providers: [UserRepository, RoleRepository, PermissionRepository],
  exports: [UserRepository, RoleRepository, PermissionRepository],
})
export class PersistenceModule {}
