import type {
  ProviderOnboardingLifecycleState,
  ProviderOnboardingStep,
} from '@homeservicemarketplace/contracts';

export type Lang = 'en' | 'ar';

// Sprint 09B.29 Phase 5A — the chrome of the nine approved TASK screens.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
//
// WHY THE CHROME IS PER SCREEN AND NOT PER TASK
//
// The shared task route used to draw one header for each of the six server
// tasks, taking its title from the hub's task copy. The approved design does
// not work that way: three of the six tasks are TWO screens each, and every
// screen has its own title, its own "Task 2 of 6 • Part 1" subtitle and its
// own primary action.
//
//   SERVICES_EXPERIENCE   "Choose your services"    then "Experience and transport"
//   PORTFOLIO             "Your public profile"     then "Portfolio"
//   REVIEW_SUBMISSION     "Review your application" then "Consent and submit"
//
// Drawing "Services and experience" over both halves lost the part indicator
// the provider uses to know how much is left, and gave two different screens
// the same name in the browser history.
//
// WHICH HALF IS SHOWING IS IN THE URL, NOT IN A COMPONENT
//
// `#experience`, `#portfolio`, `#terms` — the same addresses the Phase 5 state
// registry declares. That is deliberate: a reload returns to the half the
// provider was on, the back button steps between them, and the visual gate can
// address either half directly instead of having to click its way there.
//
// PROGRESS IS A POSITION IN THE FLOW, NOT A COUNT OF TASKS
//
// The 4px rule under the header carries the approved screen's own percentage
// (17, 28, 34, 50, 67, 76, 82, 100). Those are positions in a fixed
// nine-screen journey, and three of them — 28, 76, 82 — fall BETWEEN task
// boundaries because they mark the halfway point of a two-screen task. No
// count of completed tasks can produce them.
//
// This was server-derived at first, from the hub's `complete / total`. The two
// agree exactly where they can (task 1 of 6 is 17%) and diverge by up to 33%
// mid-flow, which on the work-area screen was 516 differing pixels — a third
// of that cell's entire budget spent on a bar that was answering a different
// question from the one the design asks it.
//
// The COUNT is still the server's and is still shown: it is the hub's subtitle
// ("1 of 6 tasks complete") and the hub's own rule. Nothing here re-derives
// task completion, readiness or eligibility — this is a step indicator for a
// journey whose shape the approved design owns.

/** The approved task screens, in the prototype's own order. */
export const TASK_SCREEN_KEYS = [
  'basics',
  'services',
  'experience',
  'area',
  'hours',
  'profile',
  'portfolio',
  'review',
  'terms',
  // LAST on purpose. `taskScreenKeyFor` scans this list in order and both this
  // screen and `review` answer to `REVIEW_SUBMISSION` with no fragment, so the
  // one a URL can reach has to be found first. This one is selected by the
  // application's LIFECYCLE, never by an address — a provider must not be able
  // to type their way back to a confirmation they have not earned, nor away
  // from one they have.
  'submitted',
] as const;

export type TaskScreenKey = (typeof TASK_SCREEN_KEYS)[number];

export interface TaskScreenChrome {
  readonly title: string;
  /** `null` on the one approved screen the reference draws without one. */
  readonly subtitle: string | null;
  /** The one dominant action. Every approved screen has exactly one. */
  readonly primary: string;
  /** The quiet way out. `null` on the screens the reference draws without one. */
  readonly secondary: string | null;
}

interface TaskScreenRoute {
  /** The server task this screen belongs to. */
  readonly taskId: string;
  /** The approved screen's position in the nine-screen journey, 0-100. */
  readonly progress: number;
  /**
   * The draft STEP whose save status this screen reports.
   *
   * The approved sticky bar carries one save line, and it has to speak for the
   * fields actually on screen. A task that is two screens writes two different
   * steps, so taking the status from the TASK would show the provider the
   * outcome of a write they made on the previous screen.
   */
  readonly step: ProviderOnboardingStep;
  /** The fragment that selects it, or `null` for the task's first screen. */
  readonly hash: string | null;
  /**
   * Where the primary action goes. A `#fragment` stays within the task.
   *
   * `null` means the primary is not a navigation at all — it is a server
   * COMMAND the screen itself owns, and the chrome must not draw a button that
   * would look like it submits and do nothing.
   */
  readonly next: string | null;
  /** Which Provider UI test id the primary action carries, per the registry. */
  readonly primaryTestId: string;
  /**
   * Where the quiet action goes, when it is not the hub.
   *
   * The reference's secondary is `data-go="back"` everywhere, which on eight of
   * the nine screens means the hub — and on the consent screen means the
   * REVIEW half it was reached from. Sending a provider who tapped "Back" out
   * of the task entirely, one tap before submitting, would lose them the
   * screen they were checking against.
   */
  readonly backTo?: string;
  /**
   * Does the approved screen carry the save line under its actions?
   *
   * The reference's `hsmSticky` always draws it, but two screens do not use
   * that helper: the confirmation writes its sticky out longhand with a single
   * button and no save state, because a submitted application has nothing left
   * to save and a "Changes saved" line under it would be false.
   */
  readonly autosaveLine?: boolean;
}

/**
 * Screen identity and destination, kept apart from the prose.
 *
 * The registry in `e2e/phase5-visual-states.ts` addresses exactly these
 * routes; if the two ever disagree the visual gate captures the wrong screen,
 * so they are written to be compared side by side.
 */
export const TASK_SCREEN_ROUTES: Readonly<Record<TaskScreenKey, TaskScreenRoute>> = Object.freeze({
  basics: {
    taskId: 'BASICS_IDENTITY',
    progress: 17,
    step: 'IDENTITY',
    hash: null,
    next: '/provider/onboarding/SERVICES_EXPERIENCE',
    primaryTestId: 'task-save-and-continue',
  },
  services: {
    taskId: 'SERVICES_EXPERIENCE',
    progress: 28,
    step: 'SPECIALTIES',
    hash: null,
    next: '#experience',
    primaryTestId: 'task-continue-to-experience',
  },
  experience: {
    taskId: 'SERVICES_EXPERIENCE',
    progress: 34,
    step: 'EXPERIENCE',
    hash: 'experience',
    next: '/provider/onboarding/WORK_AREA',
    primaryTestId: 'task-save-and-continue',
  },
  area: {
    taskId: 'WORK_AREA',
    progress: 50,
    step: 'LOCATION',
    hash: null,
    next: '/provider/onboarding/WORKING_HOURS',
    primaryTestId: 'task-save-and-continue',
  },
  hours: {
    taskId: 'WORKING_HOURS',
    progress: 67,
    step: 'AVAILABILITY',
    hash: null,
    next: '/provider/onboarding/PORTFOLIO',
    primaryTestId: 'task-save-and-continue',
  },
  profile: {
    taskId: 'PORTFOLIO',
    progress: 76,
    step: 'PROFILE',
    hash: null,
    next: '#portfolio',
    primaryTestId: 'task-save-and-continue',
  },
  portfolio: {
    taskId: 'PORTFOLIO',
    progress: 82,
    step: 'PROFILE',
    hash: 'portfolio',
    // The approved screen's action is "Save and return to tasks": the portfolio
    // is the last thing the provider fills in, and the reference sends them
    // back to the hub rather than on to the review they have not earned yet.
    next: '/provider/onboarding',
    primaryTestId: 'portfolio-save-and-return',
  },
  review: {
    taskId: 'REVIEW_SUBMISSION',
    progress: 100,
    step: 'REVIEW',
    hash: null,
    next: '#terms',
    primaryTestId: 'review-continue-to-consent',
  },
  terms: {
    taskId: 'REVIEW_SUBMISSION',
    progress: 100,
    step: 'CONSENT',
    hash: 'terms',
    // Submission is a server COMMAND, not a navigation, and it has
    // preconditions the chrome cannot see — the server's `canSubmit`, the
    // consent version, a readiness refetch that runs first. So this screen's
    // primary is published UP by the body that owns those, and `next: null`
    // records that there is no destination for the chrome to navigate to.
    next: null,
    primaryTestId: 'review-submit',
    backTo: '/provider/onboarding/REVIEW_SUBMISSION',
  },
  submitted: {
    taskId: 'REVIEW_SUBMISSION',
    progress: 100,
    step: 'REVIEW',
    hash: null,
    // Out of onboarding altogether: the application is in, and the status
    // centre is where its four axes are answered from now on.
    next: '/provider/status',
    primaryTestId: 'submitted-view-status',
    autosaveLine: false,
  },
});

export const TASK_CHROME_COPY: Record<Lang, Record<TaskScreenKey, TaskScreenChrome>> = {
  en: {
    basics: {
      title: 'Basic details',
      subtitle: 'Task 1 of 6',
      primary: 'Save and continue',
      secondary: 'Back to tasks',
    },
    services: {
      title: 'Choose your services',
      subtitle: 'Task 2 of 6 • Part 1',
      primary: 'Continue to experience',
      secondary: 'Back to tasks',
    },
    experience: {
      title: 'Experience and transport',
      subtitle: 'Task 2 of 6 • Part 2',
      primary: 'Save and continue',
      secondary: 'Back to tasks',
    },
    area: {
      title: 'Work area',
      subtitle: 'Task 3 of 6',
      primary: 'Save and continue',
      secondary: 'Back to tasks',
    },
    hours: {
      title: 'Working hours',
      subtitle: 'Task 4 of 6',
      primary: 'Save and continue',
      secondary: 'Back to tasks',
    },
    profile: {
      title: 'Your public profile',
      subtitle: 'Task 5 of 6 • Part 1',
      primary: 'Continue to photos',
      secondary: 'Back to tasks',
    },
    portfolio: {
      title: 'Portfolio',
      subtitle: 'Task 5 of 6 • Part 2',
      primary: 'Save and return to tasks',
      secondary: null,
    },
    review: {
      title: 'Review your application',
      subtitle: 'Before submission',
      primary: 'Continue to consent',
      secondary: 'Back to tasks',
    },
    terms: {
      title: 'Consent and submit',
      subtitle: 'Final step',
      primary: 'Submit for review',
      secondary: 'Back',
    },
    submitted: {
      title: 'Application submitted',
      // The reference passes an empty subtitle here and draws none. Nothing
      // short enough to fit would add to a heading that already says it.
      subtitle: null,
      primary: 'View application status',
      secondary: null,
    },
  },
  ar: {
    basics: {
      title: 'البيانات الأساسية',
      subtitle: 'المهمة 1 من 6',
      primary: 'حفظ والمتابعة',
      secondary: 'العودة للمهام',
    },
    services: {
      title: 'اختر خدماتك',
      subtitle: 'المهمة 2 من 6 • الجزء 1',
      primary: 'متابعة إلى الخبرة',
      secondary: 'العودة للمهام',
    },
    experience: {
      title: 'الخبرة والتنقل',
      subtitle: 'المهمة 2 من 6 • الجزء 2',
      primary: 'حفظ والمتابعة',
      secondary: 'العودة للمهام',
    },
    area: {
      title: 'نطاق العمل',
      subtitle: 'المهمة 3 من 6',
      primary: 'حفظ والمتابعة',
      secondary: 'العودة للمهام',
    },
    hours: {
      title: 'ساعات العمل',
      subtitle: 'المهمة 4 من 6',
      primary: 'حفظ والمتابعة',
      secondary: 'العودة للمهام',
    },
    profile: {
      title: 'ملفك العام',
      subtitle: 'المهمة 5 من 6 • الجزء 1',
      primary: 'متابعة إلى الصور',
      secondary: 'العودة للمهام',
    },
    portfolio: {
      title: 'معرض الأعمال',
      subtitle: 'المهمة 5 من 6 • الجزء 2',
      primary: 'حفظ والعودة للمهام',
      secondary: null,
    },
    review: {
      title: 'راجع طلبك',
      subtitle: 'قبل الإرسال',
      primary: 'متابعة إلى الموافقة',
      secondary: 'العودة للمهام',
    },
    terms: {
      title: 'الموافقة والإرسال',
      subtitle: 'الخطوة الأخيرة',
      primary: 'إرسال للمراجعة',
      secondary: 'رجوع',
    },
    submitted: {
      title: 'تم إرسال الطلب',
      subtitle: null,
      primary: 'عرض حالة الطلب',
      secondary: null,
    },
  },
};

/**
 * Lifecycle states in which the review task has nothing left to collect.
 *
 * Read from the draft the chrome already loads, not decided here: these are the
 * server's own states and the only thing this list does is say which of them
 * mean "handed in". A provider in any of them cannot edit, cannot consent again
 * and cannot submit twice, so the consent screen is not a screen they have —
 * and the confirmation is the screen they do.
 */
const HANDED_IN: ReadonlySet<string> = new Set([
  'SUBMITTED',
  'DOCUMENTS_REQUIRED',
  'ACCEPTED',
] satisfies ProviderOnboardingLifecycleState[]);

/**
 * Which approved screen a task id, fragment and lifecycle name.
 *
 * Returns `null` for a task this phase has no approved screen for, so the
 * caller keeps its existing behaviour rather than inventing chrome for a
 * surface the design does not describe.
 *
 * `lifecycle` is consulted FIRST and only for the review task, because that is
 * the one place where the screen is not a function of the URL: `#terms` on a
 * submitted application is not a consent form the provider may revisit, it is
 * a confirmation. Resolving it in one place keeps the chrome and the body from
 * ever disagreeing about which of the three they are drawing.
 */
export function taskScreenKeyFor(
  taskId: string,
  hash: string,
  lifecycle?: string | null,
): TaskScreenKey | null {
  if (taskId === 'REVIEW_SUBMISSION' && lifecycle && HANDED_IN.has(lifecycle)) {
    return 'submitted';
  }

  const fragment = hash.replace(/^#/, '');
  for (const key of TASK_SCREEN_KEYS) {
    const route = TASK_SCREEN_ROUTES[key];
    if (route.taskId !== taskId) continue;
    if ((route.hash ?? '') === fragment) return key;
  }
  // A task we know, with a fragment we do not: show its first screen rather
  // than nothing. An unrecognised anchor is not a reason to blank the header.
  return TASK_SCREEN_KEYS.find((key) => TASK_SCREEN_ROUTES[key].taskId === taskId) ?? null;
}
