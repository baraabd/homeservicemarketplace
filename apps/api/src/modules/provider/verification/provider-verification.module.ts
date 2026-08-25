import { Module } from '@nestjs/common';

import { StorageModule } from '../../../infrastructure/storage/storage.module';
import { AuthorizationModule } from '../../iam/authorization/authorization.module';
import { AuditModule } from '../../iam/audit/audit.module';
import { ProviderVerificationCaseController } from './case/provider-verification-case.controller';
import { ProviderVerificationCaseService } from './case/provider-verification-case.service';
import { EvidenceReadController } from './media/evidence-read.controller';
import { EvidenceUploadController } from './media/evidence-upload.controller';
import { EvidenceCleanupService } from './media/evidence-cleanup.service';
import { EvidenceUploadService } from './media/evidence-upload.service';
import { VerificationSettingsService } from './verification-settings.service';
import { EvidenceReadService } from './media/evidence-read.service';
import { EvidenceScanService } from './media/evidence-scan.service';
import { VerificationCaseWorkflowService } from './case/verification-case-workflow.service';
import { VerificationCaseEventsHandler } from './case/verification-case-events.handler';
import { EvidenceScannedHandler } from './media/evidence-scanned.handler';
import { ClamAvMalwareScanner } from './media/clamav-scanner.adapter';
import { resolveScannerSelection } from './media/scanner-selection';
import {
  MALWARE_SCANNER_PORT,
  MalwareScannerPort,
  UnconfiguredMalwareScanner,
  DeterministicTestScanner,
} from './media/malware-scanner.port';
import { AppConfigService } from '../../../config/app-config.service';
import { Logger } from '@nestjs/common';

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
  // Sprint 9B.2 adds AuditModule: case creation and resume are audited in the
  // same transaction as the write. PersistenceModule is @Global, so the
  // settings repository needs no import.
  imports: [AuthorizationModule, StorageModule, AuditModule],
  controllers: [
    EvidenceReadController,
    EvidenceUploadController,
    ProviderVerificationCaseController,
  ],
  exports: [
    EvidenceCleanupService,
    EvidenceScanService,
    EvidenceScannedHandler,
    // Sprint 9B.5 — the only class allowed to act on the case transition table.
    VerificationCaseWorkflowService,
    VerificationCaseEventsHandler,
  ],
  providers: [
    EvidenceReadService,
    EvidenceUploadService,
    // No controller. A route that deletes evidence in bulk is a weapon; the
    // sweep is invoked by an operator process or scheduler, and its batch
    // bound is what keeps one invocation from becoming an outage.
    EvidenceCleanupService,
    ProviderVerificationCaseService,
    // Reads the evidence limits through the canonical PlatformSettingRepository.
    VerificationSettingsService,
    // Sprint 9B.4. No controller either, for the same reason as the cleanup
    // sweep: a route that scans on demand is a route that can be aimed.
    EvidenceScanService,
    EvidenceScannedHandler,
    // Sprint 9B.5 — the only class allowed to act on the case transition table.
    // Exported so the admin case-commands controller can drive the same
    // implementation the provider side uses; two copies of a transition is how
    // D-3 happened.
    VerificationCaseWorkflowService,
    VerificationCaseEventsHandler,
    {
      // The one binding that decides whether evidence can ever be cleared.
      //
      // resolveScannerSelection THROWS if a process that believes it is
      // production asks for the deterministic test scanner — the one adapter
      // capable of writing CLEAN without scanning anything. A boot failure is
      // the correct outcome: the alternative is an API that looks healthy while
      // trusting every file it is given.
      provide: MALWARE_SCANNER_PORT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): MalwareScannerPort => {
        const selection = resolveScannerSelection({
          driver: config.get('EVIDENCE_SCANNER_DRIVER') as string | undefined,
          isProduction: config.isProduction,
        });

        if (selection.warn) {
          new Logger('MalwareScanner').warn(
            'No malware scanner configured: restricted evidence will be stored ' +
              'but can never be cleared for review.',
          );
        }

        switch (selection.kind) {
          case 'clamav':
            return new ClamAvMalwareScanner(config);
          case 'test':
            return new DeterministicTestScanner();
          case 'none':
            return new UnconfiguredMalwareScanner();
        }
      },
    },
  ],
})
export class ProviderVerificationModule {}
