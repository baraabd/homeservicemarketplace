import type { Page, Route } from '@playwright/test';

import type { Locale } from './phase5-evidence-ledger';
import type { Phase5State, ServerPrecondition } from './phase5-visual-states';

// Sprint 09B.29 Phase 5A — the APPLICATION half of the visual gate.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHAT THIS IS ALLOWED TO BE, AND WHAT IT IS NOT
//
// It is a stub layer, and it is honest about that. The evidence it helps
// produce is filed under `PROVISIONAL_UI` — a namespace the ledger keeps
// strictly separate from `FINAL_REAL_API`, and which can never be promoted
// into it. Presentation credit asks "does the approved screen render"; route
// and persistence credit ask "did a real server answer", and no amount of
// stubbing here can earn either. That separation is the reason stubbing is
// acceptable at this layer at all.
//
// The preconditions are the registry's own eight lifecycle states, expressed
// as the responses a server in that state would give. Nothing invents a
// client-side state machine: every screen still reads its own truth from these
// responses through the same hooks it uses in production.

const FLAG_KEY = 'hsm.ff.providerOnboardingV2';

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// ── Identities ──────────────────────────────────────────────────────────────

const CUSTOMER_ME = {
  id: 'u-phase5',
  email: 'phase5@example.com',
  firstName: 'Ahmad',
  lastName: 'Fatal',
  status: 'ACTIVE',
  emailVerifiedAt: '2026-08-01T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer'],
};

const PROVIDER_ME = { ...CUSTOMER_ME, roles: ['customer', 'provider'] };

/** The profile row, at whatever lifecycle status the precondition names. */
const profileAt = (status: string) => ({
  profile: {
    id: 'pp-phase5',
    displayName: 'Ahmad Fatal',
    initials: 'AF',
    avatarUrl: null,
    bio: null,
    headline: null,
    phoneNumber: '0936706600',
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: status === 'ACTIVE',
    topPro: false,
    availability: 'OFFLINE',
    status,
    serviceAreaCity: 'Aleppo',
    serviceAreaCountry: 'Syria',
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: 15,
    serviceCategories: [],
    // The moderator's queue, which is its OWN axis. The approved status centre
    // shows "Specialty review: In review" beside a completed application, and
    // that row is this field rather than anything about the application.
    pendingCategories: status === 'PENDING_REVIEW' ? ['sp-interior'] : [],
    // The SERVER's record of when it was handed in. Only the submitted
    // lifecycle has one, and the confirmation screen omits the line rather
    // than inventing a time when it does not.
    submittedForReviewAt: status === 'PENDING_REVIEW' ? SUBMITTED_AT : null,
    reviewedAt: null,
    // The operator's note on a returned application, which the approved
    // action-required screen carries verbatim as its heading.
    rejectionReason: null as string | null,
    createdAt: '2026-08-01T00:00:00.000Z',
    // The status centre's header prints "Updated today at 12:43", from this.
    // Computed for the same reason `SUBMITTED_AT` is: a fixed literal would
    // make "today" false on every day but one.
    updatedAt: status === 'PENDING_REVIEW' ? todayAt('UTC', '12:43') : '2026-08-01T00:00:00.000Z',
  },
});

// ── The hub ─────────────────────────────────────────────────────────────────

/**
 * The six tasks, with the statuses the approved screen shows.
 *
 * The prototype's partial hub (screen 2) has Basic details COMPLETE and the
 * rest to do; its complete hub (screen 10) has everything done except the two
 * axes that are genuinely still in review. Those are SERVER facts, so they are
 * expressed here as server responses rather than as props.
 */
const task = (id: string, group: string, status: string, title: string, description: string) => ({
  id,
  group,
  status,
  title,
  description,
});

const HUB_TASKS_PARTIAL = [
  task('BASICS_IDENTITY', 'BASICS', 'COMPLETE', 'Basic details', 'Name, phone and photo'),
  task(
    'SERVICES_EXPERIENCE',
    'SERVICES',
    'AVAILABLE',
    'Services and experience',
    'Specialty, experience and transport',
  ),
  task('WORK_AREA', 'COVERAGE', 'AVAILABLE', 'Work area', 'Starting point and coverage'),
  task('WORKING_HOURS', 'COVERAGE', 'AVAILABLE', 'Working hours', 'Available days and time ranges'),
  task('PORTFOLIO', 'PROFILE', 'AVAILABLE', 'Bio and portfolio', 'What customers see'),
  task(
    'REVIEW_SUBMISSION',
    'REVIEW',
    'BLOCKED',
    'Review and submission',
    'Confirm details and terms',
  ),
];

const HUB_TASKS_COMPLETE = [
  task('BASICS_IDENTITY', 'BASICS', 'COMPLETE', 'Basic details', 'Name, phone and photo'),
  task('SERVICES_EXPERIENCE', 'SERVICES', 'WAITING', 'Services and experience', 'Selections saved'),
  task('WORK_AREA', 'COVERAGE', 'COMPLETE', 'Work area', 'Aleppo • 15 km'),
  task('WORKING_HOURS', 'COVERAGE', 'COMPLETE', 'Working hours', 'Sunday–Thursday • 09:00–17:00'),
  task('PORTFOLIO', 'PROFILE', 'WAITING', 'Bio and portfolio', '3 photos uploaded'),
  task('REVIEW_SUBMISSION', 'REVIEW', 'AVAILABLE', 'Review and submission', 'Ready to review'),
];

const hub = (over: Record<string, unknown> = {}) => ({
  tasks: HUB_TASKS_PARTIAL,
  progress: { complete: 1, total: 6 },
  nextAction: { kind: 'COMPLETE_TASK', taskId: 'SERVICES_EXPERIENCE' },
  status: 'DRAFT',
  ...over,
});

// ── The draft ───────────────────────────────────────────────────────────────

/**
 * The application, populated as the approved screens show it.
 *
 * The values are the prototype's own — Ahmad Fatal, 14 years, a car, Aleppo /
 * Al-Furqan, 15 km, Sunday–Thursday 09:00–17:00 — because the comparison is
 * against a picture that contains those strings. Using different content would
 * fail every cell on text the design never claimed to specify.
 */
const DRAFT_DATA = {
  providerType: 'INDIVIDUAL',
  legalBusinessName: null,
  displayName: 'Ahmad Fatal',
  profileImageUrl: null,
  phoneNumber: '0936706600',
  phoneVerified: false,

  serviceAreaCity: 'Aleppo, Al-Furqan', // replaced per locale — see localised()
  serviceAreaCountry: 'Syria',
  serviceAreaCountryCode: 'SY',
  serviceAreaLat: null,
  serviceAreaLng: null,
  serviceAreaRadiusKm: 15,
  serviceAreaIds: [],
  workshopAddressLine: null,
  workshopLat: null,
  workshopLng: null,

  primaryGroupIds: ['grp-painting'],
  specialtyLeafIds: ['sp-interior', 'sp-exterior'],
  pendingSpecialtyIds: ['sp-interior'],
  // The two the approved services screen shows selected, with the states the
  // approved screen's own alert describes: one still in moderation, one
  // already approved. Both are provider-chosen either way.
  specialties: [
    {
      categoryId: 'sp-interior',
      state: 'PENDING',
      labelEn: 'Interior painting',
      labelAr: 'دهانات داخلية',
      parentId: 'grp-painting',
      decidedAt: null,
    },
    {
      categoryId: 'sp-exterior',
      state: 'APPROVED',
      labelEn: 'Exterior painting',
      labelAr: 'دهانات خارجية',
      parentId: 'grp-painting',
      decidedAt: null,
    },
  ],
  primarySpecialtyId: 'sp-interior',
  maxSpecialties: 5,

  radiusPolicy: { suggestedKm: 15, minKm: 3, maxKm: 25, basedOn: 'CAR' },
  serviceAreaExpansion: {
    show: true,
    allowedMaxKm: 15,
    baseMaxKm: 15,
    currentTier: null,
    nextTier: { key: 'tier-2', maxKm: 25 },
    // The criterion the approved reward sentence names. Its target is
    // PUBLISHED; the anti-abuse thresholds withhold theirs on purpose, which
    // is why the sentence is composed from this one and not from all of them.
    progress: [
      { key: 'RATING_SAMPLE', met: false, progress: 0, current: 0, target: 3, published: true },
    ],
    reasonCodes: [],
    policyVersion: 'ladder-1',
  },

  resolvedTimezone: {
    resolved: 'Asia/Damascus',
    display: { city: 'Damascus', offset: '+03:00' },
    needsConfirmation: false,
  },
  suggestedTitle: { en: 'Painting professional', ar: 'فني دهانات' },

  yearsOfExperience: 14,
  // The stored fact is a DATE, and the screen derives the years from it, so
  // the reference's "14" has to be expressed as the year that yields it.
  professionSince: `${new Date().getUTCFullYear() - 14}-01-01T00:00:00.000Z`,
  equipmentCodes: ['LADDER', 'SPRAYER'],
  transportMode: 'CAR',
  transportModes: ['CAR', 'PUBLIC_TRANSPORT'],

  // Sunday-Thursday, 09:00-17:00 — the week the approved screens show.
  // `dayOfWeek` is the contract's field and 0 is Sunday, matching
  // `Date#getDay()`; a named day here would simply never match.
  availability: [0, 1, 2, 3, 4].map((dayOfWeek) => ({
    id: `av-${dayOfWeek}`,
    dayOfWeek,
    startMinute: 540,
    endMinute: 1020,
    timezone: 'Asia/Damascus',
  })),
  timezone: 'Asia/Damascus',

  headline: 'Painting professional',
  bio: 'Painting professional with 14 years of experience. I arrive on time and keep the work area clean.',
  additionalInformation: null,

  acceptedConsentVersion: null,
  consentAcceptedAt: null,
};

/**
 * The free text the PROVIDER wrote, in the language they wrote it in.
 *
 * The approved reference is captured twice, and its Arabic screens show an
 * Arabic provider: an Arabic bio, an Arabic city. That is not a translation of
 * the English capture — the draft carries ONE bio, because a provider writes
 * one — it is a different provider's data, which is what the reference depicts.
 *
 * Supplying English prose to the Arabic cell compared the right screen against
 * the wrong content: it happened to stay under the ratio on the shorter
 * screens, which is a false pass waiting to become a real one.
 */
/**
 * The note an operator left on a returned application, per language.
 *
 * On the profile rather than the draft, because that is where the server keeps
 * it — and localised here for the same reason the city and the bio are: the
 * approved Arabic screen contains Arabic words, and comparing an English
 * sentence against it would pass or fail for reasons that have nothing to do
 * with the layout under test.
 */
const RETURN_REASON = {
  en: 'Replace the first work photo. The photo is unclear.',
  ar: 'استبدل صورة العمل الأولى. الصورة غير واضحة.',
} as const;

const LOCALISED = {
  en: {
    serviceAreaCity: 'Aleppo, Al-Furqan',
    bio: 'Painting professional with 14 years of experience. I arrive on time and keep the work area clean.',
  },
  ar: {
    serviceAreaCity: 'حلب، الفرقان',
    bio: 'فني دهانات بخبرة 14 عاماً. ألتزم بالمواعيد وأحافظ على نظافة المكان أثناء العمل.',
  },
} as const;

const draft = (over: Record<string, unknown> = {}) => ({
  state: 'DRAFT',
  currentStep: 'LOCATION',
  steps: [],
  completedSteps: [],
  percentComplete: 50,
  nextAction: { kind: 'COMPLETE_STEP', step: 'LOCATION' },
  complete: false,
  missing: [],
  version: 7,
  policyVersion: 'sprint-09b',
  lastSavedAt: '2026-09-01T12:42:00.000Z',
  editable: true,
  ...over,
  data: { ...DRAFT_DATA, ...((over.data as Record<string, unknown>) ?? {}) },
});

/**
 * The approved services list.
 *
 * One organisational group and four selectable leaves, in the reference's own
 * order. `isLeaf` is a server fact the picker READS rather than derives, so the
 * group is explicitly not a leaf.
 */
const SERVICE_CATALOGUE = [
  {
    id: 'grp-painting',
    slug: 'painting',
    labelEn: 'Painting',
    labelAr: 'الدهانات',
    icon: 'paintbrush',
    sortOrder: 1,
    parentId: null,
    isLeaf: false,
  },
  ...[
    ['sp-interior', 'interior-painting', 'Interior painting', 'دهانات داخلية'],
    ['sp-exterior', 'exterior-painting', 'Exterior painting', 'دهانات خارجية'],
    ['sp-wall-repair', 'wall-repair', 'Wall repair', 'ترميم الجدران'],
    ['sp-post-paint', 'post-paint-cleaning', 'Post-paint cleaning', 'تنظيف بعد الدهان'],
  ].map(([id, slug, labelEn, labelAr], i) => ({
    id,
    slug,
    labelEn,
    labelAr,
    icon: 'paintbrush',
    sortOrder: i + 2,
    parentId: 'grp-painting',
    isLeaf: true,
  })),
];

/**
 * The instant whose wall clock, in the PROVIDER's own zone, is today at 12:43.
 *
 * The approved confirmation screen reads "Today • 12:43", and the product
 * formats `submittedForReviewAt` in the provider's timezone rather than the
 * browser's — so a fixed UTC literal would render three hours out in Aleppo and
 * "Today" would be a lie on any day but the one the literal names.
 *
 * Computed rather than hard-coded for exactly that reason: the fixture has to
 * describe a server whose stored timestamp produces the sentence the reference
 * depicts, on whichever day the gate happens to run.
 */
function todayAt(zone: string, hhmm: string): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  // Read the naive instant back in the zone, and correct by the difference.
  // One pass is exact except across a DST transition, which 12:43 is not.
  const naive = new Date(`${ymd}T${hhmm}:00.000Z`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(naive);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  const shown = Date.parse(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`,
  );
  return new Date(naive.getTime() - (shown - naive.getTime())).toISOString();
}

const SUBMITTED_AT = todayAt('Asia/Damascus', '12:43');

/**
 * The review read-model, which is a PROJECTION of server policy and is treated
 * as one here: readiness, the blocker and the terms version all come from the
 * fixture, and the screens under test render them without re-deriving anything.
 *
 * `groups` is empty because the approved reference depicts a READY application.
 * The group rendering is still live — it is what a blocked one shows — and the
 * unit suite is where that is exercised, because there is no reference image of
 * it to measure against.
 */
const review = (over: Record<string, unknown> = {}) => ({
  groups: [],
  canSubmit: true,
  blockedReason: null,
  terms: {
    version: 'sprint-09b',
    locale: 'en',
    accepted: true,
    acceptedVersion: 'sprint-09b',
    acceptedAt: SUBMITTED_AT,
  },
  draftVersion: 7,
  lifecycleState: 'DRAFT',
  canWithdraw: false,
  ...over,
});

// ── Preconditions ───────────────────────────────────────────────────────────

export interface PreconditionFixture {
  readonly me: Record<string, unknown> | null;
  /** `null` means the profile endpoint answers 404 — no provider row exists. */
  readonly profile: Record<string, unknown> | null;
  readonly hub: Record<string, unknown>;
  readonly draft: Record<string, unknown>;
  /** The review read-model. Only the three review screens read it. */
  readonly review: Record<string, unknown>;
  /** Hold the session probe open, so a transient screen stays on display. */
  readonly stallSessionRefresh?: boolean;
  /** Answer every onboarding read with 401, for the expired-session screen. */
  readonly unauthorized?: boolean;
}

const COMPLETE_DRAFT = draft({
  state: 'DRAFT',
  currentStep: 'REVIEW',
  percentComplete: 100,
  complete: true,
  nextAction: { kind: 'SUBMIT' },
});

export const PRECONDITIONS: Readonly<Record<ServerPrecondition, PreconditionFixture>> =
  Object.freeze({
    'anonymous-customer': {
      review: review(),
      me: CUSTOMER_ME,
      profile: null,
      hub: hub(),
      draft: draft(),
    },
    'customer-upgrading': {
      review: review(),
      me: CUSTOMER_ME,
      profile: null,
      hub: hub(),
      draft: draft(),
      stallSessionRefresh: true,
    },
    'draft-partial': {
      review: review({ canSubmit: false, blockedReason: null }),
      me: PROVIDER_ME,
      profile: profileAt('DRAFT'),
      hub: hub(),
      draft: draft(),
    },
    'draft-complete': {
      review: review(),
      me: PROVIDER_ME,
      profile: profileAt('DRAFT'),
      hub: hub({
        tasks: HUB_TASKS_COMPLETE,
        progress: { complete: 6, total: 6 },
        nextAction: { kind: 'SUBMIT' },
      }),
      draft: COMPLETE_DRAFT,
    },
    'draft-submitted': {
      review: review({
        canSubmit: false,
        lifecycleState: 'SUBMITTED',
        canWithdraw: true,
      }),
      me: PROVIDER_ME,
      profile: profileAt('PENDING_REVIEW'),
      hub: hub({
        tasks: HUB_TASKS_COMPLETE,
        progress: { complete: 6, total: 6 },
        nextAction: { kind: 'WAIT' },
        status: 'PENDING_REVIEW',
      }),
      draft: draft({
        state: 'SUBMITTED',
        percentComplete: 100,
        complete: true,
        editable: false,
        nextAction: { kind: 'WAIT' },
        submittedAt: '2026-09-01T12:43:00.000Z',
      }),
    },
    'draft-returned': {
      review: review({ canSubmit: false, lifecycleState: 'RETURNED' }),
      me: PROVIDER_ME,
      profile: profileAt('REJECTED'),
      hub: hub({
        tasks: HUB_TASKS_COMPLETE.map((t) =>
          t.id === 'PORTFOLIO' ? { ...t, status: 'AVAILABLE' } : t,
        ),
        progress: { complete: 5, total: 6 },
        nextAction: { kind: 'COMPLETE_TASK', taskId: 'PORTFOLIO' },
        // The contract's own word. 'RETURNED' is the DRAFT lifecycle's name for
        // this; the hub calls the same fact ACTION_REQUIRED, and a value outside
        // the enum fell through `deriveHubView` to the ordinary hub — which
        // drew a task list with no explanation of why it had come back.
        status: 'ACTION_REQUIRED',
      }),
      draft: draft({
        state: 'RETURNED',
        percentComplete: 92,
        nextAction: { kind: 'COMPLETE_TASK', taskId: 'PORTFOLIO' },
      }),
    },
    'session-expired': {
      review: review(),
      me: PROVIDER_ME,
      profile: profileAt('DRAFT'),
      hub: hub(),
      draft: draft(),
      unauthorized: true,
    },
    'provider-active': {
      review: review({ canSubmit: false, lifecycleState: 'ACCEPTED' }),
      me: PROVIDER_ME,
      profile: profileAt('ACTIVE'),
      hub: hub({
        tasks: HUB_TASKS_COMPLETE,
        progress: { complete: 6, total: 6 },
        nextAction: { kind: 'NONE' },
        status: 'ACTIVE',
      }),
      draft: draft({ state: 'APPROVED', percentComplete: 100, complete: true, editable: false }),
    },
  });

/**
 * The task a state opens, taken from the route the registry declares.
 *
 * `/provider/onboarding/WORK_AREA#map` -> `WORK_AREA`. Derived rather than
 * listed a second time: a hand-written map beside the registry is one more
 * place for the two to disagree, and this gate exists because exactly that
 * kind of drift went unnoticed before.
 */
function taskIdFromRoute(route: string): string | null {
  const match = /\/provider\/onboarding\/([A-Z_]+)/.exec(route);
  return match ? match[1] : null;
}

/**
 * Open the task under test, without disturbing the others.
 *
 * A task route renders its FORM only while the server calls that task
 * `AVAILABLE` — `isTaskActionable` is deliberately strict, so a task the hub
 * reports as complete or blocked cannot be entered by typing its id into the
 * address bar. That rule is correct and is not being relaxed here; the fixture
 * simply describes a server for which the task in question is genuinely open,
 * which is the only state in which the approved screen exists at all.
 *
 * The submitted state is the exception: it is reached through the review task
 * AFTER submission, when nothing is open any more.
 */
function hubForState(fixture: PreconditionFixture, state: Phase5State): Record<string, unknown> {
  const taskId = taskIdFromRoute(state.route);
  if (!taskId || state.precondition === 'draft-submitted') return fixture.hub;

  const tasks = (fixture.hub.tasks as Array<Record<string, unknown>>).map((t) =>
    t.id === taskId ? { ...t, status: 'AVAILABLE' } : t,
  );
  return { ...fixture.hub, tasks };
}

/**
 * The profile, carrying the operator's note when there is one to carry.
 *
 * Only a REJECTED profile has one: every other lifecycle sends `null`, and the
 * action-required screen falls back to its own heading rather than drawing an
 * empty alert.
 */
function returnedProfile(
  fixture: PreconditionFixture,
  locale: Locale,
): Record<string, unknown> | null {
  if (!fixture.profile) return null;
  const profile = (fixture.profile as { profile: Record<string, unknown> }).profile;
  if (profile.status !== 'REJECTED') return fixture.profile;
  return { profile: { ...profile, rejectionReason: RETURN_REASON[locale] } };
}

// ── Installation ────────────────────────────────────────────────────────────

/**
 * Put the browser into the state, then hand the app the server it expects.
 *
 * The flag and the language are seeded BEFORE boot — both are read once during
 * start-up, so setting them afterwards would leave the bundle rendering V1 in
 * English however the test was configured.
 */
export async function installPrecondition(
  page: Page,
  state: Phase5State,
  locale: Locale,
): Promise<void> {
  const fixture = PRECONDITIONS[state.precondition];
  const hubBody = hubForState(fixture, state);
  const profileBody = returnedProfile(fixture, locale);
  const draftBody = {
    ...fixture.draft,
    data: { ...(fixture.draft.data as Record<string, unknown>), ...LOCALISED[locale] },
  };

  /**
   * Has the upgrade been requested yet?
   *
   * The synchronization screen is the window between the upgrade committing and
   * the rotated session being verified, so the thing that must hang is the
   * session probe that follows the upgrade — not the one the app makes while
   * BOOTING. Stalling both meant the app never got an identity, never rendered
   * the activation screen, and never reached the button that starts the flow:
   * the state was unphotographable for the same reason it was unreachable.
   */
  let upgradeRequested = false;

  await page.addInitScript(
    ([flagKey, flagValue, langKey, langValue]) => {
      window.localStorage.setItem(flagKey as string, flagValue as string);
      window.localStorage.setItem(langKey as string, langValue as string);
      // A CSRF cookie, because its ABSENCE is a different failure.
      //
      // The 401 interceptor short-circuits to a global sign-out when there is
      // no CSRF token — correctly, because a refresh could not succeed. The
      // approved expired screen is the OTHER 401: a session that refreshes
      // cleanly and is still refused the resource, which is what leaves the
      // provider on the onboarding route with a 401 to explain. Without this
      // cookie the app routes to /login and the screen is unreachable rather
      // than unbuilt.
      document.cookie = 'hsm_csrf=phase5';
    },
    [FLAG_KEY, 'true', 'hsm.lang', locale],
  );

  await page.route('**/v1/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/auth/me')) {
      // NOT 401 here, even for the expired state, and the distinction is the
      // screen itself. The approved surface is the ONBOARDING hub answering a
      // 401 — a session that was usable when the app booted and has expired by
      // the time the application is read. Failing the identity probe too would
      // take the provider to /login before the hub ever rendered, which is a
      // different (and correct) behaviour for a different moment.
      if (fixture.stallSessionRefresh && upgradeRequested) {
        // Held open, not answered — and only AFTER the upgrade. The
        // synchronization screen is a transient state; letting this probe
        // resolve would move the app off it before the capture, and stalling
        // it from the start would stop the app ever booting far enough to
        // press Activate.
        return new Promise(() => {});
      }
      return fixture.me
        ? json(route, fixture.me)
        : json(route, { success: false, error: { code: 'AUTH_INVALID_CREDENTIALS' } }, 401);
    }

    if (url.includes('/me/provider/onboarding/hub')) {
      if (fixture.unauthorized) {
        return json(route, { success: false, error: { code: 'AUTH_TOKEN_EXPIRED' } }, 401);
      }
      return json(route, hubBody);
    }

    // BEFORE the draft, because `/onboarding/review` shares its prefix and a
    // draft answer there would hand the review screen an object with no
    // `terms` — which crashes it rather than showing a wrong number, and was
    // therefore the cheapest ordering bug in the file to leave in place.
    if (url.includes('/me/provider/onboarding/review')) {
      if (fixture.unauthorized) {
        return json(route, { success: false, error: { code: 'AUTH_TOKEN_EXPIRED' } }, 401);
      }
      return json(route, fixture.review);
    }

    if (url.includes('/me/provider/onboarding/draft')) {
      if (fixture.unauthorized) {
        return json(route, { success: false, error: { code: 'AUTH_TOKEN_EXPIRED' } }, 401);
      }
      return json(route, draftBody);
    }

    if (url.includes('/me/provider/upgrade')) {
      upgradeRequested = true;
      return json(route, profileAt('DRAFT'));
    }

    if (url.includes('/me/provider/profile')) {
      return profileBody
        ? json(route, profileBody)
        : json(route, { success: false, error: { code: 'PROVIDER_PROFILE_NOT_FOUND' } }, 404);
    }

    // The capability contract's own shape, not a two-boolean approximation.
    // The status centre reads `allowed`, and an object with the wrong keys
    // would have it report "no work access" for every provider — which looks
    // exactly like a correct answer on three of the four screens that ask.
    if (url.includes('/me/provider/capabilities')) {
      const active = state.precondition === 'provider-active';
      const allowed = active
        ? [
            'VIEW_OWN_PROFILE',
            'EDIT_OWN_PROFILE',
            'VIEW_MARKETPLACE',
            'SUBMIT_BID',
            'MANAGE_BOOKINGS',
            'VIEW_EARNINGS',
            'MANAGE_VERIFICATION',
          ]
        : ['VIEW_OWN_PROFILE', 'EDIT_OWN_PROFILE', 'COMPLETE_ONBOARDING', 'SUBMIT_FOR_REVIEW'];
      return json(route, {
        capabilities: allowed.map((capability) => ({
          capability,
          allowed: true,
          reason: null,
        })),
        allowed,
        nextActions: [],
        primaryReason: active ? null : 'ONBOARDING_INCOMPLETE',
      });
    }

    if (url.includes('/notifications/unread-count')) return json(route, { count: 0 });

    // Three photos, uploaded and still in moderation — which is exactly the
    // state the approved portfolio screen depicts, and the reason its tiles
    // show a placeholder rather than the photographs: review "controls when
    // photos become visible".
    if (url.includes('/me/provider/portfolio')) {
      return json(route, {
        items: [0, 1, 2].map((position) => ({
          id: `pf-${position}`,
          media: { url: null, width: null, height: null },
          title: null,
          description: null,
          serviceCategoryId: null,
          position,
          moderationState: 'PENDING',
          moderationReason: null,
          createdAt: '2026-09-01T12:40:00.000Z',
        })),
        remainingSlots: 7,
      });
    }

    // The PUBLIC service catalogue. The approved services screen lists four
    // painting leaves under one group, and those are the strings the reference
    // image contains — a screen measured against a picture has to be offered
    // the same catalogue the picture was drawn from.
    //
    // Equipment is checked FIRST because it lives under the same prefix, and a
    // catalogue answer there would hand the equipment hook a list of services.
    if (url.includes('/v1/services/equipment')) return json(route, { items: [] });
    if (/\/v1\/services(\?|$)/.test(url)) {
      return json(route, { items: SERVICE_CATALOGUE });
    }

    // Anything else this journey touches gets an empty, well-shaped answer
    // rather than a 404 that would paint an error over the screen under test.
    return json(route, { items: [], nextCursor: null });
  });
}

/**
 * Drive the app to a state that only exists after an interaction.
 *
 * One of the eighteen is not addressable by URL. The synchronization screen is
 * what the ACTIVATION screen becomes once the upgrade commits, and it lives
 * for exactly as long as the session rotation takes — there is no route that
 * renders it, by design, because a provider must not be able to bookmark a
 * transient recovery state.
 *
 * So it is reached the way a provider reaches it: by pressing Activate. The
 * fixture then holds the session probe open (`stallSessionRefresh`), which
 * keeps the rotation in flight and the screen on display long enough to
 * photograph. Nothing about the screen is faked; it is the real component in
 * its real state, waiting on a real request that has not answered yet.
 */
export async function reachState(page: Page, state: Phase5State): Promise<void> {
  if (state.precondition !== 'customer-upgrading') return;

  await page.waitForSelector('[data-testid="activation-cta"]', { timeout: 20_000 });
  await page.click('[data-testid="activation-cta"]');
}
