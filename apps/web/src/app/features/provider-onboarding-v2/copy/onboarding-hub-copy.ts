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

// Sprint 09B.29 Phase 5A — approved screens 15 and 16.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
//
// Two lifecycle screens that are NOT the hub with a banner on it.
//
// A returned application drew the task list with a notice above it, on the
// reasoning that hiding what there is to fix makes the notice unactionable.
// The approved design answers the same worry better: it names the one task and
// puts a button on it, so the provider does not have to find their own problem
// in a list of six rows, five of which are already done.
//
// An expired session drew a heading, a sentence and a button in the middle of
// an otherwise empty hub. The approved screen adds the thing a provider in that
// moment actually wants to know — that nothing they saved is lost — and says it
// where they are already looking.

export interface LifecycleScreenCopy {
  /** 15. The header, over a saved application. */
  returnedTitle: string;
  returnedSubtitle: string;
  /**
   * What to say when the server sent no reason.
   *
   * RECORDED FOR PHASE 5B: `profile.rejectionReason` is one free-text string
   * in whichever language an operator typed it, so a provider reading the app
   * in Arabic can be handed an English sentence. A reason CODE plus an
   * operator note, the way the review blockers already work, is the fix.
   */
  returnedFallbackReason: string;
  /** The promise beside it: nothing accepted has to be entered again. */
  returnedReassurance: string;
  returnedDoTitle: string;
  /**
   * What to do, per TASK.
   *
   * Not one generic sentence, and not the operator's note either. "Upload a
   * well-lit photo showing the finished work, then resubmit" is true of every
   * portfolio return and of no other kind, which makes it exactly what client
   * copy is for — the same reason the hub keys its task prose off the task id
   * rather than rendering the server's single-language string.
   *
   * The operator's actual note is the ALERT above it. This is the standing
   * answer to "what shape of change is being asked for", and the two are
   * separate because one changes per return and the other does not.
   */
  returnedDoBody: Record<string, string>;
  returnedDoBodyFallback: string;
  /**
   * The task, as the button names it.
   *
   * Kept beside the guidance rather than taken from the hub's row title,
   * because the approved returned screen names the SCREEN it opens ("Portfolio")
   * where the hub row names the whole task ("Bio and portfolio"). Both are
   * right where they are.
   */
  returnedTaskLabel: Record<string, string>;
  /** "Complete now: Portfolio" — the task named, not "Complete now". */
  returnedCompleteNow: (task: string) => string;

  /** 16. A genuine 401, and only a 401. */
  expiredTitle: string;
  expiredHeading: string;
  expiredLead: string;
  expiredSafeTitle: string;
  expiredSafeBody: string;
  expiredCta: string;
}

export const LIFECYCLE_COPY: Record<Lang, LifecycleScreenCopy> = {
  en: {
    returnedTitle: 'Action required',
    returnedSubtitle: 'Your application is saved',
    returnedFallbackReason: 'Something needs your attention',
    returnedReassurance:
      'The rest of your application is accepted and does not need to be entered again.',
    returnedDoTitle: 'What you need to do',
    returnedDoBody: {
      BASICS_IDENTITY: 'Check the details we asked about, then resubmit.',
      SERVICES_EXPERIENCE: 'Update your services or your experience, then resubmit.',
      WORK_AREA: 'Update where you work and how far you travel, then resubmit.',
      WORKING_HOURS: 'Update the days and hours you work, then resubmit.',
      PORTFOLIO: 'Upload a well-lit photo showing the finished work, then resubmit.',
      REVIEW_SUBMISSION: 'Read your application through once more, then resubmit.',
    },
    returnedDoBodyFallback: 'Open the task below, make the change, then resubmit.',
    returnedTaskLabel: {
      BASICS_IDENTITY: 'Basic details',
      SERVICES_EXPERIENCE: 'Services and experience',
      WORK_AREA: 'Work area',
      WORKING_HOURS: 'Working hours',
      PORTFOLIO: 'Portfolio',
      REVIEW_SUBMISSION: 'Review and submission',
    },
    returnedCompleteNow: (task) => `Complete now: ${task}`,

    expiredTitle: 'Sign in required',
    expiredHeading: 'Your session has expired',
    expiredLead:
      'This message appears only for a 401 response. Sign in again and we will return you to the last saved task.',
    expiredSafeTitle: 'Your data is safe',
    expiredSafeBody: 'Successfully saved tasks will not be lost.',
    expiredCta: 'Go to sign in',
  },
  ar: {
    returnedTitle: 'إجراء مطلوب',
    returnedSubtitle: 'طلبك محفوظ',
    returnedFallbackReason: 'هناك ما يحتاج انتباهك',
    returnedReassurance: 'بقية الطلب مقبول ولن تحتاج إلى إعادة إدخال بياناتك.',
    returnedDoTitle: 'المطلوب منك',
    returnedDoBody: {
      BASICS_IDENTITY: 'راجع البيانات المطلوبة، ثم أعد الإرسال.',
      SERVICES_EXPERIENCE: 'حدّث خدماتك أو خبرتك، ثم أعد الإرسال.',
      WORK_AREA: 'حدّث مكان عملك والمسافة التي تقطعها، ثم أعد الإرسال.',
      WORKING_HOURS: 'حدّث أيام وساعات عملك، ثم أعد الإرسال.',
      PORTFOLIO: 'ارفع صورة مضاءة جيداً تُظهر النتيجة النهائية للعمل، ثم أعد الإرسال.',
      REVIEW_SUBMISSION: 'اقرأ طلبك مرة أخرى، ثم أعد الإرسال.',
    },
    returnedDoBodyFallback: 'افتح المهمة أدناه، أجرِ التعديل، ثم أعد الإرسال.',
    returnedTaskLabel: {
      BASICS_IDENTITY: 'البيانات الأساسية',
      SERVICES_EXPERIENCE: 'الخدمات والخبرة',
      WORK_AREA: 'نطاق العمل',
      WORKING_HOURS: 'ساعات العمل',
      PORTFOLIO: 'معرض الأعمال',
      REVIEW_SUBMISSION: 'المراجعة والإرسال',
    },
    returnedCompleteNow: (task) => `إكمال الآن: ${task}`,

    expiredTitle: 'تسجيل الدخول مطلوب',
    expiredHeading: 'انتهت جلستك',
    expiredLead: 'هذا التنبيه يظهر فقط عند 401. سجّل الدخول مجدداً ثم سنعيدك إلى آخر مهمة محفوظة.',
    expiredSafeTitle: 'بياناتك محفوظة',
    expiredSafeBody: 'لن تفقد المهام التي حفظها الخادم بنجاح.',
    expiredCta: 'الذهاب لتسجيل الدخول',
  },
};

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
