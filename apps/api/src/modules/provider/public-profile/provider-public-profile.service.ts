import { Injectable } from '@nestjs/common';
import type {
  ProviderPublicProfilePreviewResponse,
  PublicPortfolioImage,
} from '@homeservicemarketplace/contracts';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../shared/errors/app-error';
import { buildPublicProfile } from './public-profile-projection';

// Sprint 9B.22 — serving the public projection to the provider who owns it.
//
// docs/sprint-09b22/PUBLIC_PROFILE_AND_PORTFOLIO.md
//
// WHY THE PREVIEW IS NOT BUILT FROM THE DRAFT
//
// The onboarding draft is the PRIVATE working copy: it carries the phone
// number, the coordinates, the radius, the pending specialties and the
// moderation queue. A preview rendered from it is a preview of the wrong
// object, and it would agree with the public profile only for as long as
// nobody edited either. So the preview is built by the same projection a public
// route would use, and the provider is shown its literal output.
//
// TWO THINGS THIS SERVICE REFUSES TO PRETEND
//
// There is no public provider-profile route on this platform yet, and nothing
// moves a portfolio image out of PENDING. Both are reported as flags rather
// than smoothed over, because a screen that shows a provider a polished public
// profile which no customer can reach — and photos it calls published when
// nobody has reviewed them — is lying to them about the state of their
// application.

/**
 * Whether the platform serves a public provider profile to customers.
 *
 * FALSE, and deliberately a constant rather than a setting: it is a statement
 * about which routes exist in this build, and an operator toggling it would be
 * able to make the UI claim a page that still 404s. The day a public route
 * ships it ships in the same deploy as this constant.
 */
export const PUBLIC_PROFILE_ROUTE_AVAILABLE = false;

/**
 * Whether a human reviews portfolio images.
 *
 * FALSE. `PortfolioModerationState` defaults to PENDING and nothing in the
 * codebase ever writes APPROVED — there is no reviewer queue, no admin route
 * and no automated check. Sprint 9B.22 does NOT add one: inventing an approval
 * workflow to make this screen look finished is exactly what the brief forbids,
 * and an auto-approve would publish unreviewed photos of customers' homes.
 */
export const MODERATION_REVIEW_AVAILABLE = false;

export type PreviewLang = 'en' | 'ar';

@Injectable()
export class ProviderPublicProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's own profile, exactly as a customer would receive it.
   *
   * Scoped by `userId` inside the query — the same ownership rule the portfolio
   * service uses. There is no route here that takes somebody else's id, so
   * there is nothing to forge.
   */
  async preview(userId: string, lang: PreviewLang): Promise<ProviderPublicProfilePreviewResponse> {
    const profile = await this.prisma.client.providerProfile.findFirst({
      where: { userId, deletedAt: null },
      // NAMED, never a bare model read. A `findFirst` without a select returns
      // every column — phone number, coordinates, review notes — and the only
      // thing standing between that and the response would be this file
      // remembering not to spread it.
      select: {
        id: true,
        displayName: true,
        initials: true,
        avatarUrl: true,
        profileImageUrl: true,
        headline: true,
        bio: true,
        serviceAreaCity: true,
        serviceAreaCountry: true,
        ratingAvg: true,
        reviewCount: true,
        completedJobs: true,
        verified: true,
        serviceCategories: {
          select: {
            serviceCategory: { select: { labelEn: true, labelAr: true, isLeaf: true } },
          },
        },
      },
    });
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }

    // APPROVED only. The gallery the provider edits shows everything they
    // uploaded; this shows what a customer can see, which today is nothing —
    // and the count below is how the screen explains that honestly.
    const [approved, awaitingReviewCount] = await Promise.all([
      this.prisma.client.providerPortfolioItem.findMany({
        where: {
          providerProfileId: profile.id,
          deletedAt: null,
          moderationState: 'APPROVED',
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          title: true,
          description: true,
          mediaAsset: { select: { storageKey: true, visibility: true } },
        },
      }),
      this.prisma.client.providerPortfolioItem.count({
        where: {
          providerProfileId: profile.id,
          deletedAt: null,
          moderationState: 'PENDING',
        },
      }),
    ]);

    const portfolio: PublicPortfolioImage[] = approved
      // Belt and braces on the boundary that matters most. An item should never
      // reference a RESTRICTED asset — portfolio-policy.ts refuses that at
      // write time, on the storage key — but this is the read that would
      // publish it if one ever existed, so it checks again rather than
      // trusting a column written by code somewhere else.
      .filter((item) => item.mediaAsset.visibility === 'PUBLIC')
      .map((item) => ({
        url: publicUrlFor(item.mediaAsset.storageKey),
        title: item.title,
        description: item.description,
      }));

    const services = profile.serviceCategories
      .map((held) => held.serviceCategory)
      .filter((category) => category.isLeaf)
      .map((category) => (lang === 'ar' ? category.labelAr : category.labelEn))
      .filter((label): label is string => typeof label === 'string' && label.trim() !== '');

    return {
      profile: buildPublicProfile({
        displayName: profile.displayName,
        initials: profile.initials,
        // The onboarding photo is what Task 1 writes; `avatarUrl` is the older
        // column. Preferring the newer one keeps the preview showing the
        // picture the provider actually uploaded.
        avatarUrl: profile.profileImageUrl ?? profile.avatarUrl,
        headline: profile.headline,
        bio: profile.bio,
        serviceAreaCity: profile.serviceAreaCity,
        serviceAreaCountry: profile.serviceAreaCountry,
        ratingAvg: profile.ratingAvg,
        reviewCount: profile.reviewCount,
        completedJobs: profile.completedJobs,
        verified: profile.verified,
        approvedPortfolio: portfolio,
        approvedServices: services,
      }),
      awaitingReviewCount,
      publicProfileRouteAvailable: PUBLIC_PROFILE_ROUTE_AVAILABLE,
      moderationReviewAvailable: MODERATION_REVIEW_AVAILABLE,
    };
  }
}

/** The same public read path the portfolio service composes. Duplicated as one
 *  line rather than imported across a module boundary; the drift test in
 *  public-profile-projection.spec.ts asserts the two agree. */
function publicUrlFor(storageKey: string): string {
  return `/v1/media/files/${storageKey}`;
}
