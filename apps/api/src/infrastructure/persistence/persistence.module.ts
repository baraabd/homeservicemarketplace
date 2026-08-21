import { Global, Module } from '@nestjs/common';

import { AddressRepository } from './addresses/address.repository';
import { BidRepository } from './bids/bid.repository';
import { ProviderProfileRepository } from './bids/provider-profile.repository';
import { BookingEventRepository } from './bookings/booking-event.repository';
import { BookingRepository } from './bookings/booking.repository';
import { AdminAccessRequestRepository } from './iam/admin-access-request.repository';
import { AuditEventRepository } from './iam/audit-event.repository';
import { PermissionRepository } from './iam/permission.repository';
import { RoleRepository } from './iam/role.repository';
import { SessionRepository } from './iam/session.repository';
import { UserRepository } from './iam/user.repository';
import { VerificationTokenRepository } from './iam/verification-token.repository';
import { ConversationRepository } from './conversations/conversation.repository';
import { ConversationParticipantRepository } from './conversations/conversation-participant.repository';
import { MessageRepository } from './conversations/message.repository';
import { NotificationRepository } from './notifications/notification.repository';
import { UserProfileRepository } from './profiles/user-profile.repository';
import { ServiceRequestRepository } from './requests/service-request.repository';
import { ServiceRequestEventRepository } from './requests/service-request-event.repository';
import { ServiceCategoryRepository } from './services/service-category.repository';
import { ProviderCategoryApplicationRepository } from './services/provider-category-application.repository';
import { DisputeRepository } from './disputes/dispute.repository';
import { DisputeEventRepository } from './disputes/dispute-event.repository';
import { PlatformSettingRepository } from './settings/platform-setting.repository';

@Global()
@Module({
  providers: [
    UserRepository,
    RoleRepository,
    PermissionRepository,
    SessionRepository,
    VerificationTokenRepository,
    AuditEventRepository,
    AdminAccessRequestRepository,
    ServiceCategoryRepository,
    AddressRepository,
    ServiceRequestRepository,
    ServiceRequestEventRepository,
    ProviderProfileRepository,
    BidRepository,
    BookingRepository,
    BookingEventRepository,
    NotificationRepository,
    ConversationRepository,
    ConversationParticipantRepository,
    MessageRepository,
    UserProfileRepository,
    DisputeRepository,
    DisputeEventRepository,
    PlatformSettingRepository,
    ProviderCategoryApplicationRepository,
  ],
  exports: [
    UserRepository,
    RoleRepository,
    PermissionRepository,
    SessionRepository,
    VerificationTokenRepository,
    AuditEventRepository,
    AdminAccessRequestRepository,
    ServiceCategoryRepository,
    AddressRepository,
    ServiceRequestRepository,
    ServiceRequestEventRepository,
    ProviderProfileRepository,
    BidRepository,
    BookingRepository,
    BookingEventRepository,
    NotificationRepository,
    ConversationRepository,
    ConversationParticipantRepository,
    MessageRepository,
    UserProfileRepository,
    DisputeRepository,
    DisputeEventRepository,
    PlatformSettingRepository,
    ProviderCategoryApplicationRepository,
  ],
})
export class PersistenceModule {}
