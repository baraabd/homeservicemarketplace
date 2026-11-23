import type { LegalDocumentKind } from '@homeservicemarketplace/contracts';

// K02 — public Arabic/English policy pages.
//
// STATUS: DRAFT. Every document here is a working draft prepared by
// engineering from what the product actually does. None is approved by the
// operator or by legal counsel, none is in force, and the pages say so. The
// accountable owner must supply the items marked "pending" (operator
// identity, contact channel, prices, tax treatment, refund policy, retention
// periods, hosting region) and approve the text — see
// docs/production-readiness/ksa-launch/K02/OWNER_DECISIONS.md.
//
// Versioning: `version` MUST equal the server registry
// (packages/contracts/src/iam/legal/legal-documents.ts). legal-copy.test.ts
// fails when they drift. A changed text needs a NEW version id in both.
//
// Nothing here invents a fact. Where a fact is not decided, the text says it
// is pending rather than guessing.

export type LegalPageId = 'terms' | 'privacy' | 'operator' | 'contact' | 'subscriptions';
export type LegalLang = 'en' | 'ar';

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalPageCopy {
  title: string;
  summary: string;
  sections: LegalSection[];
}

export const LEGAL_PAGE_IDS: readonly LegalPageId[] = [
  'terms',
  'privacy',
  'operator',
  'contact',
  'subscriptions',
];

/** Which pages are accepted at signup, and their server document kind. */
export const ACCEPTED_DOCUMENTS: Readonly<Record<'terms' | 'privacy', LegalDocumentKind>> = {
  terms: 'TERMS_OF_SERVICE',
  privacy: 'PRIVACY_NOTICE',
};

/** Draft versions shown on the page; must equal the server registry. */
export const LEGAL_COPY_VERSIONS = {
  terms: 'ksa-terms-2026-11-03.draft-1',
  privacy: 'ksa-privacy-2026-11-03.draft-1',
} as const;

export const LEGAL_CHROME: Record<
  LegalLang,
  {
    draftBanner: string;
    version: string;
    back: string;
    close: string;
    openFullPage: string;
    otherPages: string;
    navLabel: string;
    notFound: string;
  }
> = {
  en: {
    draftBanner:
      'Draft for review — not yet approved by the operator or legal counsel and not in force. Items marked “pending” are not decided.',
    version: 'Version',
    back: 'Back',
    close: 'Close',
    openFullPage: 'Open as a full page in a new tab',
    otherPages: 'Other public information',
    navLabel: 'Legal and contact pages',
    notFound: 'This page does not exist.',
  },
  ar: {
    draftBanner:
      'مسودة للمراجعة — لم يعتمدها المشغّل أو المستشار القانوني بعد، وليست سارية. البنود الموسومة «قيد الاعتماد» لم يُبت فيها.',
    version: 'الإصدار',
    back: 'رجوع',
    close: 'إغلاق',
    openFullPage: 'فتح كصفحة كاملة في علامة تبويب جديدة',
    otherPages: 'معلومات عامة أخرى',
    navLabel: 'الصفحات القانونية وصفحة التواصل',
    notFound: 'هذه الصفحة غير موجودة.',
  },
};

const PENDING_EN = 'Pending owner approval.';
const PENDING_AR = 'قيد اعتماد المشغّل.';

export const LEGAL_PAGES: Record<LegalPageId, Record<LegalLang, LegalPageCopy>> = {
  terms: {
    en: {
      title: 'Terms of Service',
      summary:
        'The rules for using the marketplace to request home services and to offer them as a provider in Saudi Arabia.',
      sections: [
        {
          heading: 'What the service is',
          paragraphs: [
            'The platform connects customers who post a home-service request with independent providers who send offers. A customer chooses an offer; the booking is an agreement between the customer and the provider.',
            'The platform does not collect, hold or pay out the price of a booking. Prices shown on bids and bookings are in Saudi riyals (SAR) and are agreed between the customer and the provider.',
          ],
        },
        {
          heading: 'Accounts',
          paragraphs: [
            'You must give accurate information, keep your password secret and tell us if you think your account was used without permission. We confirm your email address with a one-time code before the account is active.',
            'Phone numbers you add are not verified by text message.',
          ],
        },
        {
          heading: 'Providers',
          paragraphs: [
            'Providers apply through onboarding, agree to the separate provider terms shown there, and are reviewed before they can receive work. Approval of an application is not an endorsement of any job.',
            'Provider subscription plans, if offered, are described on the Subscriptions page.',
          ],
        },
        {
          heading: 'Conduct and content',
          paragraphs: [
            'Do not post unlawful, misleading or abusive content, contact details meant to bypass the platform’s safety features, or images of other people without their permission. We may remove content and restrict accounts that break these rules.',
          ],
        },
        {
          heading: 'Disputes and support',
          paragraphs: [
            'Use in-app Help to raise a problem with a booking. The dispute process, its time limits and how decisions are made: ' +
              PENDING_EN,
          ],
        },
        {
          heading: 'Operator, governing law and changes',
          paragraphs: [
            'The legal entity operating the platform is named on the Operator page. Governing law, liability limits and venue: ' +
              PENDING_EN,
            'When these terms change we publish a new version. You will be asked to accept a new version before it applies to you.',
          ],
        },
      ],
    },
    ar: {
      title: 'شروط الخدمة',
      summary:
        'قواعد استخدام المنصة لطلب الخدمات المنزلية ولتقديمها كمزوّد خدمة في المملكة العربية السعودية.',
      sections: [
        {
          heading: 'ما هي الخدمة',
          paragraphs: [
            'تربط المنصة العملاء الذين ينشرون طلب خدمة منزلية بمزوّدي خدمات مستقلين يرسلون عروضهم. يختار العميل عرضاً، ويكون الحجز اتفاقاً بين العميل والمزوّد.',
            'لا تحصّل المنصة سعر الحجز ولا تحتفظ به ولا تدفعه. الأسعار المعروضة في العروض والحجوزات بالريال السعودي ويتفق عليها العميل والمزوّد.',
          ],
        },
        {
          heading: 'الحسابات',
          paragraphs: [
            'يجب أن تقدّم معلومات صحيحة، وأن تحافظ على سرية كلمة المرور، وأن تبلغنا إذا ظننت أن حسابك استُخدم دون إذنك. نتحقق من بريدك الإلكتروني برمز لمرة واحدة قبل تفعيل الحساب.',
            'أرقام الهواتف التي تضيفها لا يتم التحقق منها برسالة نصية.',
          ],
        },
        {
          heading: 'مزوّدو الخدمة',
          paragraphs: [
            'يتقدّم المزوّدون عبر خطوات التسجيل، ويوافقون على شروط المزوّدين المنفصلة المعروضة هناك، وتُراجَع طلباتهم قبل أن يتلقوا أي عمل. قبول الطلب ليس تزكية لأي عمل بعينه.',
            'خطط اشتراك المزوّدين، إن وُجدت، موضّحة في صفحة الاشتراكات.',
          ],
        },
        {
          heading: 'السلوك والمحتوى',
          paragraphs: [
            'لا تنشر محتوى مخالفاً للأنظمة أو مضللاً أو مسيئاً، ولا بيانات تواصل بقصد تجاوز ميزات الأمان في المنصة، ولا صور أشخاص آخرين دون إذنهم. يجوز لنا إزالة المحتوى وتقييد الحسابات المخالفة.',
          ],
        },
        {
          heading: 'النزاعات والدعم',
          paragraphs: [
            'استخدم «المساعدة» داخل التطبيق للإبلاغ عن مشكلة في حجز. إجراءات النزاع ومُددها وطريقة اتخاذ القرار: ' +
              PENDING_AR,
          ],
        },
        {
          heading: 'المشغّل والنظام الحاكم والتعديلات',
          paragraphs: [
            'الكيان النظامي المشغّل للمنصة مذكور في صفحة المشغّل. النظام الحاكم وحدود المسؤولية وجهة الاختصاص: ' +
              PENDING_AR,
            'عند تعديل هذه الشروط ننشر إصداراً جديداً، ويُطلب منك قبوله قبل أن يسري عليك.',
          ],
        },
      ],
    },
  },
  privacy: {
    en: {
      title: 'Privacy Notice',
      summary:
        'What personal data the platform processes, why, who can see it and how to exercise your rights under the Saudi Personal Data Protection Law (PDPL).',
      sections: [
        {
          heading: 'Data we process',
          paragraphs: [
            'Account: name, email address, a one-way hash of your password, sign-in and security records (such as device and IP address).',
            'Requests and bookings: the service you need, its description, photos or videos you choose to add, the address or map point you give, the time you choose, and messages between you and the provider.',
            'Providers: profile details, service categories, work area, availability, an optional phone number, and the verification evidence requested during onboarding.',
          ],
        },
        {
          heading: 'Why we process it',
          paragraphs: [
            'To create and secure your account, match requests with providers in the service area, operate bookings, messages, reviews and support, review provider applications, prevent abuse, and meet legal obligations. The lawful basis for each purpose: ' +
              PENDING_EN,
          ],
        },
        {
          heading: 'Identity documents',
          paragraphs: [
            'Copies of official identity documents are handled as restricted data: only authorised reviewers can open them, and every access is recorded. Whether a copy is required, on which legal basis, and the alternative offered when a copy is not justified: ' +
              PENDING_EN,
          ],
        },
        {
          heading: 'Who can see it',
          paragraphs: [
            'A provider sees the request details needed to send an offer; exact contact and address details are shared as the booking requires. Authorised staff see what their role needs. We do not sell personal data. Service providers that host or process data for us, and the country where data is stored: ' +
              PENDING_EN,
          ],
        },
        {
          heading: 'Retention',
          paragraphs: [
            'How long each category is kept, and when it is deleted or anonymised: ' + PENDING_EN,
          ],
        },
        {
          heading: 'Your rights',
          paragraphs: [
            'Under the PDPL you may ask to be informed, to access and obtain a copy of your data, to correct it, to have it destroyed when it is no longer needed, and to withdraw consent where processing relies on consent. How to send a request and the response time: ' +
              PENDING_EN,
          ],
        },
        {
          heading: 'Changes',
          paragraphs: [
            'When this notice changes we publish a new version and tell you before it applies.',
          ],
        },
      ],
    },
    ar: {
      title: 'إشعار الخصوصية',
      summary:
        'ما البيانات الشخصية التي تعالجها المنصة، ولماذا، ومن يمكنه الاطلاع عليها، وكيف تمارس حقوقك وفق نظام حماية البيانات الشخصية في المملكة.',
      sections: [
        {
          heading: 'البيانات التي نعالجها',
          paragraphs: [
            'الحساب: الاسم، والبريد الإلكتروني، وتجزئة أحادية الاتجاه لكلمة المرور، وسجلات الدخول والأمان (مثل الجهاز وعنوان IP).',
            'الطلبات والحجوزات: الخدمة المطلوبة ووصفها، والصور أو المقاطع التي تختار إضافتها، والعنوان أو النقطة على الخريطة، والوقت الذي تختاره، والرسائل بينك وبين المزوّد.',
            'المزوّدون: بيانات الملف الشخصي، وفئات الخدمة، ونطاق العمل، والتوفر، ورقم هاتف اختياري، ووثائق التحقق المطلوبة أثناء التسجيل.',
          ],
        },
        {
          heading: 'لماذا نعالجها',
          paragraphs: [
            'لإنشاء حسابك وحمايته، ومطابقة الطلبات مع المزوّدين في نطاق الخدمة، وتشغيل الحجوزات والرسائل والتقييمات والدعم، ومراجعة طلبات المزوّدين، ومنع إساءة الاستخدام، والوفاء بالالتزامات النظامية. الأساس النظامي لكل غرض: ' +
              PENDING_AR,
          ],
        },
        {
          heading: 'وثائق الهوية',
          paragraphs: [
            'تُعامل نسخ وثائق الهوية الرسمية كبيانات مقيّدة: لا يفتحها إلا المراجعون المخوّلون، ويُسجَّل كل اطلاع عليها. هل النسخة مطلوبة، وعلى أي أساس نظامي، والبديل المتاح حين لا يكون النسخ مبرراً: ' +
              PENDING_AR,
          ],
        },
        {
          heading: 'من يطّلع عليها',
          paragraphs: [
            'يرى المزوّد تفاصيل الطلب اللازمة لتقديم عرض، وتُشارك بيانات التواصل والعنوان الدقيقة بالقدر الذي يتطلبه الحجز. يرى الموظفون المخوّلون ما يحتاجه دورهم. لا نبيع البيانات الشخصية. الجهات التي تستضيف البيانات أو تعالجها لصالحنا، والدولة التي تُخزَّن فيها: ' +
              PENDING_AR,
          ],
        },
        {
          heading: 'مدة الاحتفاظ',
          paragraphs: ['مدة الاحتفاظ بكل فئة، ومتى تُتلف أو تُجهَّل: ' + PENDING_AR],
        },
        {
          heading: 'حقوقك',
          paragraphs: [
            'يحق لك وفق النظام أن تُبلَّغ، وأن تطّلع على بياناتك وتحصل على نسخة منها، وأن تصححها، وأن تطلب إتلافها حين لا تعود لازمة، وأن تسحب موافقتك حيث تقوم المعالجة على الموافقة. طريقة تقديم الطلب ومدة الرد: ' +
              PENDING_AR,
          ],
        },
        {
          heading: 'التعديلات',
          paragraphs: ['عند تعديل هذا الإشعار ننشر إصداراً جديداً ونبلغك قبل سريانه.'],
        },
      ],
    },
  },
  operator: {
    en: {
      title: 'Operator',
      summary: 'Who operates this platform.',
      sections: [
        {
          heading: 'Legal entity',
          paragraphs: [
            'Registered name, commercial registration number, VAT number (if registered) and registered address: ' +
              PENDING_EN,
          ],
        },
      ],
    },
    ar: {
      title: 'المشغّل',
      summary: 'من يشغّل هذه المنصة.',
      sections: [
        {
          heading: 'الكيان النظامي',
          paragraphs: [
            'الاسم المسجّل، ورقم السجل التجاري، والرقم الضريبي (إن وُجد)، والعنوان المسجّل: ' +
              PENDING_AR,
          ],
        },
      ],
    },
  },
  contact: {
    en: {
      title: 'Contact',
      summary: 'How to reach us.',
      sections: [
        {
          heading: 'Signed-in users',
          paragraphs: [
            'Use Help inside the app to open a support ticket about your account or a booking.',
          ],
        },
        {
          heading: 'Everyone else',
          paragraphs: ['Public contact email, phone and postal address: ' + PENDING_EN],
        },
      ],
    },
    ar: {
      title: 'تواصل معنا',
      summary: 'كيف تصل إلينا.',
      sections: [
        {
          heading: 'المستخدمون المسجّلون',
          paragraphs: ['استخدم «المساعدة» داخل التطبيق لفتح تذكرة دعم بخصوص حسابك أو حجز.'],
        },
        {
          heading: 'الآخرون',
          paragraphs: [
            'البريد الإلكتروني ورقم الهاتف والعنوان البريدي للتواصل العام: ' + PENDING_AR,
          ],
        },
      ],
    },
  },
  subscriptions: {
    en: {
      title: 'Provider subscriptions',
      summary: 'The commercial terms for provider subscription plans.',
      sections: [
        {
          heading: 'What is sold',
          paragraphs: [
            'The platform’s only charge is an optional subscription bought by providers. Customers pay nothing to the platform, and the platform does not take a fee from bookings.',
          ],
        },
        {
          heading: 'Prices, tax and invoices',
          paragraphs: [
            'Plan prices in SAR, whether VAT applies and how invoices are issued: ' + PENDING_EN,
          ],
        },
        {
          heading: 'Cancellation and refunds',
          paragraphs: [
            'When a subscription can be cancelled and when a refund is given: ' + PENDING_EN,
          ],
        },
      ],
    },
    ar: {
      title: 'اشتراكات المزوّدين',
      summary: 'الشروط التجارية لخطط اشتراك المزوّدين.',
      sections: [
        {
          heading: 'ما الذي يُباع',
          paragraphs: [
            'الرسم الوحيد في المنصة اشتراك اختياري يشتريه المزوّدون. لا يدفع العملاء أي شيء للمنصة، ولا تأخذ المنصة عمولة من الحجوزات.',
          ],
        },
        {
          heading: 'الأسعار والضريبة والفواتير',
          paragraphs: [
            'أسعار الخطط بالريال، وهل تنطبق ضريبة القيمة المضافة، وكيف تُصدر الفواتير: ' +
              PENDING_AR,
          ],
        },
        {
          heading: 'الإلغاء والاسترداد',
          paragraphs: ['متى يمكن إلغاء الاشتراك ومتى يُسترد المبلغ: ' + PENDING_AR],
        },
      ],
    },
  },
};

export function isLegalPageId(value: string | undefined): value is LegalPageId {
  return value !== undefined && (LEGAL_PAGE_IDS as readonly string[]).includes(value);
}

/** Public route of a policy page; equals the server registry `path`. */
export function legalPath(id: LegalPageId): string {
  return `/legal/${id}`;
}
