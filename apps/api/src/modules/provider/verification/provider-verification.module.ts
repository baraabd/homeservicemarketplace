import { Module } from '@nestjs/common';

import { StorageModule } from '../../../infrastructure/storage/storage.module';
import { AuthorizationModule } from '../../iam/authorization/authorization.module';
import { EvidenceReadController } from './media/evidence-read.controller';
import { EvidenceReadService } from './media/evidence-read.service';

// Sprint 9B — restricted provider identity evidence.
//
// docs/adr/0009-restricted-identity-media.md
//
// Deliberately its own module rather than a folder inside ProviderModule or
// MediaModule:
//
//   NOT MediaModule — that module owns the PUBLIC request-media pipeline,
//   whose GET is @Public() and cached `public, immutable`. Restricted evidence
//   sharing a module with it is an invitation to share a route, a guard, or a
//   storage root next. The two are kept apart at the module boundary so the
//   separation is structural rather than a naming convention.
//
//   NOT ProviderModule — importing it would drag the whole provider domain
//   (bids, bookings, wallet) behind a route that only needs storage and
//   permissions, and ProviderModule already carries enough.
//
// Dependencies, and why each is the minimum:
//
//   AuthorizationModule  exports PermissionResolverService, used to resolve
//                        `verification:evidence:view` PER REQUEST. Never
//                        cached across requests — a reviewer whose permission
//                        was revoked a second ago must not still open a
//                        document, the same reasoning that forbids caching a
//                        capability set (ADR 0006).
//
//   StorageModule        exports LocalDiskStorageAdapter, used to resolve a
//                        server-held storage key to a path for streaming. The
//                        key never reaches the client.
//
// PrismaModule is global, so the service's reads and its audit writes need no
// import here.
//
// Nothing is exported. This module owns a route and its service; another
// module wanting to read evidence would be a second read path, and one audited
// read path is the whole point.
@Module({
  imports: [AuthorizationModule, StorageModule],
  controllers: [EvidenceReadController],
  providers: [EvidenceReadService],
})
export class ProviderVerificationModule {}
