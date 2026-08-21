import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../authentication/authentication.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AuditModule } from '../audit/audit.module';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessService } from './admin-access.service';

// Phase 4 — the admin ACCESS-REQUEST axis.
//
// The service is exported so the admin-side review controller
// (modules/admin/access-requests) can reuse it: one lifecycle implementation,
// one set of invariants (no self-review, one pending request, minimum-role
// grant), reachable from both sides.
//
// Repositories come from the global PersistenceModule.
@Module({
  imports: [AuthenticationModule, AuthorizationModule, AuditModule],
  controllers: [AdminAccessController],
  providers: [AdminAccessService],
  exports: [AdminAccessService],
})
export class AdminAccessModule {}
