-- CreateEnum
CREATE TYPE "ProviderAvailability" AS ENUM ('ONLINE', 'OFFLINE', 'PAUSED');

-- AlterTable
ALTER TABLE "Address" RENAME CONSTRAINT "addresses_pkey" TO "Address_pkey";

-- AlterTable
ALTER TABLE "AuditEvent" RENAME CONSTRAINT "audit_events_pkey" TO "AuditEvent_pkey";

-- AlterTable
ALTER TABLE "Bid" RENAME CONSTRAINT "bids_pkey" TO "Bid_pkey";

-- AlterTable
ALTER TABLE "Booking" RENAME CONSTRAINT "bookings_pkey" TO "Booking_pkey";

-- AlterTable
ALTER TABLE "BookingEvent" RENAME CONSTRAINT "booking_events_pkey" TO "BookingEvent_pkey";

-- AlterTable
ALTER TABLE "Conversation" RENAME CONSTRAINT "conversations_pkey" TO "Conversation_pkey";

-- AlterTable
ALTER TABLE "ConversationParticipant" RENAME CONSTRAINT "conversation_participants_pkey" TO "ConversationParticipant_pkey";

-- AlterTable
ALTER TABLE "Message" RENAME CONSTRAINT "messages_pkey" TO "Message_pkey";

-- AlterTable
ALTER TABLE "MfaBackupCode" RENAME CONSTRAINT "mfa_backup_codes_pkey" TO "MfaBackupCode_pkey";

-- AlterTable
ALTER TABLE "Notification" RENAME CONSTRAINT "notifications_pkey" TO "Notification_pkey";

-- AlterTable
ALTER TABLE "OauthAccount" RENAME CONSTRAINT "oauth_accounts_pkey" TO "OauthAccount_pkey";

-- AlterTable
ALTER TABLE "Permission" RENAME CONSTRAINT "permissions_pkey" TO "Permission_pkey";

-- AlterTable
ALTER TABLE "ProviderProfile" RENAME CONSTRAINT "provider_profiles_pkey" TO "ProviderProfile_pkey";

-- AlterTable
ALTER TABLE "ProviderProfile"
ADD COLUMN     "availability" "ProviderAvailability" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "headline" TEXT,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "serviceAreaCity" TEXT,
ADD COLUMN     "serviceAreaCountry" TEXT,
ADD COLUMN     "serviceAreaLat" DOUBLE PRECISION,
ADD COLUMN     "serviceAreaLng" DOUBLE PRECISION,
ADD COLUMN     "serviceAreaRadiusKm" INTEGER;

-- AlterTable
ALTER TABLE "Role" RENAME CONSTRAINT "roles_pkey" TO "Role_pkey";

-- AlterTable
ALTER TABLE "RolePermission" RENAME CONSTRAINT "role_permissions_pkey" TO "RolePermission_pkey";

-- AlterTable
ALTER TABLE "ServiceCategory" RENAME CONSTRAINT "service_categories_pkey" TO "ServiceCategory_pkey";

-- AlterTable
ALTER TABLE "ServiceRequest" RENAME CONSTRAINT "service_requests_pkey" TO "ServiceRequest_pkey";

-- AlterTable
ALTER TABLE "ServiceRequestEvent" RENAME CONSTRAINT "service_request_events_pkey" TO "ServiceRequestEvent_pkey";

-- AlterTable
ALTER TABLE "Session" RENAME CONSTRAINT "sessions_pkey" TO "Session_pkey";

-- AlterTable
ALTER TABLE "User" RENAME CONSTRAINT "users_pkey" TO "User_pkey";

-- AlterTable
ALTER TABLE "UserProfile" RENAME CONSTRAINT "user_profiles_pkey" TO "UserProfile_pkey";

-- AlterTable
ALTER TABLE "UserRole" RENAME CONSTRAINT "user_roles_pkey" TO "UserRole_pkey";

-- AlterTable
ALTER TABLE "VerificationToken" RENAME CONSTRAINT "verification_tokens_pkey" TO "VerificationToken_pkey";

-- CreateTable
CREATE TABLE "ProviderProfileServiceCategory" (
    "providerProfileId" TEXT NOT NULL,
    "serviceCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderProfileServiceCategory_pkey" PRIMARY KEY ("providerProfileId","serviceCategoryId")
);

-- CreateIndex
CREATE INDEX "ProviderProfileServiceCategory_serviceCategoryId_idx" ON "ProviderProfileServiceCategory"("serviceCategoryId");

-- CreateIndex
CREATE INDEX "ProviderProfile_availability_idx" ON "ProviderProfile"("availability");

-- CreateIndex
CREATE INDEX "ProviderProfile_serviceAreaCity_idx" ON "ProviderProfile"("serviceAreaCity");

-- RenameForeignKey
ALTER TABLE "Address" RENAME CONSTRAINT "addresses_userId_fkey" TO "Address_userId_fkey";

-- RenameForeignKey
ALTER TABLE "AuditEvent" RENAME CONSTRAINT "audit_events_userId_fkey" TO "AuditEvent_userId_fkey";

-- RenameForeignKey
ALTER TABLE "Bid" RENAME CONSTRAINT "bids_providerId_fkey" TO "Bid_providerId_fkey";

-- RenameForeignKey
ALTER TABLE "Bid" RENAME CONSTRAINT "bids_requestId_fkey" TO "Bid_requestId_fkey";

-- RenameForeignKey
ALTER TABLE "Booking" RENAME CONSTRAINT "bookings_bidId_fkey" TO "Booking_bidId_fkey";

-- RenameForeignKey
ALTER TABLE "Booking" RENAME CONSTRAINT "bookings_providerId_fkey" TO "Booking_providerId_fkey";

-- RenameForeignKey
ALTER TABLE "Booking" RENAME CONSTRAINT "bookings_requestId_fkey" TO "Booking_requestId_fkey";

-- RenameForeignKey
ALTER TABLE "Booking" RENAME CONSTRAINT "bookings_seekerUserId_fkey" TO "Booking_seekerUserId_fkey";

-- RenameForeignKey
ALTER TABLE "BookingEvent" RENAME CONSTRAINT "booking_events_actorUserId_fkey" TO "BookingEvent_actorUserId_fkey";

-- RenameForeignKey
ALTER TABLE "BookingEvent" RENAME CONSTRAINT "booking_events_bookingId_fkey" TO "BookingEvent_bookingId_fkey";

-- RenameForeignKey
ALTER TABLE "Conversation" RENAME CONSTRAINT "conversations_bookingId_fkey" TO "Conversation_bookingId_fkey";

-- RenameForeignKey
ALTER TABLE "Conversation" RENAME CONSTRAINT "conversations_requestId_fkey" TO "Conversation_requestId_fkey";

-- RenameForeignKey
ALTER TABLE "ConversationParticipant" RENAME CONSTRAINT "conversation_participants_conversationId_fkey" TO "ConversationParticipant_conversationId_fkey";

-- RenameForeignKey
ALTER TABLE "ConversationParticipant" RENAME CONSTRAINT "conversation_participants_providerProfileId_fkey" TO "ConversationParticipant_providerProfileId_fkey";

-- RenameForeignKey
ALTER TABLE "ConversationParticipant" RENAME CONSTRAINT "conversation_participants_userId_fkey" TO "ConversationParticipant_userId_fkey";

-- RenameForeignKey
ALTER TABLE "Message" RENAME CONSTRAINT "messages_conversationId_fkey" TO "Message_conversationId_fkey";

-- RenameForeignKey
ALTER TABLE "Message" RENAME CONSTRAINT "messages_senderUserId_fkey" TO "Message_senderUserId_fkey";

-- RenameForeignKey
ALTER TABLE "MfaBackupCode" RENAME CONSTRAINT "mfa_backup_codes_userId_fkey" TO "MfaBackupCode_userId_fkey";

-- RenameForeignKey
ALTER TABLE "Notification" RENAME CONSTRAINT "notifications_userId_fkey" TO "Notification_userId_fkey";

-- RenameForeignKey
ALTER TABLE "OauthAccount" RENAME CONSTRAINT "oauth_accounts_userId_fkey" TO "OauthAccount_userId_fkey";

-- RenameForeignKey
ALTER TABLE "ProviderProfile" RENAME CONSTRAINT "provider_profiles_userId_fkey" TO "ProviderProfile_userId_fkey";

-- RenameForeignKey
ALTER TABLE "RolePermission" RENAME CONSTRAINT "role_permissions_permissionId_fkey" TO "RolePermission_permissionId_fkey";

-- RenameForeignKey
ALTER TABLE "RolePermission" RENAME CONSTRAINT "role_permissions_roleId_fkey" TO "RolePermission_roleId_fkey";

-- RenameForeignKey
ALTER TABLE "ServiceRequest" RENAME CONSTRAINT "service_requests_addressId_fkey" TO "ServiceRequest_addressId_fkey";

-- RenameForeignKey
ALTER TABLE "ServiceRequest" RENAME CONSTRAINT "service_requests_categoryId_fkey" TO "ServiceRequest_categoryId_fkey";

-- RenameForeignKey
ALTER TABLE "ServiceRequest" RENAME CONSTRAINT "service_requests_seekerUserId_fkey" TO "ServiceRequest_seekerUserId_fkey";

-- RenameForeignKey
ALTER TABLE "ServiceRequestEvent" RENAME CONSTRAINT "service_request_events_actorUserId_fkey" TO "ServiceRequestEvent_actorUserId_fkey";

-- RenameForeignKey
ALTER TABLE "ServiceRequestEvent" RENAME CONSTRAINT "service_request_events_requestId_fkey" TO "ServiceRequestEvent_requestId_fkey";

-- RenameForeignKey
ALTER TABLE "Session" RENAME CONSTRAINT "sessions_userId_fkey" TO "Session_userId_fkey";

-- RenameForeignKey
ALTER TABLE "UserProfile" RENAME CONSTRAINT "user_profiles_userId_fkey" TO "UserProfile_userId_fkey";

-- RenameForeignKey
ALTER TABLE "UserRole" RENAME CONSTRAINT "user_roles_roleId_fkey" TO "UserRole_roleId_fkey";

-- RenameForeignKey
ALTER TABLE "UserRole" RENAME CONSTRAINT "user_roles_userId_fkey" TO "UserRole_userId_fkey";

-- RenameForeignKey
ALTER TABLE "VerificationToken" RENAME CONSTRAINT "verification_tokens_userId_fkey" TO "VerificationToken_userId_fkey";

-- AddForeignKey
ALTER TABLE "ProviderProfileServiceCategory" ADD CONSTRAINT "ProviderProfileServiceCategory_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfileServiceCategory" ADD CONSTRAINT "ProviderProfileServiceCategory_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "addresses_deletedAt_idx" RENAME TO "Address_deletedAt_idx";

-- RenameIndex
ALTER INDEX "addresses_userId_deletedAt_idx" RENAME TO "Address_userId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "addresses_userId_isDefault_idx" RENAME TO "Address_userId_isDefault_idx";

-- RenameIndex
ALTER INDEX "audit_events_type_createdAt_idx" RENAME TO "AuditEvent_type_createdAt_idx";

-- RenameIndex
ALTER INDEX "audit_events_userId_createdAt_idx" RENAME TO "AuditEvent_userId_createdAt_idx";

-- RenameIndex
ALTER INDEX "bids_deletedAt_idx" RENAME TO "Bid_deletedAt_idx";

-- RenameIndex
ALTER INDEX "bids_providerId_status_idx" RENAME TO "Bid_providerId_status_idx";

-- RenameIndex
ALTER INDEX "bids_requestId_providerId_idx" RENAME TO "Bid_requestId_providerId_idx";

-- RenameIndex
ALTER INDEX "bids_requestId_status_idx" RENAME TO "Bid_requestId_status_idx";

-- RenameIndex
ALTER INDEX "bids_submittedAt_idx" RENAME TO "Bid_submittedAt_idx";

-- RenameIndex
ALTER INDEX "bookings_bidId_key" RENAME TO "Booking_bidId_key";

-- RenameIndex
ALTER INDEX "bookings_deletedAt_idx" RENAME TO "Booking_deletedAt_idx";

-- RenameIndex
ALTER INDEX "bookings_providerId_status_idx" RENAME TO "Booking_providerId_status_idx";

-- RenameIndex
ALTER INDEX "bookings_requestId_idx" RENAME TO "Booking_requestId_idx";

-- RenameIndex
ALTER INDEX "bookings_seekerUserId_status_idx" RENAME TO "Booking_seekerUserId_status_idx";

-- RenameIndex
ALTER INDEX "booking_events_bookingId_createdAt_idx" RENAME TO "BookingEvent_bookingId_createdAt_idx";

-- RenameIndex
ALTER INDEX "booking_events_type_createdAt_idx" RENAME TO "BookingEvent_type_createdAt_idx";

-- RenameIndex
ALTER INDEX "conversations_bookingId_idx" RENAME TO "Conversation_bookingId_idx";

-- RenameIndex
ALTER INDEX "conversations_deletedAt_idx" RENAME TO "Conversation_deletedAt_idx";

-- RenameIndex
ALTER INDEX "conversations_requestId_idx" RENAME TO "Conversation_requestId_idx";

-- RenameIndex
ALTER INDEX "conversations_updatedAt_idx" RENAME TO "Conversation_updatedAt_idx";

-- RenameIndex
ALTER INDEX "conversation_participants_providerProfileId_idx" RENAME TO "ConversationParticipant_providerProfileId_idx";

-- RenameIndex
ALTER INDEX "conversation_participants_userId_idx" RENAME TO "ConversationParticipant_userId_idx";

-- RenameIndex
ALTER INDEX "messages_conversationId_createdAt_idx" RENAME TO "Message_conversationId_createdAt_idx";

-- RenameIndex
ALTER INDEX "messages_deletedAt_idx" RENAME TO "Message_deletedAt_idx";

-- RenameIndex
ALTER INDEX "mfa_backup_codes_userId_usedAt_idx" RENAME TO "MfaBackupCode_userId_usedAt_idx";

-- RenameIndex
ALTER INDEX "notifications_deletedAt_idx" RENAME TO "Notification_deletedAt_idx";

-- RenameIndex
ALTER INDEX "notifications_resourceType_resourceId_idx" RENAME TO "Notification_resourceType_resourceId_idx";

-- RenameIndex
ALTER INDEX "notifications_userId_createdAt_idx" RENAME TO "Notification_userId_createdAt_idx";

-- RenameIndex
ALTER INDEX "notifications_userId_readAt_idx" RENAME TO "Notification_userId_readAt_idx";

-- RenameIndex
ALTER INDEX "oauth_accounts_provider_providerUserId_key" RENAME TO "OauthAccount_provider_providerUserId_key";

-- RenameIndex
ALTER INDEX "oauth_accounts_userId_idx" RENAME TO "OauthAccount_userId_idx";

-- RenameIndex
ALTER INDEX "permissions_key_key" RENAME TO "Permission_key_key";

-- RenameIndex
ALTER INDEX "provider_profiles_deletedAt_idx" RENAME TO "ProviderProfile_deletedAt_idx";

-- RenameIndex
ALTER INDEX "provider_profiles_userId_key" RENAME TO "ProviderProfile_userId_key";

-- RenameIndex
ALTER INDEX "roles_deletedAt_idx" RENAME TO "Role_deletedAt_idx";

-- RenameIndex
ALTER INDEX "roles_name_key" RENAME TO "Role_name_key";

-- RenameIndex
ALTER INDEX "role_permissions_permissionId_idx" RENAME TO "RolePermission_permissionId_idx";

-- RenameIndex
ALTER INDEX "service_categories_deletedAt_idx" RENAME TO "ServiceCategory_deletedAt_idx";

-- RenameIndex
ALTER INDEX "service_categories_isActive_sortOrder_idx" RENAME TO "ServiceCategory_isActive_sortOrder_idx";

-- RenameIndex
ALTER INDEX "service_categories_slug_key" RENAME TO "ServiceCategory_slug_key";

-- RenameIndex
ALTER INDEX "service_requests_categoryId_idx" RENAME TO "ServiceRequest_categoryId_idx";

-- RenameIndex
ALTER INDEX "service_requests_createdAt_idx" RENAME TO "ServiceRequest_createdAt_idx";

-- RenameIndex
ALTER INDEX "service_requests_seekerUserId_deletedAt_idx" RENAME TO "ServiceRequest_seekerUserId_deletedAt_idx";

-- RenameIndex
ALTER INDEX "service_requests_seekerUserId_status_idx" RENAME TO "ServiceRequest_seekerUserId_status_idx";

-- RenameIndex
ALTER INDEX "service_requests_status_idx" RENAME TO "ServiceRequest_status_idx";

-- RenameIndex
ALTER INDEX "service_request_events_requestId_createdAt_idx" RENAME TO "ServiceRequestEvent_requestId_createdAt_idx";

-- RenameIndex
ALTER INDEX "service_request_events_type_createdAt_idx" RENAME TO "ServiceRequestEvent_type_createdAt_idx";

-- RenameIndex
ALTER INDEX "sessions_currentJti_key" RENAME TO "Session_currentJti_key";

-- RenameIndex
ALTER INDEX "sessions_expiresAt_idx" RENAME TO "Session_expiresAt_idx";

-- RenameIndex
ALTER INDEX "sessions_familyId_idx" RENAME TO "Session_familyId_idx";

-- RenameIndex
ALTER INDEX "sessions_tokenHash_key" RENAME TO "Session_tokenHash_key";

-- RenameIndex
ALTER INDEX "sessions_userId_revokedAt_idx" RENAME TO "Session_userId_revokedAt_idx";

-- RenameIndex
ALTER INDEX "users_deletedAt_idx" RENAME TO "User_deletedAt_idx";

-- RenameIndex
ALTER INDEX "users_email_key" RENAME TO "User_email_key";

-- RenameIndex
ALTER INDEX "users_lockedUntil_idx" RENAME TO "User_lockedUntil_idx";

-- RenameIndex
ALTER INDEX "users_status_idx" RENAME TO "User_status_idx";

-- RenameIndex
ALTER INDEX "user_profiles_userId_key" RENAME TO "UserProfile_userId_key";

-- RenameIndex
ALTER INDEX "user_roles_roleId_idx" RENAME TO "UserRole_roleId_idx";

-- RenameIndex
ALTER INDEX "verification_tokens_challengeId_key" RENAME TO "VerificationToken_challengeId_key";

-- RenameIndex
ALTER INDEX "verification_tokens_expiresAt_idx" RENAME TO "VerificationToken_expiresAt_idx";

-- RenameIndex
ALTER INDEX "verification_tokens_tokenHash_key" RENAME TO "VerificationToken_tokenHash_key";

-- RenameIndex
ALTER INDEX "verification_tokens_userId_purpose_usedAt_idx" RENAME TO "VerificationToken_userId_purpose_usedAt_idx";

