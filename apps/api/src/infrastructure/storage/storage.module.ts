import { Module } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { ConfigModule } from '../../config/config.module';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import { LocalDiskRestrictedStorageAdapter } from './local-disk-restricted-storage.adapter';
import { STORAGE_PORT, StoragePort } from './storage.port';
import {
  RESTRICTED_OBJECT_STORAGE,
  RestrictedObjectStoragePort,
} from './restricted-object-storage.port';

export async function selectPublicStorage(
  config: AppConfigService,
  local: LocalDiskStorageAdapter,
): Promise<StoragePort> {
  if (config.get('STORAGE_DRIVER') !== 's3') return local;
  const { S3StorageAdapter } = await import('./s3-storage.adapter');
  return new S3StorageAdapter(config);
}

export async function selectRestrictedStorage(
  config: AppConfigService,
  local: LocalDiskRestrictedStorageAdapter,
): Promise<RestrictedObjectStoragePort> {
  if (config.get('STORAGE_DRIVER') !== 's3') return local;
  const { S3RestrictedStorageAdapter } = await import('./s3-restricted-storage.adapter');
  return new S3RestrictedStorageAdapter(config);
}

// Env-gated storage adapter selection. Mirrors the MailModule pattern
// in apps/api/src/infrastructure/mail/mail.module.ts — the same
// `StoragePort` token is bound to either backend depending on
// STORAGE_DRIVER, so the rest of the codebase imports `StoragePort`
// and never knows which concrete implementation it has.
//
// S3 adapters are loaded lazily only when STORAGE_DRIVER=s3. This is
// deliberate: importing the AWS SDK adds a large CommonJS module graph and
// used to slow every LOCAL development boot even though local storage was
// selected. Local development must not pay the S3 startup cost.
//
// ── Sprint 9B.3 — the RESTRICTED boundary ───────────────────────────────
//
// A second, narrower port for identity evidence, selected by the SAME
// STORAGE_DRIVER so an operator cannot end up with public media in S3 and
// passports on a container's ephemeral disk.
//
// It is deliberately a separate token rather than more methods on StoragePort:
// StoragePort's whole shape is browser-direct URLs, and restricted evidence
// must never produce a URL of any kind. Keeping them apart means a public
// controller cannot reach a restricted read by autocomplete.
//
// LocalDiskStorageAdapter remains exported for the PUBLIC media controller's
// upload-acceptance step only. Restricted code must depend on
// RESTRICTED_OBJECT_STORAGE — a rule an architecture test enforces, because
// Sprint 9A's evidence read controller took the direct dependency and was
// therefore broken under STORAGE_DRIVER=s3.
@Module({
  imports: [ConfigModule],
  providers: [
    LocalDiskStorageAdapter,
    LocalDiskRestrictedStorageAdapter,
    {
      provide: STORAGE_PORT,
      inject: [AppConfigService, LocalDiskStorageAdapter],
      useFactory: selectPublicStorage,
    },
    {
      provide: RESTRICTED_OBJECT_STORAGE,
      inject: [AppConfigService, LocalDiskRestrictedStorageAdapter],
      useFactory: selectRestrictedStorage,
    },
  ],
  // Export both the port AND the local adapter so the MediaController
  // can perform the disk write on PUT /v1/media/uploads/:key. The
  // controller depends on the port for the presign step (vendor-
  // agnostic) and on the local adapter for the upload-acceptance step
  // (only meaningful for the local backend; S3 PUTs hit S3 directly).
  exports: [STORAGE_PORT, LocalDiskStorageAdapter, RESTRICTED_OBJECT_STORAGE],
})
export class StorageModule {}
