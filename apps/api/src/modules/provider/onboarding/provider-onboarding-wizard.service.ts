import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_SETTINGS_SCHEMA,
  PROVIDER_ONBOARDING_STEPS,
  type PatchOnboardingStepRequest,
  type ProviderOnboardingData,
  type ProviderOnboardingDraftView,
  type ProviderOnboardingLifecycleState,
  type ProviderOnboardingStep,
  type SubmitOnboardingRequest,
} from '@homeservicemarketplace/contracts';
import type { Prisma, PrismaTx } from '@homeservicemarketplace/database';

import {
  ProviderProfileRepository,
  type ProviderProfileWithCategories,
} from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { ProviderCategoryApplicationRepository } from '../../../infrastructure/persistence/services/provider-category-application.repository';
import { ServiceCategoryRepository } from '../../../infrastructure/persistence/services/service-category.repository';
import { PlatformSettingRepository } from '../../../infrastructure/persistence/settings/platform-setting.repository';
import { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import {
  ProviderOnboardingDraftRepository,
  type ProviderOnboardingRelations,
} from '../../../infrastructure/persistence/provider/provider-onboarding-draft.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
// The SAME normalisation Sprint 6's fan-out matches on. Imported rather than
// re-implemented: if the two ever disagree, a provider silently stops being
// reachable by requests in their own city and nothing errors.
import { normaliseCityKey } from '../../../shared/geo/service-area';
import { AuditService } from '../../iam/audit/audit.service';
import {
  MAX_INTERVALS_PER_PROVIDER,
  isValidTimezone,
  validateAvailability,
} from './availability-intervals';
import { computeProgress, resumeStep } from './onboarding-steps';
import { evaluateOnboarding, type OnboardingCandidate } from './provider-onboarding.policy';

// Sprint 8 — the provider onboarding WIZARD.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// Four operations: read, patch one step, submit, withdraw. All four return the
// SAME complete view, so the client never merges a mutation result into a
// stale read or has to decide which of two half-answers is current.
//
// THE THING THIS SERVICE MUST NOT DO
//
// A valid submission moves the application to DOCUMENTS_REQUIRED and grants
// NOTHING. No marketplace access, no work-access grant, no verified badge, no
// change to the legacy `status` beyond entering the review queue. Sprint 9
// issues grants; Sprint 8 collects an application. Those are different facts,
// and conflating them is the mistake ADR 0005 exists to undo — so there is a
// test asserting each of those five things separately, because a single
// "submission does not activate" test would pass while any one of them broke.
//
// WHERE THE ANSWERS LIVE
//
// In typed columns, written the moment they validate. The draft row carries
// only what the profile cannot say: the resume point, the server's view of
// which steps are done, the concurrency token, and the pinned policy version.
// That is what makes resume trivial — the wizard reads the profile, not a
// replay log.

/** Pinned onto each draft. Bumped when the completeness policy changes in a
 *  way that could fail an application that was previously passing, so a draft
 *  in flight is not silently re-judged under rules that did not exist when it
 *  was started. */
export const CURRENT_ONBOARDING_POLICY_VERSION = 'sprint-08';

const CONSENT_VERSION_KEY = 'provider_consent_policy_version';
const MAX_SERVICE_AREAS_KEY = 'provider_onboarding_max_service_areas';
const MAX_SPECIALTIES_KEY = 'provider_onboarding_max_specialties';

/** Which fields each step is ALLOWED to write.
 *
 *  The step comes from the route, and a PATCH that carries a field belonging
 *  to another step is rejected rather than quietly applied. Without this, the
 *  per-step surface is decorative: any screen could write any field, and the
 *  autosave of a half-finished LOCATION step could clear a completed CONSENT.
 */
const STEP_WRITABLE_FIELDS: Record<ProviderOnboardingStep, readonly string[]> = {
  PROVIDER_TYPE: ['providerType', 'legalBusinessName'],
  IDENTITY: ['displayName', 'profileImageUrl', 'phoneNumber'],
  LOCATION: [
    'serviceAreaCity',
    'serviceAreaCountry',
    'serviceAreaLat',
    'serviceAreaLng',
    'serviceAreaRadiusKm',
    'serviceAreaIds',
    'workshopAddressLine',
    'workshopLat',
    'workshopLng',
  ],
  SPECIALTIES: ['primaryGroupIds', 'specialtyLeafIds'],
  EXPERIENCE: ['yearsOfExperience', 'professionSince', 'equipmentCodes', 'transportMode'],
  AVAILABILITY: ['availability', 'timezone'],
  PROFILE: ['headline', 'bio', 'additionalInformation'],
  CONSENT: ['acceptedConsentVersion'],
  // REVIEW reads back what the other steps collected and writes nothing.
  REVIEW: [],
};

@Injectable()
export class ProviderOnboardingWizardService {
  private readonly logger = new Logger(ProviderOnboardingWizardService.name);

  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly drafts: ProviderOnboardingDraftRepository,
    private readonly categories: ServiceCategoryRepository,
    private readonly applications: ProviderCategoryApplicationRepository,
    private readonly users: UserRepository,
    private readonly settings: PlatformSettingRepository,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  /**
   * GET /v1/me/provider/onboarding/draft
   *
   * Creates the draft row on first read rather than making the client POST one
   * first. Opening the wizard IS starting it, and a separate create call is a
   * round-trip that can fail on its own and leave the provider looking at an
   * empty screen with no way to begin.
   */
  async get(userId: string): Promise<ProviderOnboardingDraftView> {
    const ctx = await this.load(userId);
    await this.drafts.ensure(ctx.profile.id, {
      currentStep: PROVIDER_ONBOARDING_STEPS[0],
      policyVersion: CURRENT_ONBOARDING_POLICY_VERSION,
    });
    return this.view(userId);
  }

  /**
   * PATCH /v1/me/provider/onboarding/steps/:step
   *
   * One step per request, autosaved. The version in the body is the version
   * the client last read; a mismatch is a 409 carrying the server's current
   * state so the UI can show the conflict rather than clobbering the other tab.
   */
  async patchStep(
    userId: string,
    step: ProviderOnboardingStep,
    body: PatchOnboardingStepRequest,
  ): Promise<ProviderOnboardingDraftView> {
    // Cheap, deterministic rejections BEFORE opening a transaction: a wrong
    // field on the wrong step is a client bug, and a transaction is a lock.
    this.assertFieldsBelongToStep(step, body);

    await this.tx.run(async (trx) => {
      const ctx = await this.load(userId, trx);
      this.assertEditable(ctx);

      const draft = await this.drafts.ensure(
        ctx.profile.id,
        {
          currentStep: PROVIDER_ONBOARDING_STEPS[0],
          policyVersion: CURRENT_ONBOARDING_POLICY_VERSION,
        },
        trx,
      );

      // Version is checked here for a FAST, informative failure and again in
      // the UPDATE's WHERE clause for correctness. This read-then-compare
      // alone would race; the WHERE clause alone would give the client a bare
      // "0 rows" with no way to explain what happened.
      if (body.version !== draft.version) {
        throw await this.conflict(userId, draft.version, body.version);
      }

      const scratch = await this.applyStep(ctx, step, body, trx);

      // Recompute from the freshly written state rather than from what the
      // client sent. The client's view of "is this step done" is a guess; the
      // server's is the one submission is judged against.
      const after = await this.buildContext(userId, trx);
      const progress = computeProgress(
        evaluateOnboarding(this.toCandidate(after)),
        after.profile.onboardingState,
      );

      const moved = await this.drafts.advanceIfVersion(
        ctx.profile.id,
        body.version,
        {
          currentStep: resumeStep(progress.steps),
          completedSteps: progress.completedSteps,
          data: scratch as Prisma.InputJsonValue,
        },
        trx,
      );
      if (moved === 0) {
        // Another writer landed between the check above and this update.
        throw await this.conflict(userId, draft.version + 1, body.version);
      }
    });

    return this.view(userId);
  }

  /**
   * POST /v1/me/provider/onboarding/submit
   *
   * Idempotent, and it grants nothing. See the note at the top of this file.
   */
  async submit(
    userId: string,
    body: SubmitOnboardingRequest,
  ): Promise<ProviderOnboardingDraftView> {
    await this.tx.run(async (trx) => {
      const ctx = await this.load(userId, trx);
      const draft = await this.drafts.findByProfileId(ctx.profile.id, trx);

      // ALREADY SUBMITTED — return the existing outcome rather than
      // transitioning twice. A retry after a dropped response must not produce
      // a second application, and the ordinary cause of a double submit is a
      // network timeout, not a double click.
      const state = this.lifecycleState(ctx);
      if (state === 'SUBMITTED' || state === 'DOCUMENTS_REQUIRED') return;

      if (state === 'ACCEPTED') {
        throw new AppError('CONFLICT', 'Your application has already been approved.', 409);
      }

      if (draft && body.version !== draft.version) {
        throw await this.conflict(userId, draft.version, body.version);
      }

      const issues = evaluateOnboarding(this.toCandidate(ctx));
      if (issues.length > 0) {
        // 422, not 400: the payload is well-formed, the RESOURCE is
        // incomplete. `details.missing` is machine-readable so the wizard can
        // send the provider straight to the offending step.
        throw new AppError(
          'VALIDATION_ERROR',
          'Your provider application is not complete yet.',
          422,
          { missing: issues },
        );
      }

      const candidate = this.toCandidate(ctx);

      // The snapshot is what the policy actually evaluated, pinned to the
      // policy version that judged it. Without it, a rule added next month
      // makes it impossible to reconstruct why this application was accepted.
      await trx.providerOnboardingSubmission.create({
        data: {
          providerProfileId: ctx.profile.id,
          policyVersion: draft?.policyVersion ?? CURRENT_ONBOARDING_POLICY_VERSION,
          snapshot: candidate as unknown as Prisma.InputJsonValue,
          issues: undefined,
          submittedByUserId: userId,
        },
      });

      // The ONLY state change. DOCUMENTS_REQUIRED, and nothing else:
      //   - `verified` is untouched (no badge)
      //   - `verificationState` is untouched (identity still unchecked)
      //   - `standingState` is untouched
      //   - no ProviderWorkAccessGrant row is written (no work access)
      //   - the legacy `status` moves to PENDING_REVIEW so the existing admin
      //     queue still sees the application, and NOT to ACTIVE
      await trx.providerProfile.update({
        where: { id: ctx.profile.id },
        data: {
          onboardingState: 'DOCUMENTS_REQUIRED',
          status: 'PENDING_REVIEW',
          submittedForReviewAt: new Date(),
        },
      });

      await this.audit.record(
        {
          type: 'PROVIDER_ONBOARDING_SUBMITTED',
          userId,
          metadata: {
            newState: 'DOCUMENTS_REQUIRED',
            policyVersion: draft?.policyVersion ?? CURRENT_ONBOARDING_POLICY_VERSION,
            // Recorded explicitly so the trail says out loud what the
            // transition did NOT do. A reader six months from now should not
            // have to infer it from an absence.
            grantsWorkAccess: false,
            grantsVerifiedBadge: false,
          },
        },
        trx,
      );
    });

    this.logger.log({ msg: 'provider.onboarding.wizard.submitted', userId });
    return this.view(userId);
  }

  /**
   * POST /v1/me/provider/onboarding/withdraw
   *
   * The counterpart to the edit lock. Blocking edits on a queued application
   * is only reasonable if there is a visible way out of the queue; otherwise a
   * provider who spots a typo after submitting waits for a rejection.
   */
  async withdraw(userId: string): Promise<ProviderOnboardingDraftView> {
    await this.tx.run(async (trx) => {
      const ctx = await this.load(userId, trx);
      const state = this.lifecycleState(ctx);

      if (state !== 'SUBMITTED' && state !== 'DOCUMENTS_REQUIRED') {
        throw new AppError('CONFLICT', 'There is no submitted application to withdraw.', 409);
      }

      // Scoped in the WHERE clause: if a reviewer decided the application
      // between the read and the write, they win and the provider is told,
      // rather than the decision being silently undone.
      const moved = await trx.providerProfile.updateMany({
        where: {
          id: ctx.profile.id,
          onboardingState: { in: ['SUBMITTED', 'DOCUMENTS_REQUIRED'] },
        },
        data: {
          onboardingState: 'DRAFT',
          status: 'DRAFT',
          submittedForReviewAt: null,
        },
      });
      if (moved.count === 0) {
        throw new AppError(
          'CONFLICT',
          'This application has already been reviewed and can no longer be withdrawn.',
          409,
        );
      }

      await this.audit.record(
        {
          type: 'PROVIDER_ONBOARDING_SUBMITTED',
          userId,
          metadata: { previousState: state, newState: 'DRAFT', outcome: 'withdrawn' },
        },
        trx,
      );
    });

    this.logger.log({ msg: 'provider.onboarding.wizard.withdrawn', userId });
    return this.view(userId);
  }

  // ── writing one step ──────────────────────────────────────────────────

  /** Apply a step's fields and return the updated scratch bag.
   *
   *  Returns the bag rather than writing it, so the caller can commit the
   *  typed columns and the draft row in one transaction. */
  private async applyStep(
    ctx: OnboardingContext,
    step: ProviderOnboardingStep,
    body: PatchOnboardingStepRequest,
    trx: PrismaTx,
  ): Promise<Record<string, unknown>> {
    const scratch: Record<string, unknown> = { ...(ctx.scratch ?? {}) };
    const profileData: Record<string, unknown> = {};

    switch (step) {
      case 'PROVIDER_TYPE': {
        if (body.providerType !== undefined) profileData.providerType = body.providerType;
        if (body.legalBusinessName !== undefined) {
          profileData.legalBusinessName = trimToNull(body.legalBusinessName);
        }
        break;
      }

      case 'IDENTITY': {
        if (body.displayName !== undefined) {
          const name = trimToNull(body.displayName);
          // displayName is NOT NULL on the profile, so a cleared value would
          // fail at the database with a Prisma error the client cannot act on.
          // Rejected here with something it can.
          if (name === null) {
            throw new AppError('VALIDATION_ERROR', 'A display name is required.', 400);
          }
          profileData.displayName = name;
        }
        if (body.profileImageUrl !== undefined) {
          profileData.profileImageUrl = trimToNull(body.profileImageUrl);
        }
        if (body.phoneNumber !== undefined) {
          const next = trimToNull(body.phoneNumber);
          profileData.phoneNumber = next;
          // Changing the number INVALIDATES the verification. Keeping the old
          // proof against a new number is how an unverifiable number ends up
          // marked verified — the single most valuable thing to get wrong here.
          if (next !== ctx.profile.phoneNumber) profileData.phoneVerifiedAt = null;
        }
        break;
      }

      case 'LOCATION': {
        if (body.serviceAreaCity !== undefined) {
          profileData.serviceAreaCity = trimToNull(body.serviceAreaCity);
          // Sprint 6's normalised match key is written by the SAME code path
          // that writes the display value, which is what keeps the two from
          // drifting. See ADR 0003.
          profileData.serviceAreaCityKey = normaliseCityKey(body.serviceAreaCity);
        }
        if (body.serviceAreaCountry !== undefined) {
          profileData.serviceAreaCountry = trimToNull(body.serviceAreaCountry);
        }
        if (body.serviceAreaLat !== undefined) profileData.serviceAreaLat = body.serviceAreaLat;
        if (body.serviceAreaLng !== undefined) profileData.serviceAreaLng = body.serviceAreaLng;
        if (body.serviceAreaRadiusKm !== undefined) {
          profileData.serviceAreaRadiusKm = body.serviceAreaRadiusKm;
        }
        if (body.workshopAddressLine !== undefined) {
          profileData.workshopAddressLine = trimToNull(body.workshopAddressLine);
        }
        // Workshop coordinates travel together — the database CHECK enforces
        // it, so a half-pair would fail as a 500 rather than a 400 unless it
        // is caught here.
        if (body.workshopLat !== undefined || body.workshopLng !== undefined) {
          const lat = body.workshopLat ?? ctx.profile.workshopLat;
          const lng = body.workshopLng ?? ctx.profile.workshopLng;
          if ((lat === null) !== (lng === null)) {
            throw new AppError(
              'VALIDATION_ERROR',
              'A workshop location needs both a latitude and a longitude.',
              400,
            );
          }
          profileData.workshopLat = body.workshopLat ?? lat;
          profileData.workshopLng = body.workshopLng ?? lng;
        }
        if (body.serviceAreaIds !== undefined) {
          await this.writeServiceAreas(ctx, body.serviceAreaIds, trx);
        }
        break;
      }

      case 'SPECIALTIES': {
        if (body.primaryGroupIds !== undefined) {
          // Scratch, not a grant. Ticking a group is an expression of intent
          // ("I work in plumbing") with no authorization consequence, so it
          // has no grant table row to live in.
          scratch.primaryGroupIds = await this.validateGroups(body.primaryGroupIds);
        }
        if (body.specialtyLeafIds !== undefined) {
          await this.applyForSpecialties(ctx, body.specialtyLeafIds, trx);
        }
        break;
      }

      case 'EXPERIENCE': {
        if (body.yearsOfExperience !== undefined) {
          profileData.yearsOfExperience = body.yearsOfExperience;
        }
        if (body.professionSince !== undefined) {
          profileData.professionSince = body.professionSince
            ? parseIsoDate(body.professionSince)
            : null;
        }
        if (body.transportMode !== undefined) profileData.transportMode = body.transportMode;
        if (body.equipmentCodes !== undefined) {
          const items = await this.drafts.findEquipmentByCodes(body.equipmentCodes, trx);
          const found = new Set(items.map((i) => i.code));
          const unknown = body.equipmentCodes.filter((c) => !found.has(c));
          if (unknown.length > 0) {
            // Named, not counted. "3 items are invalid" leaves the provider
            // unticking things at random to find out which.
            throw new AppError(
              'VALIDATION_ERROR',
              `Unknown or retired equipment: ${unknown.join(', ')}.`,
              400,
            );
          }
          await this.drafts.replaceEquipment(
            ctx.profile.id,
            items.map((i) => i.id),
            trx,
          );
        }
        break;
      }

      case 'AVAILABILITY': {
        const timezone =
          body.timezone !== undefined
            ? trimToNull(body.timezone)
            : (ctx.relations.availabilityIntervals[0]?.timezone ?? null);

        if (body.availability !== undefined) {
          if (body.availability.length > 0 && !timezone) {
            throw new AppError(
              'VALIDATION_ERROR',
              'A timezone is required before working hours can be saved.',
              400,
            );
          }
          if (timezone && !isValidTimezone(timezone)) {
            throw new AppError('VALIDATION_ERROR', `Unknown timezone: ${timezone}.`, 400);
          }

          const problems = validateAvailability(body.availability);
          if (problems.length > 0) {
            throw new AppError(
              'VALIDATION_ERROR',
              'These working hours cannot be saved.',
              422,
              // Indexed, so the UI highlights the offending rows rather than
              // telling the provider that something, somewhere, overlaps.
              { availability: problems, maxIntervals: MAX_INTERVALS_PER_PROVIDER },
            );
          }

          await this.drafts.replaceAvailability(
            ctx.profile.id,
            body.availability.map((i) => ({ ...i, timezone: timezone as string })),
            trx,
          );
        } else if (body.timezone !== undefined && timezone) {
          // A zone change with no new hours re-stamps the existing week.
          // Leaving old intervals on the old zone would silently split one
          // schedule across two, which nothing downstream expects.
          if (!isValidTimezone(timezone)) {
            throw new AppError('VALIDATION_ERROR', `Unknown timezone: ${timezone}.`, 400);
          }
          await this.drafts.replaceAvailability(
            ctx.profile.id,
            ctx.relations.availabilityIntervals.map((i) => ({
              dayOfWeek: i.dayOfWeek,
              startMinute: i.startMinute,
              endMinute: i.endMinute,
              timezone,
            })),
            trx,
          );
        }
        if (body.timezone !== undefined) scratch.timezone = timezone;
        break;
      }

      case 'PROFILE': {
        if (body.headline !== undefined) profileData.headline = trimToNull(body.headline);
        if (body.bio !== undefined) profileData.bio = trimToNull(body.bio);
        if (body.additionalInformation !== undefined) {
          profileData.additionalInformation = trimToNull(body.additionalInformation);
        }
        break;
      }

      case 'CONSENT': {
        if (body.acceptedConsentVersion !== undefined) {
          const accepted = trimToNull(body.acceptedConsentVersion);
          if (accepted === null) {
            // Withdrawing consent clears BOTH columns — the database CHECK
            // requires the version and the timestamp to agree, and a
            // timestamp with no version answers nothing.
            profileData.acceptedConsentVersion = null;
            profileData.consentAcceptedAt = null;
          } else {
            const live = await this.consentVersion(trx);
            if (accepted !== live) {
              // Accepting a stale document is not consent to the live one.
              // The wizard re-fetches and re-presents; it does not quietly
              // upgrade what the provider agreed to.
              throw new AppError(
                'CONFLICT',
                'The terms have been updated. Please review and accept the current version.',
                409,
                { currentVersion: live },
              );
            }
            profileData.acceptedConsentVersion = accepted;
            profileData.consentAcceptedAt = new Date();
          }
        }
        break;
      }

      case 'REVIEW':
        // Writes nothing. Reaching this branch means the field guard let
        // something through, which the guard's own test covers.
        break;
    }

    if (Object.keys(profileData).length > 0) {
      await trx.providerProfile.update({ where: { id: ctx.profile.id }, data: profileData });
    }

    return scratch;
  }

  /** Turn requested leaf specialties into APPLICATIONS, never into grants.
   *
   *  This is the authorization boundary the hierarchy could have eroded. A
   *  provider says what they want; an admin decides. Selecting a parent group
   *  reaches this with an empty list, because `expandParentSelection` has no
   *  way to produce a grant. */
  private async applyForSpecialties(
    ctx: OnboardingContext,
    leafIds: string[],
    trx: PrismaTx,
  ): Promise<void> {
    const max = await this.numberSetting(MAX_SPECIALTIES_KEY, trx);
    if (leafIds.length > max) {
      throw new AppError('VALIDATION_ERROR', `You can hold at most ${max} specialties.`, 400);
    }

    const found = await this.categories.findManyActiveByIds(leafIds, trx);
    const byId = new Map(found.map((c) => [c.id, c]));

    const unknown = leafIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        'One or more selected specialties are unavailable.',
        400,
      );
    }

    // Only LEAVES are selectable, and that is read from the stored flag rather
    // than inferred from "has no children" — a parent whose last child was
    // deactivated must not silently become selectable.
    const notLeaves = found.filter((c) => !c.isLeaf);
    if (notLeaves.length > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Service groups cannot be selected directly — choose the specialties beneath them.',
        400,
      );
    }

    const held = new Set(ctx.profile.serviceCategories.map((c) => c.serviceCategoryId));
    const pending = new Set(ctx.pendingApplicationCategoryIds.map((id) => id));

    for (const leafId of leafIds) {
      if (held.has(leafId) || pending.has(leafId)) continue;
      await trx.providerCategoryApplication.create({
        data: {
          providerProfileId: ctx.profile.id,
          serviceCategoryId: leafId,
          status: 'PENDING',
        },
      });
      await this.audit.record(
        {
          type: 'PROVIDER_CATEGORY_APPLIED',
          userId: ctx.userId,
          metadata: { serviceCategoryId: leafId, source: 'onboarding-wizard' },
        },
        trx,
      );
    }
  }

  /** Validate the ticked groups exist and are active. Returns the ids to
   *  store as scratch — deliberately NOT a grant of anything. */
  private async validateGroups(groupIds: string[]): Promise<string[]> {
    if (groupIds.length === 0) return [];
    const found = await this.categories.findManyActiveByIds(groupIds);
    if (found.length !== new Set(groupIds).size) {
      throw new AppError(
        'VALIDATION_ERROR',
        'One or more selected service groups are unavailable.',
        400,
      );
    }
    return found.map((c) => c.id);
  }

  private async writeServiceAreas(
    ctx: OnboardingContext,
    ids: string[],
    trx: PrismaTx,
  ): Promise<void> {
    const max = await this.numberSetting(MAX_SERVICE_AREAS_KEY, trx);
    if (ids.length > max) {
      throw new AppError('VALIDATION_ERROR', `You can cover at most ${max} areas.`, 400);
    }

    const places = await this.drafts.findPlaces(ids, trx);
    const known = new Set([...places.cityIds, ...places.districtIds, ...places.neighborhoodIds]);
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new AppError('VALIDATION_ERROR', 'One or more selected areas are unavailable.', 400);
    }

    const cityIds = new Set(places.cityIds);
    const districtIds = new Set(places.districtIds);
    await this.drafts.replaceServiceAreas(
      ctx.profile.id,
      ids.map((id) =>
        cityIds.has(id)
          ? { cityId: id }
          : districtIds.has(id)
            ? { districtId: id }
            : { neighborhoodId: id },
      ),
      trx,
    );
  }

  // ── reading ───────────────────────────────────────────────────────────

  private async view(userId: string): Promise<ProviderOnboardingDraftView> {
    const ctx = await this.buildContext(userId);
    const issues = evaluateOnboarding(this.toCandidate(ctx));
    const progress = computeProgress(issues, ctx.profile.onboardingState);
    const state = this.lifecycleState(ctx);

    return {
      state,
      currentStep: resumeStep(progress.steps),
      steps: progress.steps,
      completedSteps: progress.completedSteps,
      percentComplete: progress.percentComplete,
      nextAction: progress.nextAction,
      complete: issues.length === 0,
      missing: issues,
      data: this.toData(ctx),
      version: ctx.relations.onboardingDraft?.version ?? 0,
      policyVersion:
        ctx.relations.onboardingDraft?.policyVersion ?? CURRENT_ONBOARDING_POLICY_VERSION,
      lastSavedAt: ctx.relations.onboardingDraft?.lastSavedAt?.toISOString() ?? null,
      editable: state !== 'SUBMITTED' && state !== 'DOCUMENTS_REQUIRED' && state !== 'ACCEPTED',
    };
  }

  private toData(ctx: OnboardingContext): ProviderOnboardingData {
    const p = ctx.profile;
    const scratch = ctx.scratch ?? {};
    return {
      providerType: p.providerType ?? null,
      legalBusinessName: p.legalBusinessName ?? null,
      displayName: p.displayName ?? null,
      profileImageUrl: p.profileImageUrl ?? null,
      phoneNumber: p.phoneNumber ?? null,
      phoneVerified: p.phoneVerifiedAt != null,

      serviceAreaCity: p.serviceAreaCity ?? null,
      serviceAreaCountry: p.serviceAreaCountry ?? null,
      serviceAreaLat: p.serviceAreaLat ?? null,
      serviceAreaLng: p.serviceAreaLng ?? null,
      serviceAreaRadiusKm: p.serviceAreaRadiusKm ?? null,
      serviceAreaIds: ctx.relations.serviceAreas.map(
        (a) => a.cityId ?? a.districtId ?? a.neighborhoodId ?? '',
      ),
      workshopAddressLine: p.workshopAddressLine ?? null,
      workshopLat: p.workshopLat ?? null,
      workshopLng: p.workshopLng ?? null,

      primaryGroupIds: Array.isArray(scratch.primaryGroupIds)
        ? (scratch.primaryGroupIds as string[])
        : [],
      specialtyLeafIds: ctx.profile.serviceCategories.map((c) => c.serviceCategoryId),
      pendingSpecialtyIds: ctx.pendingApplicationCategoryIds,

      yearsOfExperience: p.yearsOfExperience ?? null,
      professionSince: p.professionSince?.toISOString() ?? null,
      equipmentCodes: ctx.relations.equipment.map((e) => e.equipmentItem.code),
      transportMode: p.transportMode ?? null,

      availability: ctx.relations.availabilityIntervals.map((i) => ({
        id: i.id,
        dayOfWeek: i.dayOfWeek,
        startMinute: i.startMinute,
        endMinute: i.endMinute,
        timezone: i.timezone,
      })),
      timezone:
        ctx.relations.availabilityIntervals[0]?.timezone ??
        (typeof scratch.timezone === 'string' ? scratch.timezone : null),

      headline: p.headline ?? null,
      bio: p.bio ?? null,
      additionalInformation: p.additionalInformation ?? null,

      acceptedConsentVersion: p.acceptedConsentVersion ?? null,
      consentAcceptedAt: p.consentAcceptedAt?.toISOString() ?? null,
    };
  }

  /** Build the candidate the completeness policy judges.
   *
   *  Every Sprint 8 field is supplied, so a wizard application is judged in
   *  full. Legacy callers that do not supply them are judged on the Phase 4
   *  rules alone — see the policy's own note on why that matters. */
  private toCandidate(ctx: OnboardingContext): OnboardingCandidate {
    const p = ctx.profile;
    return {
      displayName: p.displayName,
      headline: p.headline,
      bio: p.bio,
      phoneNumber: p.phoneNumber,
      serviceAreaCity: p.serviceAreaCity,
      serviceAreaCountry: p.serviceAreaCountry,
      serviceAreaRadiusKm: p.serviceAreaRadiusKm,
      serviceCategoryCount: p.serviceCategories.length,
      emailVerified: ctx.emailVerified,

      providerType: p.providerType ?? null,
      legalBusinessName: p.legalBusinessName ?? null,
      phoneVerified: p.phoneVerifiedAt != null,
      availabilityIntervalCount: ctx.relations.availabilityIntervals.length,
      yearsOfExperience: p.yearsOfExperience ?? null,
      professionSince: p.professionSince ?? null,
      acceptedConsentVersion: p.acceptedConsentVersion ?? null,
      // Only APPROVED leaves count. A pending application is a request, and
      // treating it as a competency would let a provider submit a complete
      // application on skills nobody has agreed they have.
      leafSpecialtyCount: p.serviceCategories.filter((c) => c.serviceCategory.isLeaf).length,
    };
  }

  // ── plumbing ──────────────────────────────────────────────────────────

  private async load(userId: string, tx?: PrismaTx): Promise<OnboardingContext> {
    return this.buildContext(userId, tx);
  }

  private async buildContext(userId: string, tx?: PrismaTx): Promise<OnboardingContext> {
    const [profile, user] = await Promise.all([
      this.providers.findByUserIdWithCategories(userId, tx),
      this.users.findById(userId, tx),
    ]);
    if (!profile) {
      throw new AppError(
        'NOT_FOUND',
        'Provider profile not found. Upgrade to a provider account first.',
        404,
      );
    }

    const relations = await this.drafts.loadRelations(profile.id, tx);
    if (!relations) {
      throw new AppError('INTERNAL_ERROR', 'Failed to load the onboarding application.', 500);
    }

    const scratch =
      relations.onboardingDraft?.data && typeof relations.onboardingDraft.data === 'object'
        ? (relations.onboardingDraft.data as Record<string, unknown>)
        : {};

    return {
      userId,
      profile,
      relations,
      scratch,
      emailVerified: user?.emailVerifiedAt != null,
      // The shared profile include already narrows this to LIVE pending rows
      // (PENDING and not superseded), so there is nothing further to filter —
      // and re-filtering here on a projection that no longer carries `status`
      // would be a second, drifting definition of "pending".
      pendingApplicationCategoryIds: (profile.categoryApplications ?? []).map(
        (a) => a.serviceCategory.id,
      ),
    };
  }

  /** The lifecycle state, falling back to the legacy `status` for rows the
   *  Sprint 7 backfill has not reached. ADR 0007 owns this compatibility
   *  window; reading NULL as NOT_STARTED would tell an approved legacy
   *  provider they have not begun. */
  private lifecycleState(ctx: OnboardingContext): ProviderOnboardingLifecycleState {
    const explicit = ctx.profile.onboardingState;
    if (explicit) return explicit as ProviderOnboardingLifecycleState;
    switch (ctx.profile.status) {
      case 'PENDING_REVIEW':
        return 'SUBMITTED';
      case 'ACTIVE':
      case 'SUSPENDED':
        return 'ACCEPTED';
      case 'REJECTED':
        return 'RETURNED';
      default:
        return 'DRAFT';
    }
  }

  private assertEditable(ctx: OnboardingContext): void {
    const state = this.lifecycleState(ctx);
    if (state === 'SUBMITTED' || state === 'DOCUMENTS_REQUIRED') {
      throw new AppError(
        'CONFLICT',
        'Your application is being reviewed and cannot be edited. Withdraw it first if you need to make changes.',
        409,
      );
    }
    if (state === 'ACCEPTED') {
      throw new AppError(
        'CONFLICT',
        'Your application has been approved. Edit your profile instead.',
        409,
      );
    }
  }

  /** A PATCH may only write fields belonging to the step in its URL.
   *
   *  Without this the per-step surface is decorative — any screen could write
   *  any field, and the autosave of a half-finished LOCATION step could clear
   *  a completed CONSENT. */
  private assertFieldsBelongToStep(
    step: ProviderOnboardingStep,
    body: PatchOnboardingStepRequest,
  ): void {
    const allowed = new Set(STEP_WRITABLE_FIELDS[step]);
    // Only fields that were actually SENT.
    //
    // `Object.keys` alone is wrong here, and wrong in a way no unit test sees:
    // the ValidationPipe hands this method a class instance, and TypeScript
    // compiling class fields to `useDefineForClassFields` semantics defines
    // EVERY declared property on every instance — as `undefined`. So a PATCH
    // carrying one field arrives with all thirty declared keys present, and an
    // unfiltered check rejects every request as writing fields it never sent.
    //
    // The unit tests pass plain object literals and never saw it; the runtime
    // check against a booted API found it on the first real PATCH.
    //
    // Filtering on `undefined` is also the correct rule on its own terms:
    // `undefined` means "not sent, leave alone" everywhere else in this
    // service, and `null` — which means "clear this" — is preserved.
    const offending = Object.entries(body)
      .filter(([key, value]) => key !== 'version' && value !== undefined && !allowed.has(key))
      .map(([key]) => key);
    if (offending.length > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        `These fields do not belong to the ${step} step: ${offending.join(', ')}.`,
        400,
      );
    }
  }

  /** A 409 carrying the SERVER's current state.
   *
   *  A bare "conflict" leaves the client with a stale form and no way to
   *  reconcile; attaching the current view lets it show what the other tab
   *  wrote and offer to reload. */
  private async conflict(userId: string, actual: number, sent: number): Promise<AppError> {
    const current = await this.view(userId).catch(() => null);
    return new AppError(
      'CONFLICT',
      'This application was changed somewhere else. Reload to see the latest version.',
      409,
      { expectedVersion: actual, receivedVersion: sent, current },
    );
  }

  private async consentVersion(tx?: PrismaTx): Promise<string> {
    const row = await this.settings.findByKey(CONSENT_VERSION_KEY, tx);
    if (typeof row?.value === 'string' && row.value.trim().length > 0) return row.value;
    return defaultSetting(CONSENT_VERSION_KEY, 'v1') as string;
  }

  private async numberSetting(key: string, tx?: PrismaTx): Promise<number> {
    const row = await this.settings.findByKey(key, tx);
    if (typeof row?.value === 'number' && Number.isFinite(row.value)) return row.value;
    return defaultSetting(key, 0) as number;
  }
}

interface OnboardingContext {
  userId: string;
  profile: ProviderProfileWithCategories;
  relations: ProviderOnboardingRelations;
  scratch: Record<string, unknown>;
  emailVerified: boolean;
  pendingApplicationCategoryIds: string[];
}

/** The schema default for a key, so the wizard and the admin screen agree on
 *  what an absent row means. Falling back to a literal here instead would let
 *  the two drift the moment someone edits the schema. */
function defaultSetting(key: string, fallback: unknown): unknown {
  return ADMIN_SETTINGS_SCHEMA.find((f) => f.key === key)?.default ?? fallback;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIsoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('VALIDATION_ERROR', 'That is not a valid date.', 400);
  }
  return parsed;
}
