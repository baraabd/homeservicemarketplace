import { Injectable } from '@nestjs/common';
import {
  ProviderCapability,
  ProviderCapabilityDenialReason,
  ProviderNextAction,
  type ProviderCapabilitiesResponse,
  type ProviderCapabilityDecision,
} from '@homeservicemarketplace/contracts';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

// Sprint 7 — THE decision point for "what may this provider do".
// docs/adr/0005 (the axes) · docs/adr/0006 (why one service)
//
// Nothing else is allowed to answer this question. Guards, controllers, and
// the web app all resolve here, so `/v1/provider/*` and `/v1/me/provider/*`
// cannot drift, and the client stops re-deriving a rule it gets wrong.
//
// Three properties hold by construction:
//
//   DENY BY DEFAULT   the set starts empty and rules ADD to it. A capability
//                     added to the enum and forgotten here is denied, not
//                     granted. The opposite default makes every omission a
//                     hole.
//   FIRST DENY WINS   precedence is one ordered list. Once a rank denies,
//                     nothing later re-grants.
//   RANK 0 IS ABSOLUTE  account eligibility is evaluated BEFORE the provider
//                     profile is even loaded.

/** Every capability, in the order the response lists them. Iterating this
 *  rather than `Object.values` at each call site keeps the response order
 *  stable for snapshot-style assertions. */
const ALL_CAPABILITIES: readonly ProviderCapability[] = [
  ProviderCapability.ViewOwnProfile,
  ProviderCapability.EditOwnProfile,
  ProviderCapability.CompleteOnboarding,
  ProviderCapability.SubmitForReview,
  ProviderCapability.ViewMarketplace,
  ProviderCapability.SubmitBid,
  ProviderCapability.ManageBookings,
  ProviderCapability.ViewEarnings,
  ProviderCapability.AppealDecision,
];

/** The inputs the rules read. Assembled once so a rule cannot smuggle in an
 *  extra query — the service must stay three reads deep (docs/adr/0006, plus
 *  the grant read docs/adr/0013 adds). */
interface CapabilityContext {
  accountEligible: boolean;
  hasProfile: boolean;
  onboardingState: string | null;
  standingState: string | null;
  /** Legacy status. Still the marketplace gate when WORK_ACCESS_ENFORCED is
   *  off, so the ONE decision point reflects the ONE rule actually in force
   *  rather than the one that is coming (docs/adr/0007). */
  legacyStatus: string | null;
  /** Axis 2. NULL is possible and means "the Sprint 7 backfill has not reached
   *  this row", NOT "verified" — verified on a database that has never seen a
   *  document would be a fabricated audit trail. Treated as UNVERIFIED. */
  verificationState: string | null;
  /** Axis 4. True iff a grant exists with revokedAt IS NULL and now() between
   *  its start and end. Computed in SQL, never from a status column, so expiry
   *  needs no writer (docs/adr/0005). */
  hasLiveWorkAccessGrant: boolean;
}

@Injectable()
export class ProviderCapabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /** The capability set for a user. Never throws for an unknown or ineligible
   *  user: it returns an all-denied set, because "who is this?" and "what may
   *  they do?" are the same answer here — nothing. */
  async for(userId: string): Promise<ProviderCapabilitiesResponse> {
    return this.decide(await this.load(userId));
  }

  /** True when the user holds this capability. The form guards use. */
  async can(userId: string, capability: ProviderCapability): Promise<boolean> {
    const set = await this.for(userId);
    return set.allowed.includes(capability);
  }

  // ── inputs ───────────────────────────────────────────────────────────────

  private async load(userId: string): Promise<CapabilityContext> {
    // Rank 0 first, and on its own. The account read decides whether the
    // provider read is even relevant, and an ineligible account must produce
    // an all-denied set regardless of what its provider row says.
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { status: true, isActive: true, deletedAt: true },
    });

    const accountEligible =
      user !== null && user.deletedAt === null && user.isActive && user.status === 'ACTIVE';

    if (!accountEligible) {
      // Deliberately does NOT load the profile. Nothing downstream can grant
      // anything, and not reading it keeps the ineligible path cheap and
      // impossible to accidentally make conditional on provider state.
      return {
        accountEligible: false,
        hasProfile: false,
        onboardingState: null,
        standingState: null,
        legacyStatus: null,
        verificationState: null,
        hasLiveWorkAccessGrant: false,
      };
    }

    const profile = await this.prisma.client.providerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        onboardingState: true,
        standingState: true,
        verificationState: true,
      },
    });

    // The grant read is skipped entirely when there is no profile: there is
    // nothing to key it on, and a rule that cannot fire should not cost a
    // round trip.
    const grant =
      profile === null
        ? null
        : await this.prisma.client.providerWorkAccessGrant.findFirst({
            where: {
              providerProfileId: profile.id,
              status: 'ACTIVE',
              revokedAt: null,
              // "Live" is a time predicate evaluated by the database, not a
              // status column maintained by a job. A nightly sweep that fails
              // would otherwise leave access granted that nobody authorised
              // (docs/adr/0005 axis 4).
              grantedAt: { lte: new Date() },
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: { id: true },
          });

    return {
      accountEligible: true,
      hasProfile: profile !== null,
      onboardingState: profile?.onboardingState ?? null,
      standingState: profile?.standingState ?? null,
      legacyStatus: profile?.status ?? null,
      verificationState: profile?.verificationState ?? null,
      hasLiveWorkAccessGrant: grant !== null,
    };
  }

  // ── the precedence table ─────────────────────────────────────────────────

  private decide(ctx: CapabilityContext): ProviderCapabilitiesResponse {
    const allowed = new Set<ProviderCapability>();
    const reasons = new Map<ProviderCapability, ProviderCapabilityDenialReason>();
    const nextActions: ProviderNextAction[] = [];
    let primaryReason: ProviderCapabilityDenialReason | null = null;

    const denyAll = (reason: ProviderCapabilityDenialReason) => {
      for (const c of ALL_CAPABILITIES) reasons.set(c, reason);
      primaryReason = reason;
    };

    // ── Rank 0 — account eligibility. Absolute. ──────────────────────────
    //
    // A suspended, locked, deleted, or deactivated account holds NO provider
    // capability, whatever its provider row says. This duplicates the session
    // layer's check on purpose: that check is correct today, but the
    // guarantee must not depend on one call site continuing to be reached.
    if (!ctx.accountEligible) {
      denyAll(ProviderCapabilityDenialReason.AccountIneligible);
      nextActions.push(ProviderNextAction.ContactSupport);
      return this.render(allowed, reasons, nextActions, primaryReason);
    }

    // ── Rank 1 — no provider profile. ────────────────────────────────────
    if (!ctx.hasProfile) {
      denyAll(ProviderCapabilityDenialReason.NoProviderProfile);
      nextActions.push(ProviderNextAction.CompleteProfile);
      return this.render(allowed, reasons, nextActions, primaryReason);
    }

    // From here the provider always sees their own profile: a locked-out
    // provider who cannot even read their own record has no way to understand
    // why, and support has nothing to point at.
    allowed.add(ProviderCapability.ViewOwnProfile);

    const standing = ctx.standingState;

    // ── Rank 2 — TERMINATED. Read-only, terminal, no appeal. ─────────────
    if (standing === 'TERMINATED') {
      primaryReason = ProviderCapabilityDenialReason.ProviderTerminated;
      for (const c of ALL_CAPABILITIES) {
        if (c !== ProviderCapability.ViewOwnProfile) reasons.set(c, primaryReason);
      }
      nextActions.push(ProviderNextAction.ContactSupport);
      return this.render(allowed, reasons, nextActions, primaryReason);
    }

    // ── Rank 3 — SUSPENDED. Read + appeal only. ──────────────────────────
    if (standing === 'SUSPENDED') {
      primaryReason = ProviderCapabilityDenialReason.ProviderSuspended;
      allowed.add(ProviderCapability.AppealDecision);
      for (const c of ALL_CAPABILITIES) {
        if (!allowed.has(c)) reasons.set(c, primaryReason);
      }
      nextActions.push(ProviderNextAction.AppealDecision);
      return this.render(allowed, reasons, nextActions, primaryReason);
    }

    // ── Rank 4 — RESTRICTED. Existing obligations only, no new work. ─────
    if (standing === 'RESTRICTED') {
      primaryReason = ProviderCapabilityDenialReason.ProviderRestricted;
      allowed.add(ProviderCapability.EditOwnProfile);
      // Bookings already accepted are obligations to a seeker. Cutting them
      // off punishes the customer for the provider's restriction.
      allowed.add(ProviderCapability.ManageBookings);
      allowed.add(ProviderCapability.ViewEarnings);
      allowed.add(ProviderCapability.AppealDecision);
      for (const c of ALL_CAPABILITIES) {
        if (!allowed.has(c)) reasons.set(c, primaryReason);
      }
      nextActions.push(ProviderNextAction.AppealDecision);
      return this.render(allowed, reasons, nextActions, primaryReason);
    }

    // Standing is GOOD or UNDER_REVIEW. UNDER_REVIEW is deliberately NOT a
    // restriction: an investigation that has not concluded must not silently
    // take away someone's livelihood.
    allowed.add(ProviderCapability.EditOwnProfile);

    // ── Rank 5 — onboarding. ─────────────────────────────────────────────
    //
    // THE DRAFT FIX. A provider whose onboarding is incomplete keeps
    // COMPLETE_ONBOARDING — that is the one thing they must be able to do,
    // and its absence is what made the onboarding surface unreachable.
    //
    // Falls back to the legacy status while the axes are being backfilled
    // (docs/adr/0007): a row the backfill has not reached must not be treated
    // as having no onboarding state at all.
    const onboarding = ctx.onboardingState ?? this.onboardingFromLegacy(ctx.legacyStatus);

    if (onboarding === 'DRAFT' || onboarding === 'NOT_STARTED' || onboarding === 'RETURNED') {
      primaryReason = ProviderCapabilityDenialReason.OnboardingIncomplete;
      allowed.add(ProviderCapability.CompleteOnboarding);
      allowed.add(ProviderCapability.SubmitForReview);
      for (const c of ALL_CAPABILITIES) {
        if (!allowed.has(c)) reasons.set(c, primaryReason);
      }
      nextActions.push(ProviderNextAction.CompleteProfile, ProviderNextAction.SubmitApplication);
      return this.render(allowed, reasons, nextActions, primaryReason);
    }

    if (onboarding === 'SUBMITTED') {
      primaryReason = ProviderCapabilityDenialReason.AwaitingReview;
      // Still allowed to edit and re-submit; a queued application is not a
      // frozen one.
      allowed.add(ProviderCapability.CompleteOnboarding);
      for (const c of ALL_CAPABILITIES) {
        if (!allowed.has(c)) reasons.set(c, primaryReason);
      }
      nextActions.push(ProviderNextAction.WaitForReview);
      return this.render(allowed, reasons, nextActions, primaryReason);
    }

    // ── Rank 6 — verification. ARMED in Sprint 9, behind a flag. ─────────
    //
    // docs/adr/0013. A NULL verificationState means the Sprint 7 axis
    // backfill has not reached this row — observed on real data — and is
    // treated as UNVERIFIED. Defaulting the other way would grant work on the
    // strength of a column nobody has written yet.
    if (this.config.get('VERIFICATION_ENFORCED')) {
      const verified = ctx.verificationState === 'VERIFIED';
      if (!verified) {
        primaryReason = ProviderCapabilityDenialReason.VerificationRequired;
        // Work is denied; onboarding and appeal are NOT. A provider who cannot
        // work must still be able to see why and act on it, or the denial is
        // a dead end.
        allowed.add(ProviderCapability.CompleteOnboarding);
        for (const c of ALL_CAPABILITIES) {
          if (!allowed.has(c)) reasons.set(c, primaryReason);
        }
        nextActions.push(ProviderNextAction.CompleteProfile);
        return this.render(allowed, reasons, nextActions, primaryReason);
      }
    }

    // ── Rank 7 — work access. ARMED in Sprint 9, behind a flag. ──────────
    //
    // The flag is the rollout control ADR 0005 asked for. OFF reproduces the
    // pre-Sprint-9 rule EXACTLY — the legacy status gate — so turning it off
    // is a true rollback rather than a different third behaviour. ON consults
    // the grant.
    //
    // The backfill migration (20260824084700) must have run before this is
    // enabled: it refuses to complete unless every working provider holds a
    // live grant, precisely so this flag cannot be armed against a state that
    // would lock out the supply side.
    const marketplaceOpen = this.config.get('WORK_ACCESS_ENFORCED')
      ? ctx.hasLiveWorkAccessGrant
      : ctx.legacyStatus === 'ACTIVE';

    if (!marketplaceOpen) {
      primaryReason = ProviderCapabilityDenialReason.NoWorkAccess;
      for (const c of ALL_CAPABILITIES) {
        if (!allowed.has(c)) reasons.set(c, primaryReason);
      }
      nextActions.push(ProviderNextAction.WaitForReview);
      return this.render(allowed, reasons, nextActions, primaryReason);
    }

    // ── Rank 8 — subscription / recognition. Never grants, never denies. ──
    //
    // Nothing reads subscriptionTier, verified, or topPro. Asserted by a test
    // that flips every one of them and expects an identical capability set.
    allowed.add(ProviderCapability.ViewMarketplace);
    allowed.add(ProviderCapability.SubmitBid);
    allowed.add(ProviderCapability.ManageBookings);
    allowed.add(ProviderCapability.ViewEarnings);

    return this.render(allowed, reasons, nextActions, primaryReason);
  }

  /** Legacy status → onboarding axis, for rows the backfill has not reached.
   *  Mirrors the mapping table in docs/adr/0007 exactly. */
  private onboardingFromLegacy(status: string | null): string | null {
    switch (status) {
      case 'DRAFT':
        return 'DRAFT';
      case 'PENDING_REVIEW':
        return 'SUBMITTED';
      case 'ACTIVE':
      case 'SUSPENDED':
        return 'ACCEPTED';
      case 'REJECTED':
        return 'RETURNED';
      default:
        return null;
    }
  }

  private render(
    allowed: Set<ProviderCapability>,
    reasons: Map<ProviderCapability, ProviderCapabilityDenialReason>,
    nextActions: ProviderNextAction[],
    primaryReason: ProviderCapabilityDenialReason | null,
  ): ProviderCapabilitiesResponse {
    const capabilities: ProviderCapabilityDecision[] = ALL_CAPABILITIES.map((capability) => {
      const isAllowed = allowed.has(capability);
      return {
        capability,
        allowed: isAllowed,
        // A reason on an ALLOWED capability would be nonsense, and a missing
        // reason on a denied one leaves the client with nothing to render.
        ...(isAllowed ? {} : { reason: reasons.get(capability) ?? primaryReason ?? undefined }),
      };
    });

    return {
      capabilities,
      allowed: ALL_CAPABILITIES.filter((c) => allowed.has(c)),
      nextActions,
      primaryReason,
    };
  }
}

export { ALL_CAPABILITIES };
