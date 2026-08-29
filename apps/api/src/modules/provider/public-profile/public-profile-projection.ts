import type {
  ProviderPublicProfile,
  PublicPortfolioImage,
} from '@homeservicemarketplace/contracts';

// Sprint 9B.22 — the one place that decides what a customer may see.
//
// docs/sprint-09b22/PUBLIC_PROFILE_AND_PORTFOLIO.md
//
// PURE, AND NARROW ON PURPOSE.
//
// The obvious way to write this is to take a ProviderProfile row and pick
// fields off it. That version is one careless spread away from publishing a
// phone number, and every reviewer has to re-derive the guarantee by reading
// the whole function.
//
// So the INPUT is an allowlist too. `PublicProfileSource` below cannot carry a
// phone number, a coordinate, a storage key or a user id, because it has no
// field for one. A caller that wants to leak something has to change this file
// and a reviewer only has to read it — which is the difference between a rule
// and a habit.
//
// The other half of the guarantee is `ProviderPublicProfile` itself, in the
// contracts package: it has nowhere to put those things either. Two narrow
// types with a pure function between them is the whole design.

/** Exactly the facts the projection is allowed to read. Nothing else may be
 *  passed in, so nothing else can come out. */
export interface PublicProfileSource {
  displayName: string;
  initials: string;
  /** The PUBLIC avatar url. Never an evidence key — see avatar-policy.ts. */
  avatarUrl: string | null;
  headline: string | null;
  bio: string | null;
  /** As the provider wrote it. A city, never a district or a street. */
  serviceAreaCity: string | null;
  /** Display name in the provider's language, never the ISO code — the code is
   *  a lookup key, and publishing both says the same thing twice. */
  serviceAreaCountry: string | null;
  ratingAvg: number;
  reviewCount: number;
  completedJobs: number;
  verified: boolean;
  /** ALREADY filtered to approved-and-public by the caller. The filtering is
   *  the caller's job because it is a query; keeping it out of here is what
   *  lets the projection stay pure and exhaustively testable. */
  approvedPortfolio: readonly PublicPortfolioImage[];
  /** Localised leaf labels for specialties the provider is APPROVED on. A
   *  pending application is not a credential. */
  approvedServices: readonly string[];
}

/**
 * Build the customer-facing profile.
 *
 * Every field is copied explicitly. No spread, anywhere — a spread is how a
 * column added to the source type three months from now publishes itself.
 */
export function buildPublicProfile(source: PublicProfileSource): ProviderPublicProfile {
  return {
    displayName: source.displayName,
    initials: source.initials,
    avatarUrl: source.avatarUrl,
    about: {
      headline: emptyToNull(source.headline),
      bio: emptyToNull(source.bio),
    },
    area: {
      city: emptyToNull(source.serviceAreaCity),
      country: emptyToNull(source.serviceAreaCountry),
    },
    standing: {
      // Rounded to the precision the product displays. An un-rounded float is
      // a fingerprint: 4.833333333333333 distinguishes a provider far more
      // precisely than "4.8" does, and nothing public needs the extra digits.
      ratingAvg: Math.round(source.ratingAvg * 10) / 10,
      reviewCount: source.reviewCount,
      completedJobs: source.completedJobs,
      verified: source.verified,
    },
    portfolio: source.approvedPortfolio.map(
      (image): PublicPortfolioImage => ({
        url: image.url,
        title: emptyToNull(image.title),
        description: emptyToNull(image.description),
      }),
    ),
    services: [...source.approvedServices],
  };
}

/** A blank string is not a value a customer should see rendered as an empty
 *  line. Absent and blank mean the same thing here, so they are stored
 *  differently and published identically. */
function emptyToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
