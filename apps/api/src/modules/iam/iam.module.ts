import { Module } from '@nestjs/common';

import { AdminAccessModule } from './admin-access/admin-access.module';
import { AuditModule } from './audit/audit.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { AuthorizationModule } from './authorization/authorization.module';

@Module({
  imports: [AuditModule, AuthenticationModule, AuthorizationModule, AdminAccessModule],
  exports: [AuditModule, AuthenticationModule, AuthorizationModule, AdminAccessModule],
})
export class IamModule {}
