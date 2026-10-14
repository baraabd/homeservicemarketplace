import { Module } from '@nestjs/common';

import { LedgerRepository } from '../../../infrastructure/persistence/ledger/ledger.repository';
import { AuditModule } from '../../iam/audit/audit.module';
import { AuthorizationModule } from '../../iam/authorization/authorization.module';
import { LedgerService } from './ledger.service';
import { SubscriptionActivationService } from '../domain/subscription-activation.service';

// R15 — the dark double-entry ledger. Deliberately no controller: nothing
// outside server code can post, reverse or read. Mounted so the application
// proves at boot that the posting authority resolves; no live feature calls it.
@Module({
  imports: [AuthorizationModule, AuditModule],
  // R19 — the confirmation/activation boundary composes the ledger in one
  // transaction. Provided for resolution at boot; nothing calls it yet.
  providers: [LedgerRepository, LedgerService, SubscriptionActivationService],
  exports: [LedgerService, SubscriptionActivationService],
})
export class LedgerModule {}
