import { Module } from '@nestjs/common';
import { AuditModule } from '../../iam/audit/audit.module';
import { AuthenticationModule } from '../../iam/authentication/authentication.module';
import { AuthorizationModule } from '../../iam/authorization/authorization.module';
import { MoneyModule } from '../money.module';
import { RefundRecoveryService } from '../recovery/refund-recovery.service';
import { RefundController } from './refund.controller';
import { RefundOrchestratorService } from './refund-orchestrator.service';

/** Composition only. The existing MoneyModule/ledger remain the authorities. */
@Module({
  imports: [MoneyModule, AuthenticationModule, AuthorizationModule, AuditModule],
  controllers: [RefundController],
  providers: [RefundOrchestratorService, RefundRecoveryService],
  exports: [RefundOrchestratorService, RefundRecoveryService],
})
export class RefundsModule {}
