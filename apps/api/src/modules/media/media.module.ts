import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { MediaController } from './media.controller';

// MediaController depends on JwtAuthGuard / CsrfGuard from
// AuthenticationModule (presigned-url endpoint is auth-gated) and on
// the StoragePort + LocalDiskStorageAdapter from StorageModule.
@Module({
  imports: [AuthenticationModule, StorageModule],
  controllers: [MediaController],
})
export class MediaModule {}
