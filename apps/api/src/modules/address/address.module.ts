import { Module } from '@nestjs/common';

// TransactionRunner and repositories are provided by the global
// PrismaModule / PersistenceModule respectively. JwtAuthGuard is exported
// by AuthenticationModule.
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AddressController } from './controllers/address.controller';
import { AddressService } from './services/address.service';

@Module({
  imports: [AuthenticationModule],
  controllers: [AddressController],
  providers: [AddressService],
  exports: [AddressService],
})
export class AddressModule {}
