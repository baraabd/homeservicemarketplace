import type {
  ProviderOnboardingHubGroup,
  ProviderOnboardingHubTask,
} from '@homeservicemarketplace/contracts';

import type { HubViewState } from '../hub-view-state';

// Sprint 9B.16 — every string the onboarding hub renders.
//
// WHY THE CLIENT OWNS THE PROSE
//
// The hub response carries `title` and `description` per task, and they arrive
// in ONE language. This app is bilingual and switches without a reload, so
// rendering those verbatim would show an English reader Arabic — the exact
// parity the acceptance criteria require us not to break.
//
// So the rule the rest of the codebase already follows applies here too (see
// provider-onboarding-step.ts): CODES on the wire, prose in the bundle. The
// client keys off the stable task `id` and falls back to the server's string
// only when it has no entry — which keeps a task shipped by a newer server
// readable rather than rendering a bare code.
//
// This is a DISPLAY decision and touches nothing else. Every task's status,
// the progress count and the next action still come from the server and are
// never inferred here.

export type Lang = 'en' | 'ar';

interface TaskCopy {
  title: string;
  description: string;
}

/** Task prose, keyed by the wire `id`. Arabic is the canonical wording from
 *  the 9B.15 response; English is its counterpart. */
const TASK_COPY: Record<Lang, Record<string, TaskCopy>> = {
  en: {
    BASICS_IDENTITY: {
      title: 'Basic details',
      description: 'Name, phone and photo',
    },
    SERVICES_EXPERIENCE: {
      title: 'Services and experience',
      description: 'Specialty, experience and transport',
    },
    WORK_AREA: {
      title: 'Work area',
      description: 'Starting point and coverage',
    },
    WORKING_HOURS: {
      title: 'Working hours',
      description: 'Available days and time ranges',
    },
    PORTFOLIO: {
      title: 'Bio and portfolio',
      description: 'What customers see',
    },
    REVIEW_SUBMISSION: {
      title: 'Review and submission',
      description: 'Confirm details and terms',
    },
  },
  ar: {
    BASICS_IDENTITY: {
      title: 'البيانات الأساسية',
      description: 'الاسم والهاتف والصورة',
    },
    SERVICES_EXPERIENCE: {
      title: 'الخدمات والخبرة',
      description: 'التخصص، الخبرة، وسيلة النقل',
    },
    WORK_AREA: {
      title: 'نطاق العمل',
      description: 'نقطة الانطلاق والتغطية',
    },
    WORKING_HOURS: {
      title: 'ساعات العمل',
      description: 'الأيام والفترات المتاحة',
    },
    PORTFOLIO: {
      title: 'النبذة ومعرض الأعمال',
      description: 'ما يراه العملاء',
    },
    REVIEW_SUBMISSION: {
      title: 'المراجعة والإرسال',
      description: 'تأكيد البيانات والشروط',
    },
  },
};

/**
 * Task titles alone, by id, for the surfaces that name a task without holding
 * one.
 *
 * The review screen's summary rows are titled by TASK — "Work area", "Working
 * hours" — but they are composed from the DRAFT, so there is no hub task object
 * to pass to `taskCopy`. Deriving them from the same table is what keeps the row
 * on the review screen and the row on the hub calling the same thing by the same
 * name.
 */
export const TASK_TITLES: Record<Lang, Record<string, string>> = {
  en: Object.fromEntries(Object.entries(TASK_COPY.en).map(([id, c]) => [id, c.title])),
  ar: Object.fromEntries(Object.entries(TASK_COPY.ar).map(([id, c]) => [id, c.title])),
};

/** Client prose for a task, falling back to whatever the server sent. */
export function taskCopy(task: ProviderOnboardingHubTask, lang: Lang): TaskCopy {
  const known = TASK_COPY[lang][task.id];
  if (known) return known;
  return { title: task.title, description: task.description };
}

/** Group headings. An unknown group falls back to its own code, which is ugly
 *  but legible — and far better than dropping the section. */
const GROUP_LABELS: Record<Lang, Record<ProviderOnboardingHubGroup, string>> = {
  en: {
    BASICS: 'Basics',
    SERVICES: 'Your services',
    COVERAGE: 'Where and when',
    // The approved hub puts Review under the SAME heading as the profile
    // tasks, so both codes resolve to one section title. See SECTION_OF.
    PROFILE: 'Public profile',
    REVIEW: 'Public profile',
  },
  ar: {
    BASICS: 'الأساسيات',
    SERVICES: 'خدماتك',
    COVERAGE: 'مكان ووقت العمل',
    PROFILE: 'ملفك العام',
    REVIEW: 'ملفك العام',
  },
};

export function groupLabel(group: ProviderOnboardingHubGroup, lang: Lang): string {
  return GROUP_LABELS[lang][group] ?? group;
}

/**
 * Which SECTION of the approved hub a server group belongs to.
 *
 * Sprint 09B.29 Phase 5A. The server sends five group codes; the approved hub
 * draws four sections, because Review and submission sits under the same
 * "Public profile" heading as the bio and portfolio rather than alone under a
 * heading of its own. A section with one row and a title that repeats the row
 * is noise.
 *
 * This is a DISPLAY decision and nothing more: the group each task belongs to
 * is still the server's, the order is still the server's, and no task is
 * reordered, hidden or re-statused by it.
 */
const SECTION_OF: Record<ProviderOnboardingHubGroup, ProviderOnboardingHubGroup> = {
  BASICS: 'BASICS',
  SERVICES: 'SERVICES',
  COVERAGE: 'COVERAGE',
  PROFILE: 'PROFILE',
  REVIEW: 'PROFILE',
};

export function sectionOf(group: ProviderOnboardingHubGroup): ProviderOnboardingHubGroup {
  return SECTION_OF[group] ?? group;
}

/** The hub's opening line. Absent from the complete hub, which leads with a
 *  success banner instead. */
export const HUB_LEAD: Record<Lang, string> = {
  en: 'Continue with the next task or open any available task. Every successful change is saved.',
  ar: 'ابدأ بالمهمة التالية أو افتح أي مهمة متاحة. يحفظ النظام كل تغيير ناجح.',
};

/** The banner the approved hub shows once every task the provider owns is done. */
export const HUB_COMPLETE_NOTICE: Record<Lang, { title: string; body: string }> = {
  en: {
    title: 'You completed your part',
    body: 'Some services and photos are under review, but you can submit now.',
  },
  ar: {
    title: 'أكملت كل ما عليك',
    body: 'بعض الخدمات والصور قيد المراجعة، لكن يمكنك إرسال الطلب الآن.',
  },
};

/** The short badge on a row. */
const STATUS_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    COMPLETE: 'Complete',
    AVAILABLE: 'Required',
    WAITING: 'In review',
    BLOCKED: 'Required',
  },
  ar: {
    COMPLETE: 'مكتمل',
    AVAILABLE: 'مطلوب',
    WAITING: 'قيد المراجعة',
    BLOCKED: 'مطلوب',
  },
};

export function statusLabel(status: string, lang: Lang): string {
  return STATUS_LABELS[lang][status] ?? status;
}

/**
 * Why a row cannot be opened.
 *
 * Only non-actionable statuses have one. A row the provider cannot press must
 * SAY why — a disabled-looking row with no sentence is a dead end, and the
 * provider's only remaining move is to press it repeatedly.
 */
const STATUS_EXPLANATIONS: Record<Lang, Record<string, string>> = {
  en: {
    WAITING: 'We are checking this. You do not need to do anything.',
    BLOCKED: 'Finish the tasks above first.',
  },
  ar: {
    WAITING: 'نقوم بمراجعة هذا. لا حاجة إلى أي إجراء منك.',
    BLOCKED: 'أكمل المهام السابقة أولاً.',
  },
};

export function statusExplanation(status: string, lang: Lang): string | null {
  return STATUS_EXPLANATIONS[lang][status] ?? null;
}

/** "3 of 6 complete". A count, never a percentage — and never computed here:
 *  both numbers come from the server. */
export function progressLabel(complete: number, total: number, lang: Lang): string {
  return lang === 'ar'
    ? `${complete} من ${total} مهام مكتملة`
    : `${complete} of ${total} tasks complete`;
}

export interface ScreenCopy {
  title: string;
  body: string;
  /** Null when there is nothing useful to press. Offering a button that
   *  cannot help is worse than offering none. */
  cta: string | null;
}

export const SCREEN_COPY: Record<Lang, Record<HubViewState, ScreenCopy>> = {
  en: {
    LOADING: { title: 'Loading…', body: '', cta: null },
    UNAUTHORIZED: {
      title: 'Please sign in again',
      body: 'Your session has ended, so we cannot show your application.',
      cta: 'Go to sign in',
    },
    // Sprint 9B.29 — the 403 screen, and it deliberately does NOT mention
    // signing in. Wording follows the prototype's synchronization screen: the
    // session is fine, the permissions attached to it are behind, and that is
    // ours to fix rather than something the provider can act on by
    // re-authenticating.
    FORBIDDEN: {
      title: 'Finishing your provider setup',
      body: 'Your account was upgraded and we are refreshing its permissions. This is not an expired session, and you do not need to sign in again.',
      cta: 'Try again',
    },
    ERROR: {
      title: 'We could not load your application',
      body: 'Something went wrong on our side. Your answers are safe.',
      cta: 'Try again',
    },
    EMPTY: {
      title: 'Nothing to show yet',
      body: 'We could not find an application for this account.',
      cta: 'Back to profile',
    },
    SUBMITTED: {
      title: 'Your application is with us',
      body: 'We are reviewing it. You do not need to do anything — we will let you know as soon as there is news.',
      cta: 'Back to profile',
    },
    ACTION_REQUIRED: {
      title: 'We need something from you',
      body: 'We looked at your application and something needs your attention before we can continue.',
      cta: null,
    },
    ALREADY_ACTIVE: {
      title: 'You are all set',
      body: 'Your application has been approved, so there is nothing left to fill in.',
      cta: 'Back to profile',
    },
    HUB: { title: 'Complete your application', body: '', cta: null },
  },
  ar: {
    LOADING: { title: 'جارٍ التحميل…', body: '', cta: null },
    UNAUTHORIZED: {
      title: 'يرجى تسجيل الدخول مرة أخرى',
      body: 'انتهت جلستك، لذلك لا يمكننا عرض طلبك.',
      cta: 'الذهاب إلى تسجيل الدخول',
    },
    FORBIDDEN: {
      title: 'نكمل تجهيز حسابك المهني',
      body: 'تمت ترقية حسابك ونقوم بتحديث صلاحياته الآن. هذه ليست جلسة منتهية، ولا تحتاج إلى تسجيل الدخول من جديد.',
      cta: 'إعادة المحاولة',
    },
    ERROR: {
      title: 'تعذّر تحميل طلبك',
      body: 'حدث خطأ لدينا. إجاباتك محفوظة.',
      cta: 'إعادة المحاولة',
    },
    EMPTY: {
      title: 'لا يوجد شيء لعرضه بعد',
      body: 'لم نتمكن من العثور على طلب لهذا الحساب.',
      cta: 'العودة إلى الملف الشخصي',
    },
    SUBMITTED: {
      title: 'طلبك قيد المراجعة لدينا',
      body: 'نقوم بمراجعته الآن. لا حاجة إلى أي إجراء منك — سنبلغك فور توفر أي جديد.',
      cta: 'العودة إلى الملف الشخصي',
    },
    ACTION_REQUIRED: {
      title: 'نحتاج منك شيئاً',
      body: 'راجعنا طلبك، وهناك ما يحتاج إلى انتباهك قبل أن نتمكن من المتابعة.',
      cta: null,
    },
    ALREADY_ACTIVE: {
      title: 'كل شيء جاهز',
      body: 'تمت الموافقة على طلبك، ولم يعد هناك ما تحتاج إلى تعبئته.',
      cta: 'العودة إلى الملف الشخصي',
    },
    HUB: { title: 'أكمل طلبك', body: '', cta: null },
  },
};

/**
 * The primary button at the foot of the hub, by next-action kind.
 *
 * Sprint 09B.29 Phase 5A — "Continue" became "Start: <section>".
 *
 * The approved hub names WHERE the button goes ("Start: Your services"), which
 * is the difference between a control the provider presses to find out and one
 * they press because they already know. The section comes from the group of
 * the task the SERVER nominated, so the label cannot disagree with the
 * destination.
 *
 * `section` is omitted for SUBMIT, which needs no destination in its label:
 * the approved complete hub reads "Review application".
 */
export function nextActionLabel(kind: string, lang: Lang, section?: string): string | null {
  const labels: Record<Lang, Record<string, string>> = {
    en: {
      COMPLETE_TASK: section ? `Start: ${section}` : 'Continue',
      SUBMIT: 'Review application',
    },
    ar: {
      COMPLETE_TASK: section ? `ابدأ: ${section}` : 'متابعة',
      SUBMIT: 'مراجعة الطلب',
    },
  };
  // AWAIT_REVIEW and NONE deliberately have no entry: there is nothing for the
  // provider to press, and a button that cannot help is worse than none.
  //
  // An unknown kind from a newer server gets no button either, rather than a
  // guess — a primary action whose meaning we cannot read is the one control
  // that must not be pressed hopefully.
  return labels[lang][kind] ?? null;
}

/** Chrome: the shell's own strings. */
export const SHELL_COPY: Record<Lang, { close: string; back: string; progressAria: string }> = {
  en: {
    close: 'Close and go back to profile',
    back: 'Back',
    progressAria: 'Application progress',
  },
  ar: {
    close: 'إغلاق والعودة إلى الملف الشخصي',
    back: 'رجوع',
    progressAria: 'تقدّم الطلب',
  },
};
