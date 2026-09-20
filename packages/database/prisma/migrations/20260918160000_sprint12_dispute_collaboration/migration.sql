-- CreateEnum
CREATE TYPE "DisputeWorkspaceState" AS ENUM ('GATHERING', 'PROPOSED', 'DECIDED', 'APPEALED', 'CLOSED');

-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE 'DISPUTE_EVIDENCE_READ';

-- AlterEnum
ALTER TYPE "NotificationResourceType" ADD VALUE 'DISPUTE';

-- AlterEnum
ALTER TYPE "DisputeStatus" ADD VALUE 'RESOLVED';

-- CreateTable
CREATE TABLE "DisputeWorkspace" (
    "disputeId" TEXT NOT NULL,
    "state" "DisputeWorkspaceState" NOT NULL DEFAULT 'GATHERING',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "policyVersion" TEXT NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "seekerUserId" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "assignedToUserId" TEXT,
    "resolutionDueAt" TIMESTAMP(3) NOT NULL,
    "firstResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisputeWorkspace_pkey" PRIMARY KEY ("disputeId")
);

-- CreateTable
CREATE TABLE "DisputePrivateDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "contentCipher" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisputePrivateDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeCommandReceipt" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeCommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeWorkspaceEvent" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeWorkspaceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeInformationRequest" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "questionCipher" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeInformationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeStatement" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestId" TEXT,
    "contentCipher" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erasedAt" TIMESTAMP(3),

    CONSTRAINT "DisputeStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeEvidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "intentDigest" TEXT NOT NULL,
    "contentDigest" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREPARED',
    "sourceEvidenceId" TEXT,
    "sharedAt" TIMESTAMP(3),
    "sharedById" TEXT,
    "shareReasonCode" TEXT,
    "scannedAt" TIMESTAMP(3),
    "scannerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "erasureStartedAt" TIMESTAMP(3),
    "erasedAt" TIMESTAMP(3),
    "holdUntil" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisputeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeResolutionProposal" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "contentCipher" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeResolutionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeResolutionConsent" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeResolutionConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeDecisionRecord" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "proposalId" TEXT,
    "supersedesId" TEXT,
    "rationaleCipher" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "basisEventIds" TEXT[],
    "evidenceIds" TEXT[],
    "appealUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeDecisionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeAppealRecord" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "appellantId" TEXT NOT NULL,
    "groundsCipher" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reviewerId" TEXT,
    "newDecisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "DisputeAppealRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeNotificationPreference" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "language" TEXT NOT NULL DEFAULT 'en',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisputeNotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "DisputeWorkspace_state_resolutionDueAt_idx" ON "DisputeWorkspace"("state", "resolutionDueAt");

-- CreateIndex
CREATE INDEX "DisputeWorkspace_assignedToUserId_state_idx" ON "DisputeWorkspace"("assignedToUserId", "state");

-- CreateIndex
CREATE INDEX "DisputePrivateDraft_expiresAt_idx" ON "DisputePrivateDraft"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisputePrivateDraft_userId_bookingId_key" ON "DisputePrivateDraft"("userId", "bookingId");

-- CreateIndex
CREATE INDEX "DisputeCommandReceipt_disputeId_createdAt_idx" ON "DisputeCommandReceipt"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "DisputeWorkspaceEvent_disputeId_createdAt_idx" ON "DisputeWorkspaceEvent"("disputeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeWorkspaceEvent_disputeId_revision_key" ON "DisputeWorkspaceEvent"("disputeId", "revision");

-- CreateIndex
CREATE INDEX "DisputeInformationRequest_status_dueAt_idx" ON "DisputeInformationRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "DisputeInformationRequest_disputeId_recipientId_idx" ON "DisputeInformationRequest"("disputeId", "recipientId");

-- CreateIndex
CREATE INDEX "DisputeStatement_disputeId_createdAt_idx" ON "DisputeStatement"("disputeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeEvidence_intentDigest_key" ON "DisputeEvidence"("intentDigest");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeEvidence_storageKey_key" ON "DisputeEvidence"("storageKey");

-- CreateIndex
CREATE INDEX "DisputeEvidence_state_nextAttemptAt_idx" ON "DisputeEvidence"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "DisputeEvidence_disputeId_authorId_contentDigest_idx" ON "DisputeEvidence"("disputeId", "authorId", "contentDigest");

-- CreateIndex
CREATE INDEX "DisputeEvidence_erasedAt_retainUntil_idx" ON "DisputeEvidence"("erasedAt", "retainUntil");

-- CreateIndex
CREATE INDEX "DisputeResolutionProposal_disputeId_status_idx" ON "DisputeResolutionProposal"("disputeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeResolutionConsent_proposalId_userId_key" ON "DisputeResolutionConsent"("proposalId", "userId");

-- CreateIndex
CREATE INDEX "DisputeDecisionRecord_disputeId_createdAt_idx" ON "DisputeDecisionRecord"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "DisputeAppealRecord_disputeId_status_idx" ON "DisputeAppealRecord"("disputeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeAppealRecord_decisionId_appellantId_key" ON "DisputeAppealRecord"("decisionId", "appellantId");

-- AddForeignKey
ALTER TABLE "DisputeWorkspace" ADD CONSTRAINT "DisputeWorkspace_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeCommandReceipt" ADD CONSTRAINT "DisputeCommandReceipt_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeWorkspace"("disputeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeWorkspaceEvent" ADD CONSTRAINT "DisputeWorkspaceEvent_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeWorkspace"("disputeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeInformationRequest" ADD CONSTRAINT "DisputeInformationRequest_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeWorkspace"("disputeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeStatement" ADD CONSTRAINT "DisputeStatement_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeWorkspace"("disputeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeStatement" ADD CONSTRAINT "DisputeStatement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DisputeInformationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeWorkspace"("disputeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeResolutionProposal" ADD CONSTRAINT "DisputeResolutionProposal_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeWorkspace"("disputeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeResolutionConsent" ADD CONSTRAINT "DisputeResolutionConsent_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "DisputeResolutionProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeDecisionRecord" ADD CONSTRAINT "DisputeDecisionRecord_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeWorkspace"("disputeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeDecisionRecord" ADD CONSTRAINT "DisputeDecisionRecord_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "DisputeResolutionProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeAppealRecord" ADD CONSTRAINT "DisputeAppealRecord_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "DisputeWorkspace"("disputeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisputeAppealRecord" ADD CONSTRAINT "DisputeAppealRecord_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "DisputeDecisionRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain invariants not expressible as Prisma CHECK/partial-unique declarations.
ALTER TABLE "DisputeWorkspace" ADD CONSTRAINT "dispute_workspace_parties_distinct" CHECK ("seekerUserId" <> "providerUserId"),
 ADD CONSTRAINT "dispute_workspace_revision_nonnegative" CHECK ("revision" >= 0),
 ADD CONSTRAINT "dispute_workspace_closed_timestamp" CHECK (("state"='CLOSED') = ("closedAt" IS NOT NULL));
ALTER TABLE "DisputePrivateDraft" ADD CONSTRAINT "dispute_draft_version_nonnegative" CHECK ("version" >= 0);
ALTER TABLE "DisputeInformationRequest" ADD CONSTRAINT "dispute_request_state_valid" CHECK ("status" IN ('OPEN','ANSWERED','EXPIRED'));
ALTER TABLE "DisputeResolutionProposal" ADD CONSTRAINT "dispute_proposal_state_valid" CHECK ("status" IN ('OPEN','DECLINED','SUPERSEDED','DECIDED','EXPIRED'));
ALTER TABLE "DisputeAppealRecord" ADD CONSTRAINT "dispute_appeal_state_valid" CHECK ("status" IN ('OPEN','DECIDED')),
 ADD CONSTRAINT "dispute_appeal_decided_record" CHECK (("status"='DECIDED') = ("newDecisionId" IS NOT NULL AND "reviewerId" IS NOT NULL AND "reviewedAt" IS NOT NULL));
ALTER TABLE "DisputeEvidence" ADD CONSTRAINT "dispute_evidence_size_bounded" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880),
 ADD CONSTRAINT "dispute_evidence_attempts_bounded" CHECK ("attempts" >= 0 AND "attempts" <= 5),
 ADD CONSTRAINT "dispute_evidence_state_valid" CHECK ("state" IN ('PREPARED','STORED','SCANNING','SCAN_FAILED','CLEAN','QUARANTINED','DEAD','ERASING','ERASURE_DEAD','ERASED')),
 ADD CONSTRAINT "dispute_evidence_clean_scanned" CHECK ("state" <> 'CLEAN' OR "scannedAt" IS NOT NULL),
 ADD CONSTRAINT "dispute_evidence_shared_derivative" CHECK ("sharedAt" IS NULL OR ("sourceEvidenceId" IS NOT NULL AND "sharedById" IS NOT NULL AND "shareReasonCode" IS NOT NULL)),
 ADD CONSTRAINT "dispute_evidence_erasure_fence" CHECK ("state" NOT IN ('ERASING','ERASURE_DEAD','ERASED') OR "erasureStartedAt" IS NOT NULL),
 ADD CONSTRAINT "dispute_evidence_erasure_receipt" CHECK ("state" <> 'ERASED' OR ("erasedAt" IS NOT NULL AND "storageKey" IS NULL AND "contentDigest"='')),
 ADD CONSTRAINT "dispute_evidence_lease_pair" CHECK (("leaseToken" IS NULL) = ("leaseUntil" IS NULL));
CREATE UNIQUE INDEX "dispute_one_open_proposal" ON "DisputeResolutionProposal"("disputeId") WHERE "status"='OPEN';
CREATE UNIQUE INDEX "dispute_one_open_appeal" ON "DisputeAppealRecord"("disputeId") WHERE "status"='OPEN';
CREATE UNIQUE INDEX "dispute_one_original_decision" ON "DisputeDecisionRecord"("disputeId") WHERE "supersedesId" IS NULL;
CREATE UNIQUE INDEX "dispute_one_superseding_decision" ON "DisputeDecisionRecord"("supersedesId") WHERE "supersedesId" IS NOT NULL;

-- Register distinct authorities; intentionally grant NONE to any existing role.
-- Assignment of these permissions is an explicit operator decision, never rollout magic.
INSERT INTO "Permission" ("id","key","description","createdAt","updatedAt") VALUES
 ('s12_dispute_read','dispute:read:any','Read non-conflicted dispute workspaces',NOW(),NOW()),
 ('s12_dispute_assign','dispute:assign','Assign independent case reviewers',NOW(),NOW()),
 ('s12_dispute_request','dispute:request','Request specific information from a participant',NOW(),NOW()),
 ('s12_dispute_propose','dispute:propose','Propose service remedies without executing money movement',NOW(),NOW()),
 ('s12_dispute_decide','dispute:decide','Record a policy-bound dispute decision',NOW(),NOW()),
 ('s12_dispute_appeal_decide','dispute:appeal:decide','Independently review an appealed decision',NOW(),NOW()),
 ('s12_dispute_close','dispute:close','Close after review window and fulfilment checks',NOW(),NOW()),
 ('s12_dispute_evidence_view','dispute:evidence:view','Read restricted dispute evidence with access audit',NOW(),NOW()),
 ('s12_dispute_evidence_publish','dispute:evidence:publish','Attest and publish a separately redacted derivative',NOW(),NOW()),
 ('s12_dispute_evidence_hold','dispute:evidence:hold','Place bounded retention holds without restoring access',NOW(),NOW()),
 ('s12_dispute_evidence_retry','dispute:evidence:retry','Requeue a dead-letter operation after dependency repair',NOW(),NOW())
 ON CONFLICT ("key") DO NOTHING;
