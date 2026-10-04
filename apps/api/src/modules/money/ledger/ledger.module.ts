import { Module } from '@nestjs/common';

import { LedgerRepository } from '../../../infrastructure/persistence/ledger/ledger.repository';
import { AuditModule } from '../../iam/audit/audit.module';
import { AuthorizationModule } from '../../iam/authorization/authorization.module';
import { LedgerService } from './ledger.service';

// R15 — the dark double-entry ledger. Deliberately no controller: nothing
// outside server code can post, reverse or read. Mounted so the application
// proves at boot that the posting authority resolves; no live feature calls it.
@Module({
  imports: [AuthorizationModule, AuditModule],
  providers: [LedgerRepository, LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
