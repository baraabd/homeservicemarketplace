import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { PublicMediaLedgerModule } from './public-media-ledger.module';
import { MediaController } from './media.controller';
import { PublicMediaCleanupService } from './public-media-cleanup.service';
import { PublicMediaCleanupJob } from './public-media-cleanup.job';

// MediaController depends on JwtAuthGuard / CsrfGuard from
// AuthenticationModule (presigned-url endpoint is auth-gated) and on
// the StoragePort + LocalDiskStorageAdapter from StorageModule.
//
// Sprint 09B.29 Phase 4 — the public-media cleanup sweep lives here because
// this is the module that MINTS the objects. The reservation is created at
// presign, in this controller; the sweep that retires an object nobody claimed
// belongs beside it rather than in whichever feature happened to attach it.
//
// `PublicMediaCleanupJob` is registered unconditionally and decides for itself
// whether to schedule, for the same reason `VerificationExpiryJob` is: the
// wiring must not depend on config read order at module-construction time.
// PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED (default false) is what arms it.
@Module({
  imports: [AuthenticationModule, StorageModule, PrismaModule, PublicMediaLedgerModule],
  controllers: [MediaController],
  providers: [PublicMediaCleanupService, PublicMediaCleanupJob],
  exports: [PublicMediaCleanupService],
})
export class MediaModule {}
