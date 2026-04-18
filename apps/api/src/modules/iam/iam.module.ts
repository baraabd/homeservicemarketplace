import { Module } from '@nestjs/common';

import { AuditModule } from './audit/audit.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { AuthorizationModule } from './authorization/authorization.module';

@Module({
  imports: [AuditModule, AuthenticationModule, AuthorizationModule],
  exports: [AuditModule, AuthenticationModule, AuthorizationModule],
})
export class IamModule {}
