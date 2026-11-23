import { Module } from '@nestjs/common';
import { StorageModule } from '../../../infrastructure/storage/storage.module';
import { AuditModule } from '../../iam/audit/audit.module';
import { AuthorizationModule } from '../../iam/authorization/authorization.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ProviderVerificationModule } from '../../provider/verification/provider-verification.module';
import { ManualRailConfiguration } from '../adapters/manual/manual-rail.config';
import { ManualCollectionAdapter } from '../adapters/manual/manual-collection.adapter';
import { ManualRefundAdapter } from '../adapters/manual/manual-refund.adapter';
import { ManualReviewService } from './manual-review.service';
import { ReceiptUploadService } from './receipt-upload.service';
import { ReceiptReadService } from './receipt-read.service';
import { ReceiptAcceptanceParticipant } from './receipt-acceptance.participant';
import { ManualRefundReviewService } from './manual-refund-review.service';

const SERVICES = [
  ManualRailConfiguration,
  ManualCollectionAdapter,
  ManualRefundAdapter,
  ManualReviewService,
  ReceiptUploadService,
  ReceiptReadService,
  ReceiptAcceptanceParticipant,
  ManualRefundReviewService,
];

/** Reuse the configured restricted transport/scanner and durable notices.
 * The scanner module exports only its existing capability; financial receipts
 * have no verification case and are excluded from identity workers. */
@Module({
  imports: [
    StorageModule,
    AuditModule,
    AuthorizationModule,
    NotificationsModule,
    ProviderVerificationModule,
  ],
  providers: SERVICES,
  exports: SERVICES,
})
export class ManualReviewModule {}
