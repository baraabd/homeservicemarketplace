import { Module } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { ConfigModule } from '../../config/config.module';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { STORAGE_PORT, StoragePort } from './storage.port';

// Env-gated storage adapter selection. Mirrors the MailModule pattern
// in apps/api/src/infrastructure/mail/mail.module.ts — the same
// `StoragePort` token is bound to either backend depending on
// STORAGE_DRIVER, so the rest of the codebase imports `StoragePort`
// and never knows which concrete implementation it has.
//
// Both adapter classes are listed in `providers` so DI can construct
// either one; `useFactory` picks the right instance at module-init
// time. Listing both also means a future hot-swap (e.g. failover)
// would be a config change, not a wiring change.
@Module({
  imports: [ConfigModule],
  providers: [
    LocalDiskStorageAdapter,
    S3StorageAdapter,
    {
      provide: STORAGE_PORT,
      inject: [AppConfigService, LocalDiskStorageAdapter, S3StorageAdapter],
      useFactory: (
        config: AppConfigService,
        local: LocalDiskStorageAdapter,
        s3: S3StorageAdapter,
      ): StoragePort => {
        const driver = config.get('STORAGE_DRIVER');
        return driver === 's3' ? s3 : local;
      },
    },
  ],
  // Export both the port AND the local adapter so the MediaController
  // can perform the disk write on PUT /v1/media/uploads/:key. The
  // controller depends on the port for the presign step (vendor-
  // agnostic) and on the local adapter for the upload-acceptance step
  // (only meaningful for the local backend; S3 PUTs hit S3 directly).
  exports: [STORAGE_PORT, LocalDiskStorageAdapter],
})
export class StorageModule {}
