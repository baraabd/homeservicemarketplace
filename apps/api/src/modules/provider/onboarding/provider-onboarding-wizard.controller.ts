import { RequireCapability } from '../guards/require-capability.decorator';
import { ProviderCapabilityGuard } from '../guards/provider-capability.guard';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  PROVIDER_ONBOARDING_STEPS,
  ProviderCapability,
  type ProviderOnboardingDraftView,
  type ProviderOnboardingStep,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { Roles } from '../../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../../iam/authorization/guards/roles.guard';
import { AppError } from '../../../shared/errors/app-error';
import { PatchOnboardingStepDto } from './dto/patch-onboarding-step.dto';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto';
import { ProviderOnboardingWizardService } from './provider-onboarding-wizard.service';

// /v1/me/provider/onboarding/* — the Sprint 8 wizard.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// Additive. The Phase 4 surface on ProviderController
// (GET /onboarding, POST /submit-for-review, POST /withdraw-review) is
// untouched and still served, so an older client keeps working through the
// whole rollout.
//
// GUARDS, and why they are what they are:
//   JwtAuthGuard  — every route needs a session.
//   RolesGuard    — every route needs the `provider` role. `userId` comes from
//                   the session, never the body, so a provider can only ever
//                   read and write their own application.
//   CsrfGuard     — on the mutations only. Reads are safe; writes are not.
//
// NOT ProviderActiveGuard. That guard asks for VIEW_MARKETPLACE, which a DRAFT
// provider does not have and must not need — gating the onboarding surface on
// a capability that onboarding EARNS is precisely the loop Sprint 7 fixed.
// Sprint 9B.8 — the onboarding surface itself. Ungated before this sprint, so
// a SUSPENDED provider could keep editing and re-submitting an application
// nobody would act on.
//
// EDIT_OWN_PROFILE, not COMPLETE_ONBOARDING, and the difference is load
// bearing. COMPLETE_ONBOARDING is withheld once onboarding reaches ACCEPTED,
// so gating on it would start returning 403 to fully-onboarded providers who
// could reach this surface yesterday — a regression dressed up as a security
// fix. EDIT_OWN_PROFILE is held by every state that could already reach it and
// withheld from exactly the two that should not: SUSPENDED and TERMINATED.
@UseGuards(JwtAuthGuard, RolesGuard, ProviderCapabilityGuard)
@Roles('provider')
@RequireCapability(ProviderCapability.EditOwnProfile)
@Controller({ path: 'me/provider/onboarding', version: '1' })
export class ProviderOnboardingWizardController {
  constructor(private readonly wizard: ProviderOnboardingWizardService) {}

  /** The whole application: data, per-step state, progress, next action.
   *
   *  Creates the draft on first read. Opening the wizard IS starting it, and
   *  a separate create call is a round-trip that can fail on its own and leave
   *  the provider looking at an empty screen with no way to begin. */
  @Get('draft')
  @HttpCode(HttpStatus.OK)
  get(@CurrentUser() user: AuthenticatedUser): Promise<ProviderOnboardingDraftView> {
    return this.wizard.get(user.id);
  }

  /**
   * Autosave one step.
   *
   * The step comes from the PATH, not the body, so a request cannot claim to
   * be editing one step while writing another — and the service rejects any
   * field that does not belong to the step named here.
   *
   * Returns the complete view, so the client never merges a mutation result
   * into a stale read.
   */
  @UseGuards(CsrfGuard)
  @Patch('steps/:step')
  @HttpCode(HttpStatus.OK)
  patchStep(
    @CurrentUser() user: AuthenticatedUser,
    @Param('step') step: string,
    @Body() body: PatchOnboardingStepDto,
  ): Promise<ProviderOnboardingDraftView> {
    return this.wizard.patchStep(user.id, assertStep(step), body);
  }

  /**
   * Hand the application in.
   *
   * A valid submission moves to DOCUMENTS_REQUIRED and grants NOTHING: no
   * marketplace access, no work-access grant, no verified badge. Idempotent —
   * re-submitting returns the existing outcome rather than transitioning
   * twice, because a retry after a dropped response must not produce a second
   * application.
   *
   * 422 with machine-readable `missing` codes when incomplete.
   */
  @UseGuards(CsrfGuard)
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SubmitOnboardingDto,
  ): Promise<ProviderOnboardingDraftView> {
    return this.wizard.submit(user.id, body);
  }

  /**
   * Take it back out of the queue.
   *
   * The counterpart to the edit lock: blocking edits on a submitted
   * application is only reasonable if there is a visible way out of the queue.
   */
  @UseGuards(CsrfGuard)
  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentUser() user: AuthenticatedUser): Promise<ProviderOnboardingDraftView> {
    return this.wizard.withdraw(user.id);
  }
}

/** Validate the path segment against the contract.
 *
 *  A 404 rather than a 400: an unknown step is a URL that does not exist, and
 *  reporting it as a bad request implies the step is real and the request was
 *  malformed. */
function assertStep(step: string): ProviderOnboardingStep {
  if ((PROVIDER_ONBOARDING_STEPS as readonly string[]).includes(step)) {
    return step as ProviderOnboardingStep;
  }
  throw new AppError('NOT_FOUND', `Unknown onboarding step: ${step}.`, 404);
}
