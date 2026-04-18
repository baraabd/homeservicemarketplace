import { Module } from '@nestjs/common';

import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';
import { PermissionResolverService } from './services/permission-resolver.service';

@Module({
  providers: [PermissionResolverService, RolesGuard, PermissionsGuard],
  exports: [PermissionResolverService, RolesGuard, PermissionsGuard],
})
export class AuthorizationModule {}
