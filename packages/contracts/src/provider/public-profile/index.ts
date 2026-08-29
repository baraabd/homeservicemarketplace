// Sprint 9B.22 — what a CUSTOMER may see of a provider.
//
// docs/sprint-09b22/PUBLIC_PROFILE_AND_PORTFOLIO.md
//
// THIS TYPE IS THE ALLOWLIST.
//
// Not a filter applied to a bigger object — a separate shape that has nowhere
// to put the things a customer must never receive. A phone number cannot leak
// through a field that does not exist, and a reviewer can check the guarantee
// by reading thirty lines instead of auditing every query that ever touches a
// provider row.
//
// WHAT IS DELIBERATELY ABSENT, and why each one would be a breach:
//
//   phoneNumber, email          — contact details. The marketplace introduces
//                                 people through the platform; a profile that
//                                 hands out a number bypasses every protection
//                                 that exists around that introduction.
//   userId, providerProfileId   — raw internal identifiers correlate a person
//                                 across every other surface that exposes one.
//                                 This shape carries NO identifier at all, and
//                                 needs none: the preview is served to the
//                                 provider who already owns it. A public route
//                                 will have to add an opaque handle — an HMAC
//                                 ref of the kind portfolio keys already use,
//                                 never the raw id.
//   serviceAreaLat/Lng          — exact coordinates. Sprint 9B.19 established
//                                 that a provider's base is usually their home.
//   workshopAddressLine         — an exact address, same reason.
//   serviceAreaRadiusKm         — how far someone travels is operational, and
//                                 combined with a city it narrows where they
//                                 are.
//   storageKey, mediaAssetId    — a storage key is a capability in this system.
//                                 Portfolio media is published as a URL and
//                                 nothing else.
//   verification evidence       — restricted media. It shares a table with
//                                 portfolio media and nothing else; see
//                                 portfolio-policy.ts.
//   moderationState             — an internal review state. A customer sees the
//                                 photos that passed, not the queue.
//
// NOTHING CONSUMES THIS PUBLICLY YET. There is no public provider-profile route
// on the platform today — every provider surface is `me/*`, `admin/*` or an
// authenticated `provider/*`. This projection exists so the preview a provider
// is shown is generated from the real public contract rather than from their
// private draft, and so the public route, when it ships, has one place to get
// its shape from rather than inventing a second one.

/** One published portfolio image, as a customer receives it. */
export interface PublicPortfolioImage {
  /** Absolute and renderable. No storage key, no asset id, no owner segment
   *  that means anything to anyone outside the server. */
  url: string;
  /** Provider-written, already length-bounded. Null when they gave none. */
  title: string | null;
  description: string | null;
}

/** The provider's own words about what they do. */
export interface PublicProfileAbout {
  /** The professional title, e.g. "Certified electrician". */
  headline: string | null;
  bio: string | null;
}

/** Where they work, at the granularity a customer is given. */
export interface PublicProfileArea {
  /** The city the provider named, as they wrote it. Never a district, never a
   *  street, never a coordinate. */
  city: string | null;
  /** Display name of the country, in the provider's own language. */
  country: string | null;
}

/** The reputation signals that already appear on a bid. Repeated here rather
 *  than referenced so this shape stays independently readable — it is the
 *  thing a reviewer checks. */
export interface PublicProfileStanding {
  ratingAvg: number;
  reviewCount: number;
  completedJobs: number;
  verified: boolean;
}

export interface ProviderPublicProfile {
  displayName: string;
  initials: string;
  /** The public avatar. Null when none was set. */
  avatarUrl: string | null;
  about: PublicProfileAbout;
  area: PublicProfileArea;
  standing: PublicProfileStanding;
  /** Only images that have PASSED review. An item awaiting moderation is not
   *  here, because it is not public. */
  portfolio: PublicPortfolioImage[];
  /** Leaf specialty labels the provider is APPROVED to work on, localised. A
   *  pending application is not a credential and does not appear. */
  services: string[];
}

/**
 * The preview response, which is the public projection PLUS the few facts a
 * provider needs in order to understand it.
 *
 * The extra fields are strictly ABOUT the preview — why something is missing —
 * and never additional provider data. Keeping them outside `profile` is what
 * lets a test assert that `profile` alone is the public shape.
 */
export interface ProviderPublicProfilePreviewResponse {
  profile: ProviderPublicProfile;
  /** Portfolio images uploaded but not yet visible to customers. A COUNT, not
   *  the items: the provider already sees them in their own gallery, and
   *  repeating them here would blur what "public" means on this screen. */
  awaitingReviewCount: number;
  /** True while the platform has no public provider-profile route at all — see
   *  the header. Served rather than hardcoded in the client so the day the
   *  route ships, the copy stops claiming otherwise without a web deploy. */
  publicProfileRouteAvailable: boolean;
  /** Whether a human review workflow exists for portfolio images. False today:
   *  nothing on the platform moves an item out of PENDING. The screen says so
   *  rather than implying a queue is being worked. */
  moderationReviewAvailable: boolean;
}
