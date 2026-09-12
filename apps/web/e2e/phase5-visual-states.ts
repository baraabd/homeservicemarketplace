// Sprint 09B.29 Phase 5 — the 18 approved journey states, as one typed registry.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
// docs/provider-experience-v2/PHASE5_BASELINE.md
//
// WHY A REGISTRY RATHER THAN EIGHTEEN HAND-WRITTEN TESTS
//
// Five separate gates need the same list — reference capture, application
// setup, pixel comparison, the responsive matrix, and the accessibility scan —
// and every earlier attempt at this in the repository drifted: a state got
// added to one list and forgotten in another, and the suite reported a green
// run over a state nobody was checking.
//
// So the list is declared ONCE, typed, and both exhaustiveness and uniqueness
// are enforced at module load. A missing index, a duplicate index, or an index
// outside 0..17 throws before any test body runs, which is the only kind of
// failure that cannot be mistaken for a passing suite.
//
// `referenceIndex` is the prototype's OWN `hsmScreens` index. It is the same
// number as `id` by construction — the registry is ordered by the prototype —
// but it is stored separately because the two are different facts: one names a
// row in this file, the other selects a screen in an immutable reference. If
// they ever diverge, the assertion below says so rather than silently
// capturing the wrong screen.

/** The prototype's own screen keys, in its own order. Copied from `hsmScreens`
 *  in the approved reference; used only for cross-checking, never for
 *  addressing the product. */
export const PROTOTYPE_SCREEN_KEYS = [
  'activate',
  'sync',
  'hub',
  'basics',
  'services',
  'experience',
  'area',
  'hours',
  'profile',
  'portfolio',
  'hubComplete',
  'review',
  'terms',
  'submitted',
  'waiting',
  'returned',
  'expired',
  'active',
] as const;

export type PrototypeScreenKey = (typeof PROTOTYPE_SCREEN_KEYS)[number];

/** Which lifecycle the server must be in for the state to be reachable. */
export type ServerPrecondition =
  | 'anonymous-customer'
  | 'customer-upgrading'
  | 'draft-partial'
  | 'draft-complete'
  | 'draft-submitted'
  | 'draft-returned'
  | 'session-expired'
  | 'provider-active';

/** Whether workspace navigation may be visible. The approved contract allows it
 *  in exactly one state, and asserting the negative everywhere else is what
 *  keeps that true. */
export type NavVisibility = 'hidden' | 'visible';

export interface Phase5State {
  /** 0..17, unique, exhaustive. */
  readonly id: number;
  /** Stable slug used in artifact paths. Never renamed once published. */
  readonly slug: string;
  /** Human name, for reports. */
  readonly name: string;
  /** The prototype screen this is measured against. */
  readonly referenceIndex: number;
  readonly referenceKey: PrototypeScreenKey;
  /** The product route that renders it. */
  readonly route: string;
  /** What the server must say before the route renders this state. */
  readonly precondition: ServerPrecondition;
  /** The selector that proves the state has finished rendering. Captures wait
   *  on this rather than on a timeout. */
  readonly readySelector: string;
  /** The one dominant action, for the single-primary-action assertion. */
  readonly primaryAction: string | null;
  /** Copy that must be present, in both languages, keyed by locale. */
  readonly requiredCopy: { readonly en: readonly string[]; readonly ar: readonly string[] };
  /** Which of the four axes this state is expected to state explicitly. */
  readonly axes: readonly ('onboarding' | 'standing' | 'verification' | 'workAccess')[];
  /** Workspace navigation expectation. */
  readonly nav: NavVisibility;
  /** Where the surface must be scrolled before capture. */
  readonly scroll: 'top' | 'bottom';
}

/**
 * The eighteen states.
 *
 * Several product routes carry more than one approved state — the services
 * task owns both `services` and `experience`, the public-profile task owns both
 * `profile` and `portfolio`, and the review task owns `review`, `terms` and
 * `submitted`. They are listed separately because the PROTOTYPE treats them as
 * separate screens and the gate compares against the prototype; collapsing them
 * would silently drop a reference screen from the comparison.
 */
export const PHASE5_STATES: readonly Phase5State[] = Object.freeze([
  {
    id: 0,
    slug: 'activation',
    name: 'Provider account activation',
    referenceIndex: 0,
    referenceKey: 'activate',
    route: '/provider/activate',
    precondition: 'anonymous-customer',
    readySelector: '[data-testid="activation-screen"]',
    primaryAction: 'provider-activate-submit',
    requiredCopy: {
      en: ['Turn your skills into work'],
      ar: ['حوّل خبرتك إلى فرص عمل'],
    },
    axes: [],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 1,
    slug: 'sync',
    name: 'Provider role and session synchronization',
    referenceIndex: 1,
    referenceKey: 'sync',
    route: '/provider/activate',
    precondition: 'customer-upgrading',
    readySelector: '[data-testid="activation-sync-screen"]',
    primaryAction: null,
    requiredCopy: {
      en: ['No sign-in needed'],
      ar: ['لا تسجّل الدخول من جديد'],
    },
    axes: [],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 2,
    slug: 'hub-partial',
    name: 'Six-task hub, partial progress',
    referenceIndex: 2,
    referenceKey: 'hub',
    route: '/provider/onboarding',
    precondition: 'draft-partial',
    readySelector: '[data-testid="hub-task-list"]',
    primaryAction: 'hub-primary-action',
    requiredCopy: {
      en: ['of 6 tasks complete'],
      ar: ['من 6 مهام مكتملة'],
    },
    axes: ['onboarding'],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 3,
    slug: 'basics',
    name: 'Basic details, photo, name and phone',
    referenceIndex: 3,
    referenceKey: 'basics',
    route: '/provider/onboarding/BASICS_IDENTITY',
    precondition: 'draft-partial',
    readySelector: '[data-testid="task-screen-BASICS_IDENTITY"]',
    primaryAction: 'task-save-and-continue',
    requiredCopy: {
      en: ['Customer-facing name'],
      ar: ['الاسم الذي يراه العملاء'],
    },
    axes: [],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 4,
    slug: 'services',
    name: 'Service search, selection and moderation disclosure',
    referenceIndex: 4,
    referenceKey: 'services',
    route: '/provider/onboarding/SERVICES_EXPERIENCE',
    precondition: 'draft-partial',
    readySelector: '[data-testid="services-task"]',
    primaryAction: 'task-continue-to-experience',
    requiredCopy: {
      en: ['Specialties are reviewed later'],
      ar: ['تُراجع التخصصات لاحقاً'],
    },
    axes: ['verification'],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 5,
    slug: 'experience',
    name: 'Experience stepper, transport and generated title',
    referenceIndex: 5,
    referenceKey: 'experience',
    route: '/provider/onboarding/SERVICES_EXPERIENCE#experience',
    precondition: 'draft-partial',
    readySelector: '[data-testid="experience-section"]',
    primaryAction: 'task-save-and-continue',
    requiredCopy: {
      en: ['Suggested title'],
      ar: ['المسمى المقترح'],
    },
    axes: [],
    nav: 'hidden',
    scroll: 'bottom',
  },
  {
    id: 6,
    slug: 'work-area',
    name: 'Work origin, automatic radius and reward',
    referenceIndex: 6,
    referenceKey: 'area',
    route: '/provider/onboarding/WORK_AREA',
    precondition: 'draft-partial',
    readySelector: '[data-testid="work-area-task"]',
    primaryAction: 'task-save-and-continue',
    requiredCopy: {
      en: ['Your starting range'],
      ar: ['نطاقك المبدئي'],
    },
    axes: [],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 7,
    slug: 'working-hours',
    name: 'Multi-day working hours editor',
    referenceIndex: 7,
    referenceKey: 'hours',
    route: '/provider/onboarding/WORKING_HOURS',
    precondition: 'draft-partial',
    readySelector: '[data-testid="availability-task"]',
    primaryAction: 'task-save-and-continue',
    requiredCopy: {
      en: ['Apply to selected days'],
      ar: ['تطبيق على الأيام المحددة'],
    },
    axes: [],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 8,
    slug: 'public-profile',
    name: 'Public profile bio and customer preview',
    referenceIndex: 8,
    referenceKey: 'profile',
    route: '/provider/onboarding/PORTFOLIO',
    precondition: 'draft-partial',
    readySelector: '[data-testid="public-profile-task"]',
    primaryAction: 'task-save-and-continue',
    requiredCopy: {
      en: ['What customers see'],
      ar: ['ما يراه العملاء'],
    },
    axes: [],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 9,
    slug: 'portfolio',
    name: 'Portfolio upload, cover, reorder and moderation',
    referenceIndex: 9,
    referenceKey: 'portfolio',
    route: '/provider/onboarding/PORTFOLIO#portfolio',
    precondition: 'draft-partial',
    readySelector: '[data-testid="portfolio-section"]',
    primaryAction: 'portfolio-add-photo',
    requiredCopy: {
      en: ['Cover'],
      ar: ['الغلاف'],
    },
    axes: ['verification'],
    nav: 'hidden',
    scroll: 'bottom',
  },
  {
    id: 10,
    slug: 'hub-complete',
    name: 'Completed hub with moderation separated',
    referenceIndex: 10,
    referenceKey: 'hubComplete',
    route: '/provider/onboarding',
    precondition: 'draft-complete',
    readySelector: '[data-testid="hub-task-list"]',
    primaryAction: 'hub-primary-action',
    requiredCopy: {
      en: ['6 of 6 tasks complete'],
      ar: ['6 من 6 مهام مكتملة'],
    },
    axes: ['onboarding', 'verification'],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 11,
    slug: 'review',
    name: 'Final review with correction deep links',
    referenceIndex: 11,
    referenceKey: 'review',
    route: '/provider/onboarding/REVIEW_SUBMISSION',
    precondition: 'draft-complete',
    readySelector: '[data-testid="review-screen"]',
    primaryAction: 'review-continue-to-consent',
    requiredCopy: {
      en: ['Review your application'],
      ar: ['راجع طلبك'],
    },
    axes: ['onboarding', 'verification'],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 12,
    slug: 'terms',
    name: 'Terms consent with sticky submission',
    referenceIndex: 12,
    referenceKey: 'terms',
    route: '/provider/onboarding/REVIEW_SUBMISSION#terms',
    precondition: 'draft-complete',
    readySelector: '[data-testid="terms-section"]',
    primaryAction: 'review-submit',
    requiredCopy: {
      en: ['I agree'],
      ar: ['أوافق'],
    },
    axes: [],
    nav: 'hidden',
    scroll: 'bottom',
  },
  {
    id: 13,
    slug: 'submitted',
    name: 'Submission confirmation and timeline',
    referenceIndex: 13,
    referenceKey: 'submitted',
    route: '/provider/onboarding/REVIEW_SUBMISSION',
    precondition: 'draft-submitted',
    readySelector: '[data-testid="review-submitted"]',
    primaryAction: null,
    requiredCopy: {
      en: ['does not give you access'],
      ar: ['لا يمنحك ذلك الوصول'],
    },
    axes: ['onboarding'],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 14,
    slug: 'status-centre',
    name: 'Status centre with four independent axes',
    referenceIndex: 14,
    referenceKey: 'waiting',
    route: '/provider/status',
    precondition: 'draft-submitted',
    readySelector: '[data-testid="provider-status-axes"]',
    primaryAction: null,
    requiredCopy: {
      en: ['Work access'],
      ar: ['الوصول إلى العمل'],
    },
    axes: ['onboarding', 'standing', 'verification', 'workAccess'],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 15,
    slug: 'returned',
    name: 'Returned / action required recovery',
    referenceIndex: 15,
    referenceKey: 'returned',
    route: '/provider/onboarding',
    precondition: 'draft-returned',
    readySelector: '[data-testid="onboarding-returned"]',
    primaryAction: 'returned-complete-now',
    requiredCopy: {
      en: ['Action required'],
      ar: ['إجراء مطلوب'],
    },
    axes: ['onboarding'],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 16,
    slug: 'session-expired',
    name: 'Genuine 401 session expired',
    referenceIndex: 16,
    referenceKey: 'expired',
    route: '/provider/onboarding',
    precondition: 'session-expired',
    readySelector: '[data-testid="session-expired"]',
    primaryAction: 'session-expired-sign-in',
    requiredCopy: {
      en: ['Session expired'],
      ar: ['انتهت الجلسة'],
    },
    axes: [],
    nav: 'hidden',
    scroll: 'top',
  },
  {
    id: 17,
    slug: 'active-handoff',
    name: 'Active provider, workspace unlocked',
    referenceIndex: 17,
    referenceKey: 'active',
    route: '/provider/status',
    precondition: 'provider-active',
    readySelector: '[data-testid="provider-workspace-unlocked"]',
    primaryAction: 'workspace-enter',
    requiredCopy: {
      en: ['Your account is active'],
      ar: ['تم تفعيل حسابك'],
    },
    axes: ['onboarding', 'standing', 'verification', 'workAccess'],
    nav: 'visible',
    scroll: 'top',
  },
]);

/** The two product languages, which are equal experiences rather than a base
 *  and a translation. */
export const PHASE5_LOCALES = ['en', 'ar'] as const;
export type Phase5Locale = (typeof PHASE5_LOCALES)[number];

/** The canonical design viewport. Pixel parity is asserted here and only here,
 *  because it is the only width at which the frozen prototype supplies
 *  geometrically valid reference content. */
export const CANONICAL_VIEWPORT = { width: 390, height: 844 } as const;

/**
 * The responsive acceptance widths.
 *
 * The three above 640 are STRUCTURAL checks, not pixel comparisons: the
 * prototype has no genuine wide rendering (conflict C4), so a baseline there
 * would be invented rather than approved.
 */
export const PHASE5_VIEWPORTS = Object.freeze([
  { name: '320x568', width: 320, height: 568, mode: 'pixel' },
  { name: '390x844', width: 390, height: 844, mode: 'pixel' },
  { name: '430x932', width: 430, height: 932, mode: 'structural' },
  { name: '768x1024', width: 768, height: 1024, mode: 'structural' },
  { name: '1024x768', width: 1024, height: 768, mode: 'structural' },
  { name: '1440x900', width: 1440, height: 900, mode: 'structural' },
] as const);

export type Phase5Viewport = (typeof PHASE5_VIEWPORTS)[number];

/** The width at or above which the surface becomes a centred focused column. */
export const FOCUSED_COLUMN_BREAKPOINT = 640;
/** The maximum width of that column. The approved contract, not a tolerance. */
export const FOCUSED_COLUMN_MAX_WIDTH = 480;

/** The individual per-comparison ceiling. An average would let one broken state
 *  hide behind seventeen good ones, so this is applied per cell. */
export const MAX_DIFF_PIXEL_RATIO = 0.005;

// ── load-time guards ───────────────────────────────────────────────────────
//
// These run when the module is imported, so a registry mistake fails before any
// test body executes. A typecheck alone would not catch a duplicated literal
// index or an id that disagrees with its position.

(function assertRegistryIsExhaustiveAndUnique(): void {
  const ids = PHASE5_STATES.map((s) => s.id);
  const unique = new Set(ids);

  if (PHASE5_STATES.length !== 18) {
    throw new Error(`Phase 5 registry must hold exactly 18 states, found ${PHASE5_STATES.length}`);
  }
  if (unique.size !== ids.length) {
    const seen = new Set<number>();
    const dupes = ids.filter((i) => (seen.has(i) ? true : (seen.add(i), false)));
    throw new Error(`Phase 5 registry has duplicate ids: ${[...new Set(dupes)].join(', ')}`);
  }
  for (let i = 0; i < 18; i += 1) {
    if (!unique.has(i)) throw new Error(`Phase 5 registry is missing state id ${i}`);
  }

  for (const s of PHASE5_STATES) {
    if (s.referenceIndex !== s.id) {
      throw new Error(
        `state ${s.id} (${s.slug}) claims reference index ${s.referenceIndex}; the registry is ordered by the prototype so these must agree`,
      );
    }
    if (PROTOTYPE_SCREEN_KEYS[s.referenceIndex] !== s.referenceKey) {
      throw new Error(
        `state ${s.id} (${s.slug}) names reference key "${s.referenceKey}" but prototype index ${s.referenceIndex} is "${PROTOTYPE_SCREEN_KEYS[s.referenceIndex]}"`,
      );
    }
  }

  const slugs = new Set(PHASE5_STATES.map((s) => s.slug));
  if (slugs.size !== PHASE5_STATES.length) {
    throw new Error('Phase 5 registry has duplicate slugs; artifact paths would collide');
  }

  // Exactly one state may show workspace navigation. This is a product rule,
  // not a preference, and it is asserted here so that a later edit adding a
  // second `visible` fails at import rather than in a screenshot review.
  const navVisible = PHASE5_STATES.filter((s) => s.nav === 'visible');
  if (navVisible.length !== 1 || navVisible[0].id !== 17) {
    throw new Error(
      `exactly one state (17, active handoff) may show workspace navigation; found ${navVisible.map((s) => s.id).join(', ') || 'none'}`,
    );
  }
})();

/** Look a state up by id, with a real error rather than `undefined`. */
export function stateById(id: number): Phase5State {
  const found = PHASE5_STATES.find((s) => s.id === id);
  if (!found) throw new Error(`no Phase 5 state with id ${id}`);
  return found;
}

/** The 36 canonical pixel-parity cells: 18 states × 2 languages. */
export function canonicalCells(): { state: Phase5State; locale: Phase5Locale }[] {
  return PHASE5_STATES.flatMap((state) => PHASE5_LOCALES.map((locale) => ({ state, locale })));
}

/** The full 216-record responsive matrix: 18 × 2 × 6. */
export function responsiveCells(): {
  state: Phase5State;
  locale: Phase5Locale;
  viewport: Phase5Viewport;
}[] {
  return PHASE5_STATES.flatMap((state) =>
    PHASE5_LOCALES.flatMap((locale) =>
      PHASE5_VIEWPORTS.map((viewport) => ({ state, locale, viewport })),
    ),
  );
}
