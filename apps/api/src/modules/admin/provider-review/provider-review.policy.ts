import { createHash } from 'node:crypto';
import type {
  AdminProviderReviewBlocker,
  ProviderReviewSnapshot,
} from '@homeservicemarketplace/contracts';
import { z } from 'zod';

import type { AdminProviderReviewData } from './provider-review.repository';

const requirementsSchema = z.object({
  policyVersion: z.string().min(1),
  verificationRequired: z.boolean(),
  subjectScope: z
    .object({
      countryCode: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .nullable(),
      providerType: z.enum(['INDIVIDUAL', 'BUSINESS']).nullable(),
      categoryIds: z.array(z.string()),
    })
    .optional(),
  requirements: z.array(
    z.object({
      kind: z.enum([
        'INDIVIDUAL_IDENTITY',
        'BUSINESS_REGISTRATION',
        'AUTHORIZED_REPRESENTATIVE_IDENTITY',
        'CATEGORY_LICENSE',
      ]),
      serviceCategoryId: z.string().nullable(),
      fromVersion: z.string().optional(),
    }),
  ),
});

/** Stable recursive serialization: JSON object insertion order is not a revision. */
export function stableReviewJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableReviewJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .filter((key) => row[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableReviewJson(row[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function reviewHash(value: unknown): string {
  return createHash('sha256').update(stableReviewJson(value)).digest('hex');
}

export function reviewRevision(data: AdminProviderReviewData): string {
  const { capturedAt: _capturedAt, ...current } = data.current;
  return reviewHash({
    profile: data.profile,
    current,
    historicalRequirements: data.historicalRequirements,
  });
}

export function savedReviewSnapshot(value: unknown): ProviderReviewSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<ProviderReviewSnapshot>;
  return snapshot.schemaVersion === 1 &&
    snapshot.profile &&
    snapshot.services &&
    Array.isArray(snapshot.services.specialties) &&
    snapshot.workArea &&
    snapshot.availability &&
    snapshot.consent &&
    Array.isArray(snapshot.portfolio)
    ? (snapshot as ProviderReviewSnapshot)
    : null;
}

/** Compare provider input, excluding platform decisions and moving catalogue labels. */
export function submittedContent(snapshot: ProviderReviewSnapshot) {
  return {
    profile: snapshot.profile,
    services: {
      primaryGroupIds: [...snapshot.services.primaryGroupIds].sort(),
      primarySpecialtyId: snapshot.services.primarySpecialtyId,
      specialtyIds: snapshot.services.specialties.map((s) => s.id).sort(),
      equipmentCodes: [...snapshot.services.equipmentCodes].sort(),
    },
    workArea: {
      ...snapshot.workArea,
      areas: snapshot.workArea.areas.map((area) => ({
        cityId: area.cityId,
        districtId: area.districtId,
        neighborhoodId: area.neighborhoodId,
      })),
    },
    availability: snapshot.availability,
    consent: snapshot.consent,
    portfolio: snapshot.portfolio.map(
      ({ revision: _revision, moderationState: _state, ...item }) => item,
    ),
  };
}

export function reviewBlockers(
  data: AdminProviderReviewData,
  actorUserId: string,
  canDecide: boolean,
  now = new Date(),
): AdminProviderReviewBlocker[] {
  const blockers: AdminProviderReviewBlocker[] = [];
  const { profile, submission, verificationCase: kase } = data;
  if (!canDecide) blockers.push({ code: 'PERMISSION_REQUIRED' });
  if (profile.userId === actorUserId) blockers.push({ code: 'SELF_REVIEW' });
  if (
    !profile.user ||
    !profile.user.isActive ||
    profile.user.deletedAt ||
    profile.user.status !== 'ACTIVE'
  ) {
    blockers.push({ code: 'ACCOUNT_INELIGIBLE' });
  }
  if (
    profile.status === 'SUSPENDED' ||
    ['SUSPENDED', 'TERMINATED', 'RESTRICTED'].includes(profile.standingState ?? '')
  ) {
    blockers.push({ code: 'PROVIDER_RESTRICTED' });
  }
  if (!submission || profile.status !== 'PENDING_REVIEW') blockers.push({ code: 'NOT_SUBMITTED' });
  if (submission?.decidedAt) blockers.push({ code: 'SUBMISSION_ALREADY_DECIDED' });
  const snapshot = savedReviewSnapshot(submission?.reviewSnapshot);
  if (!snapshot) blockers.push({ code: 'SNAPSHOT_UNAVAILABLE' });
  else {
    // Moderation changes state, never the provider's originally selected IDs.
    const currentInput = submittedContent(data.current);
    const submittedInput = submittedContent(snapshot);
    if (stableReviewJson(currentInput) !== stableReviewJson(submittedInput)) {
      blockers.push({ code: 'SUBMITTED_CONTENT_CHANGED', taskId: 'REVIEW_SUBMISSION' });
    }
  }
  const selectedIds = new Set(
    snapshot?.services.specialties.filter((s) => s.state !== 'REJECTED').map((s) => s.id) ?? [],
  );
  if (
    profile.categoryApplications.some(
      (a) => a.status === 'PENDING' && !a.supersededAt && selectedIds.has(a.serviceCategoryId),
    )
  ) {
    blockers.push({ code: 'CATEGORY_REVIEW_REQUIRED', taskId: 'SERVICES_EXPERIENCE' });
  }
  if (
    !profile.serviceCategories.some(
      (s) => s.serviceCategory.isActive && selectedIds.has(s.serviceCategoryId),
    )
  ) {
    blockers.push({ code: 'NO_APPROVED_SPECIALTY', taskId: 'SERVICES_EXPERIENCE' });
  }
  if (!kase || !['SUBMITTED', 'IN_REVIEW', 'VERIFIED'].includes(kase.state)) {
    blockers.push({ code: 'VERIFICATION_REQUIRED', taskId: 'BASICS_IDENTITY' });
  } else {
    const parsed = requirementsSchema.safeParse(kase.requirementsSnapshot);
    const requirements = parsed.success ? parsed.data : null;
    const scopeMatches = requirements && evidenceScopeMatches(data, requirements);
    const ready =
      scopeMatches &&
      requirements?.policyVersion === kase.policyVersion &&
      (!requirements.verificationRequired || requirements.requirements.length > 0) &&
      requirements.requirements.every((required) =>
        kase.documents.some(
          (doc) =>
            doc.kind === required.kind &&
            doc.serviceCategoryId === required.serviceCategoryId &&
            doc.supersededAt === null &&
            (!doc.expiresOn || doc.expiresOn > now) &&
            doc.mediaAsset.scanState === 'CLEAN' &&
            doc.mediaAsset.visibility === 'RESTRICTED' &&
            doc.mediaAsset.deletedAt === null &&
            doc.mediaAsset.uploadCompletedAt !== null,
        ),
      );
    if (!ready) blockers.push({ code: 'EVIDENCE_NOT_READY', taskId: 'BASICS_IDENTITY' });
    if (
      kase.state === 'VERIFIED' &&
      !profile.workAccessGrants.some(
        (grant) =>
          grant.caseId === kase.id &&
          grant.status === 'ACTIVE' &&
          !grant.revokedAt &&
          grant.grantedAt <= now &&
          (!grant.expiresAt || grant.expiresAt > now),
      )
    ) {
      blockers.push({ code: 'WORK_GRANT_REQUIRED' });
    }
  }
  return blockers;
}

export function canRequestChanges(blockers: AdminProviderReviewBlocker[]): boolean {
  return !blockers.some((b) =>
    [
      'PERMISSION_REQUIRED',
      'SELF_REVIEW',
      'ACCOUNT_INELIGIBLE',
      'PROVIDER_RESTRICTED',
      'NOT_SUBMITTED',
      'SUBMISSION_ALREADY_DECIDED',
    ].includes(b.code),
  );
}

/** An older case may be reused only when its original policy proves the exact current scope. */
function evidenceScopeMatches(
  data: AdminProviderReviewData,
  requirements: z.infer<typeof requirementsSchema>,
): boolean {
  const kase = data.verificationCase!;
  const current = data.current;
  const rawCountry = current.workArea.countryCode ?? current.workArea.country;
  const countryCode = rawCountry?.trim().toUpperCase() ?? null;
  if (countryCode !== null && !/^[A-Z]{2}$/.test(countryCode)) return false;
  if (kase.country !== countryCode || kase.providerType !== current.profile.providerType)
    return false;
  const categoryIds = current.services.specialties
    .filter((s) => s.state !== 'REJECTED')
    .map((s) => s.id);
  if (requirements.subjectScope) {
    const scope = requirements.subjectScope;
    return (
      scope.countryCode === countryCode &&
      scope.providerType === current.profile.providerType &&
      categoryIds.every((id) => scope.categoryIds.includes(id))
    );
  }
  const historical = data.historicalRequirements;
  if (!historical) return false;
  const ordered = (rows: typeof requirements.requirements) =>
    [...rows].sort((a, b) =>
      `${a.kind}:${a.serviceCategoryId ?? ''}:${a.fromVersion ?? ''}`.localeCompare(
        `${b.kind}:${b.serviceCategoryId ?? ''}:${b.fromVersion ?? ''}`,
      ),
    );
  return (
    historical.policyVersion === requirements.policyVersion &&
    historical.verificationRequired === requirements.verificationRequired &&
    stableReviewJson(ordered(historical.requirements)) ===
      stableReviewJson(ordered(requirements.requirements))
  );
}

export function needsEvidenceView(data: AdminProviderReviewData): boolean {
  if (data.verificationCase?.state === 'VERIFIED') return false;
  const parsed = requirementsSchema.safeParse(data.verificationCase?.requirementsSnapshot);
  return !parsed.success || parsed.data.requirements.length > 0 || parsed.data.verificationRequired;
}
