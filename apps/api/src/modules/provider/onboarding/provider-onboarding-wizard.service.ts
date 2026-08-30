import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_SETTINGS_SCHEMA,
  PROVIDER_ONBOARDING_STEPS,
  isPlausibleE164,
  suggestProfessionalTitle,
  type ProviderSpecialtyState,
  type ProviderSpecialtyView,
  type ProviderTransportModeCode,
  type PatchOnboardingStepRequest,
  type ProviderOnboardingData,
  type ProviderOnboardingDraftView,
  type ProviderOnboardingLifecycleState,
  type ProviderOnboardingStep,
  type ProviderServiceAreaExpansionView,
  type SubmitOnboardingRequest,
  type ProviderOnboardingReview,
  type ProviderOnboardingHubView,
} from '@homeservicemarketplace/contracts';
import type { Prisma, PrismaTx, ServiceCategory } from '@homeservicemarketplace/database';

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
import { buildHub } from './hub/onboarding-hub-resolver';
import { buildReview } from './review/onboarding-review-resolver';
import { referencesRestrictedMedia } from './avatar/avatar-policy';
import { checkRadius, resolveRadiusPolicy, type RadiusPolicy } from './service-area/radius-policy';
import {
  ProviderServiceAreaExpansionService,
  type ExpansionSubject,
} from './service-area/expansion/provider-service-area-expansion.service';
import type { ExpansionDecision } from './service-area/expansion/expansion-resolver';
import { describeTimezone, resolveTimezone } from './service-area/timezone-resolution';
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

export const CONSENT_VERSION_KEY = 'provider_consent_policy_version';
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
    'serviceAreaCountryCode',
    'serviceAreaLat',
    'serviceAreaLng',
    'serviceAreaRadiusKm',
    'serviceAreaIds',
    'workshopAddressLine',
    'workshopLat',
    'workshopLng',
  ],
  SPECIALTIES: ['primaryGroupIds', 'specialtyLeafIds', 'primarySpecialtyId'],
  EXPERIENCE: [
    'yearsOfExperience',
    'professionSince',
    'equipmentCodes',
    'transportMode',
    'transportModes',
  ],
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
    // Sprint 9B.20 — the earned ceiling. Default off; with the switch off it
    // returns the standard bounds without reading a single provider signal.
    private readonly expansion: ProviderServiceAreaExpansionService,
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

      // Sprint 9B.20 — two steps can change what the expansion resolver
      // answers: LOCATION picks the market whose ladder applies, and
      // EXPERIENCE sets the transport the base ceiling comes from. Recording
      // here rather than on every patch keeps the audit trail to the writes
      // that could actually have moved a tier.
      //
      // buildContext has already resolved the decision from post-write state,
      // so this persists that answer rather than computing a second one.
      if (step === 'LOCATION' || step === 'EXPERIENCE') {
        await this.expansion.record(toExpansionSubject(after), after.expansion, new Date(), trx);
      }

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

      // CLAIM THE TRANSITION FIRST, and conditionally.
      //
      // Sprint 9B.23. The state check above is a fast path, not a guard: two
      // simultaneous submits both read DRAFT before either writes, so both
      // used to pass it and both wrote a submission row and an audit event —
      // one application handed in twice, which is exactly what a double tap or
      // a retried request produces.
      //
      // So the pre-submit state moves into the WHERE clause, the same idiom
      // `withdraw` already uses. Postgres serialises the two updates on the
      // row; the winner sees count 1 and goes on to write the submission, the
      // loser sees 0 and returns the existing outcome. The claim is the
      // transition itself, so there is no window between claiming and
      // transitioning in which a third request could slip through.
      const claimed = await trx.providerProfile.updateMany({
        where: {
          id: ctx.profile.id,
          // NOT_STARTED and null are included because a profile that never
          // opened the wizard can still submit a complete application; the
          // states deliberately absent are the ones that mean "already in".
          OR: [
            { onboardingState: null },
            { onboardingState: { in: ['NOT_STARTED', 'DRAFT', 'RETURNED'] } },
          ],
        },
        data: {
          onboardingState: 'DOCUMENTS_REQUIRED',
          status: 'PENDING_REVIEW',
          submittedForReviewAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        // Another request won. Idempotent by construction: no second
        // submission row, no second audit event, and the caller still gets the
        // application's real state from the view below.
        return;
      }

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

      // The state change happened in the claim above. What it did NOT do is
      // the part worth restating:
      //   - `verified` is untouched (no badge)
      //   - `verificationState` is untouched (identity still unchecked)
      //   - `standingState` is untouched
      //   - no ProviderWorkAccessGrant row is written (no work access)
      //   - the legacy `status` moved to PENDING_REVIEW so the existing admin
      //     queue still sees the application, and NOT to ACTIVE

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
    // The profile as it is BEFORE this patch. Several fields below are
    // decided against current state rather than in isolation.
    const p = ctx.profile;

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
          const image = trimToNull(body.profileImageUrl);
          // Sprint 9B.17 — an avatar may never point into the restricted
          // namespace. The V2 client no longer sends a URL at all (it uploads
          // and finalizes), but this field is free text and the LEGACY wizard
          // still types into it, so the refusal belongs here where both paths
          // meet rather than in one client.
          //
          // The public read route already refuses to SERVE a restricted key,
          // so this is the second half of the same boundary: not merely
          // unserved, but never stored — a profile row pointing at somebody's
          // passport is a data-protection incident whether or not the bytes
          // ever came back over HTTP.
          if (image !== null && referencesRestrictedMedia(image)) {
            this.logger.warn({
              msg: 'provider.avatar.restricted_reference_refused',
              providerProfileId: ctx.profile.id,
            });
            throw new AppError('VALIDATION_ERROR', 'That file cannot be used as a photo.', 400, {
              reason: 'NOT_AN_AVATAR_KEY',
            });
          }
          profileData.profileImageUrl = image;
        }
        if (body.phoneNumber !== undefined) {
          const next = trimToNull(body.phoneNumber);
          // Sprint 9B.17 — a real format check, server-side.
          //
          // The DTO bounded the LENGTH and nothing else, so "not a phone
          // number at all" reached the database and surfaced months later as
          // an unreachable provider. Validated here rather than only in the
          // form, because a rule that lives in one client is a rule the other
          // client and every future integration do not have.
          //
          // This is a FORMAT check and nothing more. It says the number is
          // shaped like an international number; it does not claim anyone
          // proved they hold it — that is `phoneVerifiedAt`, which no code
          // path sets yet and which onboarding therefore does not demand.
          if (next !== null && !isPlausibleE164(next)) {
            throw new AppError(
              'VALIDATION_ERROR',
              'Enter a phone number in international format, e.g. +963912345678.',
              400,
              { reason: 'PHONE_FORMAT' },
            );
          }
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
        if (body.serviceAreaCountryCode !== undefined) {
          // Sprint 9B.19 — the machine-readable half. Written beside the
          // display name rather than instead of it: the name is what the
          // provider chose to call their country, in their language, and
          // deriving one from the other by string matching is one spelling
          // away from resolving to nothing.
          profileData.serviceAreaCountryCode = body.serviceAreaCountryCode
            ? body.serviceAreaCountryCode.toUpperCase()
            : null;
        }
        if (body.serviceAreaLat !== undefined) profileData.serviceAreaLat = body.serviceAreaLat;
        if (body.serviceAreaLng !== undefined) profileData.serviceAreaLng = body.serviceAreaLng;
        if (body.serviceAreaRadiusKm !== undefined) {
          // Sprint 9B.19 — bounded by POLICY, not by the DTO's numbers.
          //
          // The DTO's @Min/@Max are a blast radius: they stop an absurd
          // payload being parsed at all. This is the actual rule, and it comes
          // from the same operator settings the suggestion does — so the
          // number the screen offers and the number the server accepts cannot
          // disagree, and raising the ceiling is an admin edit rather than a
          // deploy.
          if (body.serviceAreaRadiusKm !== null) {
            // Sprint 9B.20 — against the ceiling for the country being SAVED.
            //
            // ctx is the pre-write context, and country and radius travel in
            // the same step. Since 9B.20 the country selects which expansion
            // ladder applies, so validating against ctx would judge the new
            // radius under the old market's ceiling — accepting a radius the
            // very next read refuses, or refusing one the provider is entitled
            // to. Re-resolved only when the country actually changes, so the
            // ordinary radius save costs nothing extra.
            const policy = await this.radiusPolicyForWrite(ctx, body, trx);
            const verdict = checkRadius(body.serviceAreaRadiusKm, policy);
            if (!verdict.ok) {
              throw new AppError(
                'VALIDATION_ERROR',
                verdict.code === 'ABOVE_MAX'
                  ? `A service radius cannot be larger than ${policy.maxKm} km.`
                  : `A service radius cannot be smaller than ${policy.minKm} km.`,
                400,
                { reason: verdict.code },
              );
            }
          }
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
        // Sprint 9B.18 — the one they lead with.
        //
        // Applied AFTER the specialties above, so a request that chooses a
        // specialty and nominates it as primary in the same save works. Doing
        // it first would reject the primary for not being chosen yet, which is
        // exactly what the screen does on first use.
        if (body.primarySpecialtyId !== undefined) {
          profileData.primaryServiceCategoryId = await this.resolvePrimarySpecialty(
            ctx,
            body.primarySpecialtyId,
            body.specialtyLeafIds,
            trx,
          );
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
        // Sprint 9B.18 — the set and the primary, kept consistent HERE.
        //
        // A primary that is not in the set is a contradiction, and there are
        // two ways to reach it: send a set that omits the current primary, or
        // send a primary that is not in the current set. Resolving that in each
        // client is how two clients end up resolving it differently, so the
        // server decides and both are told the answer in the response.
        if (body.transportModes !== undefined) {
          // Deduplicated: a repeated mode is not two capabilities, and storing
          // it twice would make the array a poor set for no benefit.
          const modes = [...new Set(body.transportModes)];
          profileData.transportModes = modes;

          const nextPrimary =
            body.transportMode !== undefined ? body.transportMode : (p.transportMode ?? null);

          if (modes.length === 0) {
            // Clearing every mode clears the primary too. Leaving a primary
            // behind an empty set would report a capability the provider just
            // said they do not have.
            profileData.transportMode = null;
          } else if (nextPrimary === null || !modes.includes(nextPrimary)) {
            // No primary, or one the new set does not contain. The first mode
            // in the set is the honest default — it is something they DID
            // choose — and the screen shows which one was picked so it can be
            // changed in a tap.
            profileData.transportMode = modes[0];
          } else {
            profileData.transportMode = nextPrimary;
          }
        } else if (body.transportMode !== undefined) {
          profileData.transportMode = body.transportMode;
          // A primary arriving on its own must join the set, or the two
          // disagree the moment an older client writes only this field.
          if (body.transportMode !== null) {
            const current = p.transportModes ?? [];
            if (!current.includes(body.transportMode)) {
              profileData.transportModes = [...current, body.transportMode];
            }
          }
        }
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

  /**
   * The primary specialty, validated against what the provider actually holds.
   *
   * It may be APPROVED or PENDING — nominating a primary is an intention, not
   * an authorization, and refusing to let someone name the trade they are
   * waiting on approval for would leave the screen unusable for exactly the
   * providers who are mid-application.
   *
   * It may NOT be a category they have not chosen: that would produce a title
   * suggestion for a trade they never claimed. `justChosen` carries the ids
   * from the same request so choosing and nominating in one save works.
   */
  private async resolvePrimarySpecialty(
    ctx: OnboardingContext,
    primaryId: string | null,
    justChosen: string[] | undefined,
    trx: PrismaTx,
  ): Promise<string | null> {
    if (primaryId === null) return null;

    const held = new Set<string>([
      ...ctx.profile.serviceCategories.map((c) => c.serviceCategoryId),
      ...ctx.pendingApplicationCategoryIds,
      ...(justChosen ?? []),
    ]);

    if (!held.has(primaryId)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Choose your main service from the specialties you have selected.',
        400,
        { reason: 'PRIMARY_NOT_SELECTED' },
      );
    }

    // Selected is not the same as selectable. A category that has since been
    // retired must not become somebody's headline trade.
    const found = await this.categories.findManyActiveByIds([primaryId], trx);
    if (found.length === 0 || !found[0].isLeaf) {
      throw new AppError(
        'VALIDATION_ERROR',
        'That service cannot be used as your main service.',
        400,
        { reason: 'PRIMARY_UNAVAILABLE' },
      );
    }

    return primaryId;
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

  /**
   * GET /v1/me/provider/onboarding/hub
   *
   * Sprint 9B.15, delivered late. The V2 client has called this since 9B.16
   * and nothing served it, so six sprints of task screens were verified only
   * against a Playwright stub.
   *
   * Built from the SAME `evaluateOnboarding()` call the review and the submit
   * use. The hub cannot tell a provider they are finished while the submit
   * refuses them, because there is one policy and three readers of it.
   */
  async hub(userId: string): Promise<ProviderOnboardingHubView> {
    const ctx = await this.buildContext(userId);
    return buildHub({
      issues: evaluateOnboarding(this.toCandidate(ctx)),
      lifecycleState: this.lifecycleState(ctx),
    });
  }

  /**
   * GET /v1/me/provider/onboarding/review
   *
   * Sprint 9B.23 — the canonical readiness read-model for V2 Task 6.
   *
   * Served fresh on every call, which is what lets the screen refresh
   * readiness immediately before submitting: the `draftVersion` and
   * `terms.version` in this response are the exact tokens the submit must
   * echo, so a review that is stale by the time the provider taps produces a
   * 409 rather than a wrong decision.
   *
   * Deliberately NOT a field on the draft view. The draft is the private
   * working copy the wizard writes through; this is a verdict about it, and
   * fusing them would mean every autosave re-computed a review nobody asked
   * for.
   */
  async review(userId: string, locale: 'en' | 'ar'): Promise<ProviderOnboardingReview> {
    const ctx = await this.buildContext(userId);
    // THE SAME CALL the submit makes. Not a copy of its rules — the call.
    const issues = evaluateOnboarding(this.toCandidate(ctx));
    const draft = await this.drafts.findByProfileId(ctx.profile.id);

    const current = await this.consentVersion();
    const acceptedVersion = ctx.profile.acceptedConsentVersion ?? null;

    return buildReview({
      issues,
      lifecycleState: this.lifecycleState(ctx),
      // 0 when no draft row exists yet, which the submit treats as "no version
      // to match" — the same reading both sides already agree on.
      draftVersion: draft?.version ?? 0,
      terms: {
        version: current,
        locale,
        // Accepting v1 is not consent to v2. Equality, never presence.
        accepted: acceptedVersion !== null && acceptedVersion === current,
        acceptedVersion,
        acceptedAt: ctx.profile.consentAcceptedAt?.toISOString() ?? null,
      },
      pendingSpecialtyCount: ctx.pendingApplicationCategoryIds.length,
      // Sprint 9B.22 established that nothing on this platform approves a
      // portfolio image, so there is no moderation queue to report a count
      // from and no honest "waiting" line to draw. The projection supports
      // both the moment a reviewer exists; sourcing them would mean a new
      // dependency on this controller, which is how 9B.17 broke every gated
      // spec that mounts it.
      awaitingPortfolioReviewCount: 0,
      portfolioEmpty: false,
    });
  }

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
    const specialties = buildSpecialtyViews(ctx);
    const primaryCategory = findPrimaryCategory(ctx);
    return {
      providerType: p.providerType ?? null,
      legalBusinessName: p.legalBusinessName ?? null,
      displayName: p.displayName ?? null,
      profileImageUrl: p.profileImageUrl ?? null,
      phoneNumber: p.phoneNumber ?? null,
      phoneVerified: p.phoneVerifiedAt != null,

      serviceAreaCity: p.serviceAreaCity ?? null,
      serviceAreaCountry: p.serviceAreaCountry ?? null,
      serviceAreaCountryCode: p.serviceAreaCountryCode ?? null,
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

      // Sprint 9B.18 — the same specialties, with what HAPPENED to each.
      specialties,
      primarySpecialtyId: p.primaryServiceCategoryId ?? null,
      maxSpecialties: ctx.maxSpecialties,
      radiusPolicy: ctx.radiusPolicy,
      // Sprint 9B.20 — the reward card, decided entirely on the server. The
      // client renders what is here and asks no questions of its own: an
      // eligibility formula in React would be a second copy of the rules that
      // nobody could audit and every provider could read.
      serviceAreaExpansion: toExpansionView(ctx.expansion),
      resolvedTimezone: describeResolvedTimezone(p.serviceAreaCountryCode ?? null, new Date()),
      suggestedTitle: primaryCategory
        ? {
            en: suggestProfessionalTitle({
              slug: primaryCategory.slug,
              labelEn: primaryCategory.labelEn,
              labelAr: primaryCategory.labelAr,
              lang: 'en',
            }),
            ar: suggestProfessionalTitle({
              slug: primaryCategory.slug,
              labelEn: primaryCategory.labelEn,
              labelAr: primaryCategory.labelAr,
              lang: 'ar',
            }),
          }
        : null,

      yearsOfExperience: p.yearsOfExperience ?? null,
      professionSince: p.professionSince?.toISOString() ?? null,
      equipmentCodes: ctx.relations.equipment.map((e) => e.equipmentItem.code),
      transportMode: p.transportMode ?? null,
      transportModes: (p.transportModes ?? []) as ProviderTransportModeCode[],

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
      // ── phoneVerified is deliberately NOT ASKED (Sprint 9B.13) ───────────
      //
      // The policy rule is right, and it stays in the policy: a number nobody
      // demonstrated control of is a contact method that does not work. What
      // was wrong is asking it here, because NOTHING IN THIS SYSTEM CAN EVER
      // SET `phoneVerifiedAt`. There is no SMS port, no challenge, no route —
      // `patchStep` only ever clears the column when the number changes.
      //
      // So the requirement was unsatisfiable, and since `toCandidate` supplied
      // it on every submission, EVERY provider was refused with
      // `phoneNumber: NOT_VERIFIED` and no way to clear it. Onboarding was
      // unreachable in production from the day this line was written.
      //
      // It survived because every unit fixture builds a profile that already
      // has `phoneVerifiedAt` set (`makeCompleteProfile`), so the suite only
      // ever exercised the state the application could not reach. The
      // flags-ON journey walks a REAL registration and found it immediately.
      //
      // Omitting the field means "not asked" — the contract the policy already
      // defines for exactly this case — rather than "asked and passed". The
      // rule fires again, with no further change here, the moment a phone
      // verification channel exists and this line supplies the answer.
      //
      // Follow-up: docs/sprint-09b13/PROVIDER_JOURNEY.md §"Phone verification".
      availabilityIntervalCount: ctx.relations.availabilityIntervals.length,
      yearsOfExperience: p.yearsOfExperience ?? null,
      professionSince: p.professionSince ?? null,
      acceptedConsentVersion: p.acceptedConsentVersion ?? null,
      // Only APPROVED leaves count. A pending application is a request, and
      // treating it as a competency would let a provider submit a complete
      // application on skills nobody has agreed they have.
      leafSpecialtyCount: p.serviceCategories.filter((c) => c.serviceCategory.isLeaf).length,
      // Sprint 9B.18 — supplied so the policy can say "waiting" instead of
      // "required" for a provider whose application is in the queue.
      pendingSpecialtyCount: ctx.pendingApplicationCategoryIds.length,
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

    const context: OnboardingContext = {
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
      // Sprint 9B.18 — the decisions the shared profile include does not carry.
      //
      // PROFILE_INCLUDE deliberately loads only live PENDING rows, because
      // that is what every other consumer wants and widening it would put a
      // rejection history on every profile read in the product. The wizard is
      // the one surface that has to SAY "an admin declined this", so it asks
      // separately and only for itself.
      rejectedApplications: await this.applications.listForProvider(
        profile.id,
        { status: 'REJECTED' },
        tx,
      ),
      // Read here rather than in toData so the view builder stays synchronous,
      // and served to the client so the picker's ceiling is the operator's
      // number rather than a constant two places can disagree about.
      maxSpecialties: await this.numberSetting(MAX_SPECIALTIES_KEY, tx),
      // Sprint 9B.19 — the radius suggestion and its bounds, resolved from
      // operator settings and the provider's PRIMARY transport. Loaded here so
      // both the read model and the LOCATION write use one answer.
      radiusPolicy: await resolveRadiusPolicy(profile.transportMode ?? null, (key) =>
        this.numberSetting(key, tx),
      ),
      // Replaced immediately below, once the ceiling it depends on is known.
      // Declared here so OnboardingContext stays a total type rather than one
      // with a field that is sometimes missing.
      expansion: DISABLED_EXPANSION,
    };

    // Sprint 9B.20 — the EARNED ceiling, resolved after the transport-based
    // one because it takes that number as its floor.
    //
    // Folded back into radiusPolicy.maxKm rather than served beside it: the
    // write path already enforces radiusPolicy through checkRadius(), and a
    // second ceiling checked somewhere else is a rule that can disagree with
    // the one the slider was drawn from. One number, one enforcement point.
    //
    // Note what does NOT change: suggestedKm. A provider who has earned more
    // reach is allowed to travel further, not asked to — moving the suggestion
    // would widen their travel obligations because a metric moved, which is
    // the failure this whole feature is shaped to avoid.
    const expansion = await this.expansion.describe(
      toExpansionSubject(context),
      context.radiusPolicy.maxKm,
      new Date(),
      tx,
    );
    context.expansion = expansion;
    context.radiusPolicy = { ...context.radiusPolicy, maxKm: expansion.allowedMaxKm };
    return context;
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

  /**
   * The radius bounds to judge THIS write against.
   *
   * The same policy the context already resolved, unless the write moves the
   * provider to a different market — in which case the ceiling belongs to the
   * market they are moving to, and the earned tier has to be re-resolved
   * against its ladder.
   *
   * Returns ctx.radiusPolicy unchanged in every other case, so the common
   * save pays for nothing.
   */
  private async radiusPolicyForWrite(
    ctx: OnboardingContext,
    body: PatchOnboardingStepRequest,
    tx?: PrismaTx,
  ): Promise<RadiusPolicy> {
    if (body.serviceAreaCountryCode === undefined) return ctx.radiusPolicy;
    const next = body.serviceAreaCountryCode ? body.serviceAreaCountryCode.toUpperCase() : null;
    if (next === (ctx.profile.serviceAreaCountryCode ?? null)) return ctx.radiusPolicy;

    const expansion = await this.expansion.describe(
      { ...toExpansionSubject(ctx), countryCode: next },
      ctx.expansion.baseMaxKm,
      new Date(),
      tx,
    );
    return { ...ctx.radiusPolicy, maxKm: expansion.allowedMaxKm };
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
  /** Newest first. Only the wizard reads these — see buildContext. */
  rejectedApplications: {
    serviceCategoryId: string;
    updatedAt: Date;
    serviceCategory: ServiceCategory;
  }[];
  /** The operator-configured ceiling on held specialties. */
  maxSpecialties: number;
  /** The suggested service radius and the bounds the server enforces.
   *
   *  Sprint 9B.20 — `maxKm` here is the EFFECTIVE ceiling: the transport-based
   *  one, raised by anything the provider has earned. Deliberately the same
   *  field rather than a second one, so the write path enforces the earned
   *  bound through checkRadius() without a parallel rule that can drift from
   *  it. */
  radiusPolicy: RadiusPolicy;
  /** Sprint 9B.20 — why maxKm is what it is, and whether the reward card may
   *  be shown. Decided entirely on the server. */
  expansion: ExpansionDecision;
}

/**
 * Sprint 9B.20 — the decision that applies when the feature is switched off.
 *
 * A constant rather than a call, because buildContext needs OnboardingContext
 * to be a total type before it can resolve the real one, and a field that is
 * "sometimes missing" is how a null slips into a view.
 *
 * baseMaxKm and allowedMaxKm are placeholders here: this value never survives
 * buildContext, which overwrites it on the next line.
 */
const DISABLED_EXPANSION: ExpansionDecision = {
  enabled: false,
  policyVersion: null,
  currentRadiusKm: null,
  baseMaxKm: 0,
  allowedMaxKm: 0,
  currentTier: null,
  nextTier: null,
  progress: [],
  reasonCodes: ['FEATURE_DISABLED'],
  showRewardCard: false,
};

/** Everything the expansion service needs about a provider, taken from the
 *  context the wizard has already loaded rather than read again. */
function toExpansionSubject(ctx: OnboardingContext): ExpansionSubject {
  const p = ctx.profile;
  return {
    providerProfileId: p.id,
    userId: p.userId ?? null,
    countryCode: p.serviceAreaCountryCode ?? null,
    currentRadiusKm: p.serviceAreaRadiusKm ?? null,
    verificationState: p.verificationState ?? null,
    standingState: p.standingState ?? null,
    legacyStatus: p.status,
    availability: p.availability,
    completedJobs: p.completedJobs,
    ratingAvg: p.ratingAvg,
    reviewCount: p.reviewCount,
  };
}

/** The client-facing half of a decision.
 *
 *  Everything here is already safe to publish — the withheld thresholds were
 *  dropped by the resolver, not by this mapping — so it is a rename, not a
 *  redaction. Doing the redaction here instead would put the privacy rule one
 *  refactor away from being skipped. */
function toExpansionView(decision: ExpansionDecision): ProviderServiceAreaExpansionView {
  return {
    show: decision.showRewardCard,
    allowedMaxKm: decision.allowedMaxKm,
    baseMaxKm: decision.baseMaxKm,
    currentTier: decision.currentTier,
    nextTier: decision.nextTier,
    progress: decision.progress.map((p) => ({
      key: p.key,
      met: p.met,
      progress: p.progress,
      current: p.current,
      target: p.target,
      disclosed: p.disclosed,
    })),
    reasonCodes: decision.reasonCodes,
    policyVersion: decision.policyVersion,
  };
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

// ─── Sprint 9B.18: specialty state ──────────────────────────────────────────

/** Is this category still something a provider could be matched for? */
function isRetired(category: { isActive: boolean; deletedAt: Date | null }): boolean {
  return !category.isActive || category.deletedAt !== null;
}

/**
 * Every chosen specialty, with what actually happened to it.
 *
 * PRECEDENCE, and why it is this way round:
 *
 *   INACTIVE first. A category that has been retired is retired whether or not
 *   the provider was approved for it, and it is the only fact they can act on
 *   — everything else about that row is history. Note this is a DISPLAY
 *   decision only: the grant row still exists and submission still counts it,
 *   because taking someone's approval away because an admin tidied the
 *   catalogue would be a punishment for someone else's housekeeping.
 *
 *   Then APPROVED over PENDING over REJECTED. A category that was rejected and
 *   later approved is approved; one applied for again after a rejection is
 *   pending. Reading them the other way round would show a provider a refusal
 *   that has since been overturned.
 */
function buildSpecialtyViews(ctx: OnboardingContext): ProviderSpecialtyView[] {
  const byId = new Map<string, ProviderSpecialtyView>();

  const add = (
    category: ServiceCategory,
    state: ProviderSpecialtyState,
    decidedAt: Date | null,
  ) => {
    // First writer wins, and callers below run in precedence order.
    if (byId.has(category.id)) return;
    byId.set(category.id, {
      categoryId: category.id,
      state: isRetired(category) ? 'INACTIVE' : state,
      labelEn: category.labelEn,
      labelAr: category.labelAr,
      parentId: category.parentId ?? null,
      decidedAt: decidedAt?.toISOString() ?? null,
    });
  };

  for (const grant of ctx.profile.serviceCategories) add(grant.serviceCategory, 'APPROVED', null);
  for (const app of ctx.profile.categoryApplications ?? [])
    add(app.serviceCategory, 'PENDING', null);
  for (const app of ctx.rejectedApplications) {
    add(app.serviceCategory, 'REJECTED', app.updatedAt);
  }

  // Catalogue order, so the picker and this list agree about what comes first.
  return [...byId.values()].sort((a, b) => a.categoryId.localeCompare(b.categoryId));
}

/**
 * The catalogue row for the primary specialty, from what is already loaded.
 *
 * No extra query: the primary must be one of the provider's own specialties,
 * and every one of those arrives with its category. A primary pointing at
 * something not in that set is a row that predates the rule or was written
 * around it, and returning null there means the title suggestion quietly
 * disappears rather than being derived from a category the provider no longer
 * claims.
 */
function findPrimaryCategory(ctx: OnboardingContext): ServiceCategory | null {
  const id = ctx.profile.primaryServiceCategoryId;
  if (!id) return null;

  const grant = ctx.profile.serviceCategories.find((c) => c.serviceCategoryId === id);
  if (grant) return grant.serviceCategory;

  const pending = (ctx.profile.categoryApplications ?? []).find((a) => a.serviceCategory.id === id);
  if (pending) return pending.serviceCategory;

  return ctx.rejectedApplications.find((a) => a.serviceCategory.id === id)?.serviceCategory ?? null;
}

/**
 * Sprint 9B.19 — the timezone answer the client renders.
 *
 * Three shapes, and the distinction between the last two matters: "we have not
 * asked you yet" is not a problem, whereas "your country has several zones" is
 * the one case where the availability step genuinely has to ask. Collapsing
 * them would put a question in front of every provider who has not reached the
 * location step.
 *
 * `display` never contains the IANA identifier — a city and an offset are what
 * a person can check against their own clock.
 */
function describeResolvedTimezone(
  countryCode: string | null,
  now: Date,
): ProviderOnboardingData['resolvedTimezone'] {
  const resolution = resolveTimezone(countryCode);

  if (resolution.kind === 'RESOLVED') {
    return {
      resolved: resolution.timezone,
      display: describeTimezone(resolution.timezone, now),
      needsConfirmation: false,
    };
  }

  return {
    resolved: null,
    display: null,
    // UNKNOWN means they have not told us their country yet — nothing to
    // confirm, because nothing has been claimed.
    needsConfirmation: resolution.kind === 'AMBIGUOUS',
  };
}
