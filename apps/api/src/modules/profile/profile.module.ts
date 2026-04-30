import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

// Profile module (cross-sprint stabilization). Repositories
// (UserRepository, UserProfileRepository) are provided globally by
// PersistenceModule; TransactionRunner by PrismaModule.
// AuthenticationModule supplies the JwtAuthGuard / CsrfGuard guards.
@Module({
  imports: [AuthenticationModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
