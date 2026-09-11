// Sprint 09B.29 Phase 5 (C2) — the markets a provider may choose from.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.8
//
// WHY A SANITIZED PROJECTION RATHER THAN THE SETTING
//
// The operator's registry lives in a `PlatformSetting` row, and that row is
// operator configuration: it carries disabled markets, an audit trail, and
// whatever fields a future policy adds. None of that is the provider's
// business, and shipping the raw JSON would make every later addition to the
// setting an unreviewed disclosure.
//
// So this is a deliberate, additive projection of exactly what the onboarding
// UI needs to render a picker and explain a radius. Adding a field here is a
// decision someone has to make on purpose.
//
// WHAT IS ABSENT, AND ON PURPOSE
//
//   · disabled markets            a provider cannot choose one, so naming them
//                                 only tells a stranger where the platform is
//                                 about to launch
//   · the setting's audit fields  who changed the registry and when is an
//                                 operator question
//   · resolver/vendor config      never leaves the server
//   · internal ids                the country code IS the identifier

/** One market the provider may select. */
export interface SupportedMarketView {
  /** ISO 3166-1 alpha-2, uppercase. The identifier and the value persisted. */
  countryCode: string;
  /**
   * The i18n key for the country's name — never a rendered name.
   *
   * The server does not know which language the reader wants, and a country's
   * name differs between Arabic and English. Sending a key keeps the choice
   * where the locale is known, and keeps EN and AR genuinely equal rather than
   * one being a translation of the other.
   */
  displayNameKey: string;
  /**
   * The radius bounds and starting suggestion for this market, in kilometres.
   *
   * Sent so the picker can explain what choosing a market means before the
   * provider commits to it. Still enforced server-side on every write — this
   * is an explanation, not a contract the client may rely on for validation.
   */
  radius: {
    minKm: number;
    maxKm: number;
    /** What a provider in this market starts with when they have not chosen a
     *  transport mode yet. */
    defaultKm: number;
  };
  /**
   * How this market's timezone will be decided (C3).
   *
   * `RESOLVED` means the market has one unambiguous zone and the provider will
   * never be asked. `ASK` means it spans several and a focused question is
   * coming. The client renders the difference; it does not decide it.
   */
  timezone: { kind: 'RESOLVED'; id: string } | { kind: 'ASK' };
}

/** `GET /v1/me/provider/onboarding/markets`. */
export interface ProviderSupportedMarketsResponse {
  /**
   * Enabled markets, in the operator's own configured order.
   *
   * Never alphabetical: the server cannot localise a country name, so the only
   * ordering it can honour is the one the operator chose.
   */
  markets: SupportedMarketView[];
  /**
   * The market currently persisted against this provider, if any.
   *
   * Present so the picker can show the current selection without the client
   * having to correlate two responses — and so a market that has since been
   * DISABLED is visibly absent from `markets` while still being reported here.
   * That combination is exactly the "we have withdrawn from your market" case,
   * and the UI needs both halves to explain it.
   */
  selectedCountryCode: string | null;
  /**
   * Whether the server can turn coordinates into a country right now.
   *
   * False when no reverse-geocoding vendor is configured, which is the shipped
   * default. The client shows "Use my location" only when this is true — a
   * control that cannot work is worse than an absent one — and manual
   * selection is always available regardless.
   */
  locationSuggestionAvailable: boolean;
}
