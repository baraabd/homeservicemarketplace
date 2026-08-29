import {
  DOCUMENT_KIND_LABELS,
  SCAN_STATE_LABELS,
  type Lang,
} from '../../admin-verification/copy/verification-copy';
import type { VerificationViewState } from '../verification-view-state';

// Sprint 9B.11 — every string the provider verification surface renders.
//
// REUSED from the reviewer surface: DOCUMENT_KIND_LABELS and SCAN_STATE_LABELS.
// A passport is a passport in both languages and to both audiences, and two
// copies of that map would drift the first time one was edited.
//
// NOT reused: the case-state labels. A reviewer reads "Awaiting review" as a
// queue position; a provider reads the same state as "we have your documents
// and you do not need to do anything". Same code, different audience, different
// sentence — so the provider wording lives here and the reviewer wording stays
// where it was.
//
// Codes on the wire, prose here — the same rule the whole codebase follows.

export type { Lang };
export { DOCUMENT_KIND_LABELS, SCAN_STATE_LABELS };

export interface StateCopy {
  title: string;
  body: string;
  /** Null when the state has nothing for the provider to do. Offering a button
   *  that cannot help is worse than offering none. */
  cta: string | null;
}

/** What the provider is told in each state, and what they can do about it. */
export const STATE_COPY: Record<Lang, Record<VerificationViewState, StateCopy>> = {
  en: {
    ACCOUNT_LOCKED: {
      title: 'Your account is closed',
      body: 'You cannot use the marketplace with this account. Contact support if you think this is wrong.',
      cta: 'Contact support',
    },
    SUSPENDED: {
      title: 'Your account is suspended',
      body: 'Verification is paused while your account is suspended. You can appeal this decision.',
      cta: 'Appeal',
    },
    ONBOARDING_INCOMPLETE: {
      title: 'Finish your profile first',
      body: 'Complete the sign-up steps, then we will ask for your documents.',
      cta: 'Continue sign-up',
    },
    NOT_REQUIRED: {
      title: 'No documents needed',
      body: 'You do not need to verify documents for the work you have chosen.',
      cta: null,
    },
    NOT_STARTED: {
      title: 'Verify your identity',
      body: 'Customers hire people they can trust. Send us a few documents and we will check them.',
      cta: 'Start verification',
    },
    EVIDENCE_REQUIRED: {
      title: 'Send us your documents',
      body: 'Add the documents listed below. Photos taken on your phone are fine, as long as the whole document is readable.',
      cta: 'Add a document',
    },
    SCANNING: {
      title: 'Checking your files',
      body: 'We are checking the files you sent. This usually takes a moment — you do not need to do anything.',
      cta: null,
    },
    EVIDENCE_UNUSABLE: {
      title: 'One of your files cannot be used',
      body: 'Please send that document again. The details are below.',
      cta: 'Replace the document',
    },
    READY_TO_SUBMIT: {
      title: 'Ready to send',
      body: 'Everything we asked for is here. Send it to our team and we will review it.',
      cta: 'Send for review',
    },
    PENDING_REVIEW: {
      title: 'With our team',
      body: 'We have your documents. You do not need to do anything — we will tell you as soon as there is news.',
      cta: null,
    },
    CHANGES_REQUESTED: {
      title: 'We need something changed',
      body: 'Our team looked at your documents and needs one thing fixed before they can finish.',
      cta: 'Replace the document',
    },
    REJECTED: {
      title: 'We could not verify you',
      body: 'Our team could not verify your documents. The reason is below.',
      cta: 'Start again',
    },
    VERIFIED_ACTIVE: {
      title: 'You are verified',
      body: 'Your documents were accepted and you can take work.',
      cta: null,
    },
    VERIFIED_NO_ACCESS: {
      title: 'You cannot take work right now',
      body: 'Your documents are still accepted. What has ended is your permission to take work, which is a separate thing — sending more documents will not change it.',
      cta: 'Contact support',
    },
    REVERIFICATION_REQUIRED: {
      title: 'Your verification needs renewing',
      body: 'Your documents were accepted before, but that verification has expired. Send fresh documents to start again.',
      cta: 'Renew verification',
    },
  },
  ar: {
    ACCOUNT_LOCKED: {
      title: 'حسابك مغلق',
      body: 'لا يمكنك استخدام المنصة بهذا الحساب. تواصل مع الدعم إذا كنت تعتقد أن هذا خطأ.',
      cta: 'تواصل مع الدعم',
    },
    SUSPENDED: {
      title: 'حسابك موقوف',
      body: 'التحقق متوقف مؤقتًا أثناء إيقاف حسابك. يمكنك تقديم اعتراض.',
      cta: 'تقديم اعتراض',
    },
    ONBOARDING_INCOMPLETE: {
      title: 'أكمل ملفك أولاً',
      body: 'أكمل خطوات التسجيل، ثم سنطلب منك مستنداتك.',
      cta: 'متابعة التسجيل',
    },
    NOT_REQUIRED: {
      title: 'لا حاجة إلى مستندات',
      body: 'لست بحاجة إلى توثيق مستندات للعمل الذي اخترته.',
      cta: null,
    },
    NOT_STARTED: {
      title: 'وثّق هويتك',
      body: 'العملاء يوظفون من يثقون به. أرسل لنا بعض المستندات وسنقوم بمراجعتها.',
      cta: 'ابدأ التوثيق',
    },
    EVIDENCE_REQUIRED: {
      title: 'أرسل لنا مستنداتك',
      body: 'أضف المستندات المذكورة أدناه. الصور المأخوذة بهاتفك مقبولة، ما دام المستند كاملاً وواضحًا.',
      cta: 'إضافة مستند',
    },
    SCANNING: {
      title: 'نتحقق من ملفاتك',
      body: 'نقوم بفحص الملفات التي أرسلتها. عادةً ما يستغرق ذلك لحظات — لا حاجة لفعل أي شيء.',
      cta: null,
    },
    EVIDENCE_UNUSABLE: {
      title: 'أحد ملفاتك غير قابل للاستخدام',
      body: 'الرجاء إرسال ذلك المستند مرة أخرى. التفاصيل أدناه.',
      cta: 'استبدال المستند',
    },
    READY_TO_SUBMIT: {
      title: 'جاهز للإرسال',
      body: 'كل ما طلبناه موجود. أرسله إلى فريقنا وسنقوم بمراجعته.',
      cta: 'إرسال للمراجعة',
    },
    PENDING_REVIEW: {
      title: 'لدى فريقنا',
      body: 'استلمنا مستنداتك. لا حاجة لفعل أي شيء — سنخبرك فور توفر جديد.',
      cta: null,
    },
    CHANGES_REQUESTED: {
      title: 'نحتاج إلى تعديل',
      body: 'راجع فريقنا مستنداتك ويحتاج إلى تصحيح أمر واحد قبل أن يتمكن من الإنهاء.',
      cta: 'استبدال المستند',
    },
    REJECTED: {
      title: 'تعذّر توثيقك',
      body: 'لم يتمكن فريقنا من توثيق مستنداتك. السبب موضح أدناه.',
      cta: 'ابدأ من جديد',
    },
    VERIFIED_ACTIVE: {
      title: 'تم توثيقك',
      body: 'تم قبول مستنداتك ويمكنك استلام الأعمال.',
      cta: null,
    },
    VERIFIED_NO_ACCESS: {
      title: 'لا يمكنك استلام أعمال حالياً',
      body: 'مستنداتك ما زالت مقبولة. ما انتهى هو صلاحيتك لاستلام الأعمال، وهي أمر منفصل — إرسال مستندات إضافية لن يغيّر ذلك.',
      cta: 'تواصل مع الدعم',
    },
    REVERIFICATION_REQUIRED: {
      title: 'توثيقك بحاجة إلى تجديد',
      body: 'تم قبول مستنداتك سابقًا، لكن صلاحية ذلك التوثيق انتهت. أرسل مستندات حديثة للبدء من جديد.',
      cta: 'تجديد التوثيق',
    },
  },
};

/** Why a reviewer asked for something, in the provider's own language.
 *
 *  Every code is written as a THING TO DO where one exists. "Document
 *  illegible" is a classification; "we could not read it — send a clearer
 *  photo" is something a person can act on, and the person reading it is
 *  usually anxious. */
export const REASON_COPY: Record<Lang, Record<string, string>> = {
  en: {
    DOCUMENT_MISSING: 'A document we asked for is missing.',
    DOCUMENT_ILLEGIBLE: 'We could not read it. Send a clearer photo in good light.',
    DOCUMENT_EXPIRED: 'That document has expired. Send a current one.',
    DOCUMENT_MISMATCH: 'The details do not match your profile.',
    SUSPECTED_FORGERY: 'We could not accept that document.',
    DUPLICATE_IDENTITY: 'These documents are already used by another account.',
    BUSINESS_NOT_REGISTERED: 'We could not find that business registration.',
    REPRESENTATIVE_NOT_AUTHORIZED: 'We need proof that you may act for this business.',
    LICENSE_MISSING_FOR_CATEGORY: 'A trade licence is missing for one of your services.',
    LICENSE_EXPIRED: 'Your trade licence has expired.',
    POLICY_PERIOD_ELAPSED: 'It has been a while since you were verified.',
    TRUST_AND_SAFETY_ACTION: 'Your verification was withdrawn.',
    PROVIDER_REQUESTED: 'You asked us to withdraw your verification.',
    DOCUMENTS_COMPLETE_AND_LEGIBLE: 'Your documents were accepted.',
    OTHER: 'Our team needs another look at your documents.',
  },
  ar: {
    DOCUMENT_MISSING: 'أحد المستندات المطلوبة غير موجود.',
    DOCUMENT_ILLEGIBLE: 'لم نتمكن من قراءته. أرسل صورة أوضح في إضاءة جيدة.',
    DOCUMENT_EXPIRED: 'انتهت صلاحية هذا المستند. أرسل مستندًا ساريًا.',
    DOCUMENT_MISMATCH: 'البيانات لا تطابق ملفك الشخصي.',
    SUSPECTED_FORGERY: 'لم نتمكن من قبول ذلك المستند.',
    DUPLICATE_IDENTITY: 'هذه المستندات مستخدمة بالفعل في حساب آخر.',
    BUSINESS_NOT_REGISTERED: 'لم نتمكن من العثور على هذا السجل التجاري.',
    REPRESENTATIVE_NOT_AUTHORIZED: 'نحتاج إلى إثبات أنه يحق لك التصرف باسم هذا النشاط.',
    LICENSE_MISSING_FOR_CATEGORY: 'رخصة المهنة غير موجودة لإحدى خدماتك.',
    LICENSE_EXPIRED: 'انتهت صلاحية رخصة المهنة.',
    POLICY_PERIOD_ELAPSED: 'مضى وقت طويل منذ توثيقك.',
    TRUST_AND_SAFETY_ACTION: 'تم سحب توثيقك.',
    PROVIDER_REQUESTED: 'طلبت منا سحب توثيقك.',
    DOCUMENTS_COMPLETE_AND_LEGIBLE: 'تم قبول مستنداتك.',
    OTHER: 'يحتاج فريقنا إلى إعادة النظر في مستنداتك.',
  },
};

/** Labels for the five axes, which the UI must keep visibly apart. */
export const AXIS_COPY: Record<Lang, Record<string, string>> = {
  en: {
    heading: 'Your status',
    onboardingComplete: 'Profile complete',
    identityVerified: 'Identity verified',
    workAccessActive: 'Can take work',
    vip: 'VIP',
    featured: 'Featured',
    yes: 'Yes',
    no: 'Not yet',
    badgeNote:
      'VIP and Featured are recognition only. They do not affect whether you can take work.',
  },
  ar: {
    heading: 'حالتك',
    onboardingComplete: 'الملف مكتمل',
    identityVerified: 'الهوية موثّقة',
    workAccessActive: 'يمكنك استلام الأعمال',
    vip: 'VIP',
    featured: 'مميّز',
    yes: 'نعم',
    no: 'ليس بعد',
    badgeNote: 'VIP و«مميّز» تقديرية فقط. لا تؤثر على إمكانية استلامك للأعمال.',
  },
};

/** Shared UI chrome for this surface. */
export const UI_COPY: Record<Lang, Record<string, string>> = {
  en: {
    loading: 'Loading your verification',
    loadFailed: 'We could not load your verification.',
    retry: 'Try again',
    offline: 'You are offline. We will retry when you are back.',
    documentsHeading: 'Your documents',
    requirementsHeading: 'What we need',
    noDocuments: 'Nothing sent yet.',
    replace: 'Replace',
    reasonHeading: 'What our team said',
    submitting: 'Sending',
    uploadLabel: 'Choose a document file',
  },
  ar: {
    loading: 'جارٍ تحميل حالة التوثيق',
    loadFailed: 'تعذر تحميل حالة التوثيق.',
    retry: 'أعد المحاولة',
    offline: 'أنت غير متصل. سنعيد المحاولة عند عودة الاتصال.',
    documentsHeading: 'مستنداتك',
    requirementsHeading: 'ما نحتاجه',
    noDocuments: 'لم يتم إرسال أي شيء بعد.',
    replace: 'استبدال',
    reasonHeading: 'ما قاله فريقنا',
    submitting: 'جارٍ الإرسال',
    uploadLabel: 'اختر ملف المستند',
  },
};

/** A reason code in the provider's language, falling back rather than showing
 *  a raw identifier to someone who cannot act on it. */
export function reasonText(lang: Lang, code: string | null): string {
  if (!code) return REASON_COPY[lang].OTHER;
  return REASON_COPY[lang][code] ?? REASON_COPY[lang].OTHER;
}
