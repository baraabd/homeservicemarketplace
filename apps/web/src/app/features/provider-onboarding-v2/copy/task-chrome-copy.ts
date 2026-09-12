import type { ProviderOnboardingStep } from '@homeservicemarketplace/contracts';

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
] as const;

export type TaskScreenKey = (typeof TASK_SCREEN_KEYS)[number];

export interface TaskScreenChrome {
  readonly title: string;
  readonly subtitle: string;
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
    // Submission is a server command, not a navigation. The review screen owns
    // it; this records that the chrome's primary is that command.
    next: null,
    primaryTestId: 'review-submit',
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
  },
};

/**
 * Which approved screen a task id and fragment name.
 *
 * Returns `null` for a task this phase has no approved screen for, so the
 * caller keeps its existing behaviour rather than inventing chrome for a
 * surface the design does not describe.
 */
export function taskScreenKeyFor(taskId: string, hash: string): TaskScreenKey | null {
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
