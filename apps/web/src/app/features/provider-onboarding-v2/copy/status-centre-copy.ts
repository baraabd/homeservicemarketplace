export type Lang = 'en' | 'ar';

// Sprint 09B.29 Phase 5A — the two approved status screens.
//
// docs/provider-experience-v2/reference/provider-onboarding-prototype.html
// docs/adr/0005-provider-lifecycle-axes.md
//
// WHY THE SECOND AXIS CHANGES NAME
//
// The reference asks for "Specialty review" while the application is with us
// and "Account standing" once it is not, and that is a deliberate answer rather
// than an inconsistency: while a provider is waiting, the only standing
// question anyone has is which specialties were accepted. Once they are active,
// standing is about conduct — and the specialty decision is history.
//
// Both are server facts and both are read from the server. Nothing here infers
// an axis from another axis, which is the failure ADR 0005 exists to prevent.

export interface StatusCentreCopy {
  // ── The waiting screen ────────────────────────────────────────────────────
  waitingTitle: string;
  /** "Updated today at 12:43" — from the server's own timestamp. */
  waitingSubtitle: (time: string) => string;
  waitingAlertTitle: string;
  waitingAlertBody: string;
  /** The quiet way back into a saved application. */
  viewApplication: string;
  withdraw: string;

  // ── The activation handoff ────────────────────────────────────────────────
  activeTitle: string;
  activeHeading: string;
  activeLead: string;
  openWorkspace: string;

  // ── The four axes ─────────────────────────────────────────────────────────
  axisCompletion: string;
  axisSpecialty: string;
  axisStanding: string;
  axisVerification: string;
  axisWorkAccess: string;

  valueComplete: string;
  valueInReview: string;
  valueGood: string;
  valueVerified: string;
  valueNotActive: string;
  valueActive: string;
  valueNotStarted: string;
}

const EN: StatusCentreCopy = {
  waitingTitle: 'Your account status',
  waitingSubtitle: (time) => `Updated today at ${time}`,
  waitingAlertTitle: 'We are reviewing your application',
  waitingAlertBody:
    'No action is needed now. We will only contact you if a specific item needs attention.',
  viewApplication: 'View your application',
  withdraw: 'Withdraw application to edit',

  activeTitle: 'Account activated',
  activeHeading: 'You are ready to receive requests',
  activeLead:
    'Your application was approved and provider workspace access is active. Provider navigation appears now for the first time.',
  openWorkspace: 'Open provider workspace',

  axisCompletion: 'Application completion',
  axisSpecialty: 'Specialty review',
  axisStanding: 'Account standing',
  axisVerification: 'Verification',
  axisWorkAccess: 'Work access',

  valueComplete: 'Complete',
  valueInReview: 'In review',
  valueGood: 'Good',
  valueVerified: 'Verified',
  valueNotActive: 'Not active',
  valueActive: 'Active',
  valueNotStarted: 'Not started',
};

const AR: StatusCentreCopy = {
  waitingTitle: 'حالة حسابك',
  waitingSubtitle: (time) => `آخر تحديث اليوم ${time}`,
  waitingAlertTitle: 'نراجع طلبك',
  waitingAlertBody: 'لا تحتاج إلى إجراء الآن. سنطلب منك شيئاً فقط إذا ظهرت ملاحظة محددة.',
  viewApplication: 'عرض طلبك',
  withdraw: 'سحب الطلب للتعديل',

  activeTitle: 'تم تفعيل الحساب',
  activeHeading: 'أصبحت جاهزاً لاستقبال الطلبات',
  activeLead: 'تم قبول الطلب وتفعيل الوصول إلى مساحة عمل المهني. يظهر التنقل المهني الآن لأول مرة.',
  openWorkspace: 'فتح مساحة العمل',

  axisCompletion: 'اكتمال الطلب',
  axisSpecialty: 'مراجعة التخصصات',
  axisStanding: 'حالة الحساب',
  axisVerification: 'التحقق',
  axisWorkAccess: 'إمكانية استقبال العمل',

  valueComplete: 'مكتمل',
  valueInReview: 'قيد المراجعة',
  valueGood: 'سليم',
  valueVerified: 'موثّق',
  valueNotActive: 'غير مفعّل',
  valueActive: 'مفعّل',
  valueNotStarted: 'لم تبدأ',
};

export const STATUS_CENTRE_COPY: Record<Lang, StatusCentreCopy> = { en: EN, ar: AR };
