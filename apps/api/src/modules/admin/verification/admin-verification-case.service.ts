import { Injectable } from '@nestjs/common';
import type {
  AdminVerificationCase,
  AdminVerificationDocument,
  AdminVerificationRequirement,
  VerificationCaseActionCode,
} from '@homeservicemarketplace/contracts';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../shared/errors/app-error';
import { offerableCaseActions } from '../../provider/verification/policy/case-transitions';

// Sprint 9B — the reviewer's read of a verification case.
//
// docs/adr/0009 · docs/adr/0013
//
// Three rules this service exists to hold:
//
//   1. METADATA ONLY. No bytes, no storage key, no signed URL leaves here. A
//      reviewer opens a document through a separate, audited, short-lived
//      read. Putting a credential in this payload would persist it in the
//      client's query cache long after it should have expired.
//
//   2. THE SERVER DECIDES WHAT IS OFFERABLE. availableActions is computed from
//      the one transition table, with self-review already removed — so a
//      reviewer is never shown a button that will 409 or 403. That is D-3
//      (docs/sprint-09/INSPECTION.md) applied before the second copy exists.
//
//   3. `viewable` IS COMPUTED HERE. Only a CLEAN asset can be opened. Letting
//      the client derive it from scanState would put an authorization decision
//      in React and make every future scan state viewable by default.

@Injectable()
export class AdminVerificationCaseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The newest case for a provider, or null when they have never submitted.
   *
   * Null rather than a 404: "this provider has no verification case" is a
   * normal state a reviewer must be able to see, not an error the UI has to
   * treat as a failure. Same reasoning as the capabilities endpoint returning
   * an all-denied set rather than 403.
   */
  async forProvider(
    providerProfileId: string,
    reviewerUserId: string,
  ): Promise<AdminVerificationCase | null> {
    const profile = await this.prisma.client.providerProfile.findFirst({
      where: { id: providerProfileId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);

    return this.project({ providerProfileId }, profile, reviewerUserId);
  }

  /**
   * Sprint 9B.6 — one SPECIFIC case, by its own id.
   *
   * Distinct from forProvider, which answers "the newest case for this
   * provider". A reviewer arriving from the queue clicked a particular row, and
   * handing them a different case because it happens to be newer would be a
   * quiet substitution at exactly the moment accuracy matters.
   *
   * A case that does not exist and a case whose provider profile is deleted
   * answer the same 404 — the reviewer has no need to tell those apart, and the
   * distinction would confirm the existence of an id they cannot see.
   */
  async forCase(caseId: string, reviewerUserId: string): Promise<AdminVerificationCase | null> {
    const kase = await this.prisma.client.verificationCase.findUnique({
      where: { id: caseId },
      select: { providerProfile: { select: { id: true, userId: true, deletedAt: true } } },
    });
    if (!kase?.providerProfile || kase.providerProfile.deletedAt !== null) {
      throw new AppError('NOT_FOUND', 'Verification case not found.', 404);
    }

    return this.project(
      { id: caseId },
      { id: kase.providerProfile.id, userId: kase.providerProfile.userId },
      reviewerUserId,
    );
  }

  private async project(
    where: { id: string } | { providerProfileId: string },
    profile: { id: string; userId: string | null },
    reviewerUserId: string,
  ): Promise<AdminVerificationCase | null> {
    const row = await this.prisma.client.verificationCase.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        providerProfileId: true,
        state: true,
        policyVersion: true,
        country: true,
        providerType: true,
        submittedAt: true,
        assignedToUserId: true,
        assignedAt: true,
        decidedAt: true,
        requirementsSnapshot: true,
        documents: {
          orderBy: { uploadedAt: 'asc' },
          select: {
            id: true,
            kind: true,
            serviceCategoryId: true,
            supersededAt: true,
            uploadedAt: true,
            category: { select: { labelEn: true, labelAr: true } },
            // Only the columns a reviewer needs to decide whether to OPEN the
            // document. storageKey is deliberately absent from this select —
            // absent, not filtered, so it cannot reach a serializer at all.
            mediaAsset: {
              select: {
                detectedMimeType: true,
                sizeBytes: true,
                originalFilename: true,
                scanState: true,
                deletedAt: true,
              },
            },
          },
        },
        decisions: {
          orderBy: { decidedAt: 'desc' },
          select: {
            id: true,
            outcome: true,
            reasonCode: true,
            fromState: true,
            toState: true,
            policyVersion: true,
            decidedByUserId: true,
            decidedAt: true,
          },
        },
      },
    });

    if (!row) return null;

    const documents: AdminVerificationDocument[] = row.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      serviceCategoryId: d.serviceCategoryId,
      serviceCategoryLabelEn: d.category?.labelEn ?? null,
      serviceCategoryLabelAr: d.category?.labelAr ?? null,
      detectedMimeType: d.mediaAsset?.detectedMimeType ?? null,
      sizeBytes: d.mediaAsset?.sizeBytes ?? 0,
      displayFilename: d.mediaAsset?.originalFilename ?? null,
      scanState: (d.mediaAsset?.scanState ?? 'PENDING') as AdminVerificationDocument['scanState'],
      // CLEAN and not-yet-deleted. Anything else is not openable, including a
      // scan state that does not exist yet — the comparison is against CLEAN
      // rather than against a list of bad states, so a new state fails closed.
      viewable: d.mediaAsset?.scanState === 'CLEAN' && d.mediaAsset?.deletedAt === null,
      uploadedAt: d.uploadedAt.toISOString(),
      evidenceDeletedAt: d.mediaAsset?.deletedAt?.toISOString() ?? null,
      supersededAt: d.supersededAt?.toISOString() ?? null,
    }));

    // The checklist. Read from the SNAPSHOT taken at submission, not from the
    // live policy: a reviewer must judge what was asked at the time (ADR 0010).
    const snapshot = (row.requirementsSnapshot ?? null) as {
      requirements?: Array<{ kind: string; serviceCategoryId: string | null }>;
    } | null;

    const requirements: AdminVerificationRequirement[] = (snapshot?.requirements ?? []).map(
      (req) => {
        const match = row.documents.find(
          (d) =>
            d.kind === req.kind &&
            (d.serviceCategoryId ?? null) === (req.serviceCategoryId ?? null) &&
            d.supersededAt === null,
        );
        return {
          kind: req.kind as AdminVerificationRequirement['kind'],
          serviceCategoryId: req.serviceCategoryId ?? null,
          serviceCategoryLabelEn: match?.category?.labelEn ?? null,
          serviceCategoryLabelAr: match?.category?.labelAr ?? null,
          satisfied: match !== undefined,
        };
      },
    );

    // ── what this reviewer may do ────────────────────────────────────────
    //
    // Self-review is removed HERE as well as refused at the mutation. A
    // reviewer who is also the subject should never see the buttons; showing
    // them and then refusing teaches people to click and hope.
    const isSelfReview = profile.userId !== null && profile.userId === reviewerUserId;
    // OFFERABLE, not merely legal. approve is legal from SUBMITTED and has no
    // command behind it until Sprint 9B.7; offering it would recreate D-3
    // exactly — a button the backend answers with 409.
    const actions = isSelfReview
      ? []
      : (offerableCaseActions(row.state, 'reviewer') as VerificationCaseActionCode[]);

    const blockedReason = isSelfReview
      ? ('SELF_REVIEW' as const)
      : actions.length === 0
        ? row.state === 'DRAFT'
          ? ('NOT_SUBMITTED' as const)
          : ('TERMINAL_STATE' as const)
        : null;

    return {
      id: row.id,
      providerProfileId: row.providerProfileId,
      state: row.state,
      policyVersion: row.policyVersion,
      country: row.country,
      providerType: row.providerType,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      assignedToUserId: row.assignedToUserId,
      assignedAt: row.assignedAt?.toISOString() ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      requirements,
      documents,
      decisions: row.decisions.map((x) => ({
        id: x.id,
        outcome: x.outcome,
        reasonCode: x.reasonCode,
        fromState: x.fromState,
        toState: x.toState,
        policyVersion: x.policyVersion,
        decidedByUserId: x.decidedByUserId,
        decidedAt: x.decidedAt.toISOString(),
      })),
      availableActions: actions,
      blockedReason,
    };
  }
}
