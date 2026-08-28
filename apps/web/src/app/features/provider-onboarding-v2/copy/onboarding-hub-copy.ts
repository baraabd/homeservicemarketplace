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
      title: 'Your details',
      description: 'Name, phone number, and profile photo',
    },
    SERVICES_EXPERIENCE: {
      title: 'Services and experience',
      description: 'Your specialties, years of experience, and how you travel',
    },
    WORK_AREA: {
      title: 'Work area',
      description: 'Your city and where you are based',
    },
    WORKING_HOURS: {
      title: 'Working hours',
      description: 'The days and times you can take jobs',
    },
    PORTFOLIO: {
      title: 'Portfolio',
      description: 'A short intro and photos of your previous work',
    },
    REVIEW_SUBMISSION: {
      title: 'Review and submit',
      description: 'Confirm your details and accept the terms',
    },
  },
  ar: {
    BASICS_IDENTITY: {
      title: 'البيانات الأساسية',
      description: 'الاسم، رقم الهاتف، والصورة الشخصية',
    },
    SERVICES_EXPERIENCE: {
      title: 'الخدمات والخبرة',
      description: 'التخصص، سنوات الخبرة، ووسيلة النقل',
    },
    WORK_AREA: {
      title: 'نطاق العمل',
      description: 'المدينة ونقطة التمركز الخاصة بك',
    },
    WORKING_HOURS: {
      title: 'ساعات العمل',
      description: 'أيام وأوقات توفرك لاستقبال الطلبات',
    },
    PORTFOLIO: {
      title: 'معرض الأعمال',
      description: 'نبذة تعريفية وصور من أعمالك السابقة',
    },
    REVIEW_SUBMISSION: {
      title: 'المراجعة والإرسال',
      description: 'تأكيد البيانات والموافقة على الشروط',
    },
  },
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
    COVERAGE: 'Where and when you work',
    PROFILE: 'Your profile',
    REVIEW: 'Review',
  },
  ar: {
    BASICS: 'الأساسيات',
    SERVICES: 'خدماتك',
    COVERAGE: 'أين ومتى تعمل',
    PROFILE: 'ملفك الشخصي',
    REVIEW: 'المراجعة',
  },
};

export function groupLabel(group: ProviderOnboardingHubGroup, lang: Lang): string {
  return GROUP_LABELS[lang][group] ?? group;
}

/** The short badge on a row. */
const STATUS_LABELS: Record<Lang, Record<string, string>> = {
  en: { COMPLETE: 'Done', AVAILABLE: 'To do', WAITING: 'With us', BLOCKED: 'Locked' },
  ar: { COMPLETE: 'مكتمل', AVAILABLE: 'مطلوب', WAITING: 'قيد المراجعة', BLOCKED: 'مقفل' },
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
  return lang === 'ar' ? `اكتمل ${complete} من ${total}` : `${complete} of ${total} complete`;
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
    HUB: { title: 'Finish your application', body: '', cta: null },
  },
  ar: {
    LOADING: { title: 'جارٍ التحميل…', body: '', cta: null },
    UNAUTHORIZED: {
      title: 'يرجى تسجيل الدخول مرة أخرى',
      body: 'انتهت جلستك، لذلك لا يمكننا عرض طلبك.',
      cta: 'الذهاب إلى تسجيل الدخول',
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

/** The primary button at the foot of the hub, by next-action kind. */
export function nextActionLabel(kind: string, lang: Lang): string | null {
  const labels: Record<Lang, Record<string, string>> = {
    en: { COMPLETE_TASK: 'Continue', SUBMIT: 'Submit application' },
    ar: { COMPLETE_TASK: 'متابعة', SUBMIT: 'إرسال الطلب' },
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
