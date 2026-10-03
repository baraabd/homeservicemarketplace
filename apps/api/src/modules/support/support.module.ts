import { Module } from '@nestjs/common';

import { SupportRepository } from '../../infrastructure/persistence/support/support.repository';
import { AuditModule } from '../iam/audit/audit.module';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { AdminSupportController, SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [AuthenticationModule, AuthorizationModule, AuditModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportRepository, SupportService],
})
export class SupportModule {}
