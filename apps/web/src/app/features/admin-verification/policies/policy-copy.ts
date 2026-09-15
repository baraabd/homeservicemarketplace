export const POLICY_COPY = {
  en: {
    title: 'Verification policies',
    eyebrow: 'Settings · Review requirements',
    description:
      'Define the documents required by country, provider type and specialty. Individual applications are reviewed in Review requests.',
    appendOnly:
      'Published versions are preserved. To change requirements, publish a new version; earlier cases keep their recorded policy.',
    newVersion: 'New version',
    formTitle: 'Define a new policy',
    formDescription: 'Choose the scope and documents, then review the impact before publishing.',
    history: 'Published versions',
    empty: 'No policy versions published.',
    version: 'Version name',
    versionHint: 'Use a unique name such as 2026.09-sy-v1. Published names cannot be changed.',
    country: 'Country',
    allCountries: 'All countries',
    disabledMarket: 'Not open to providers yet',
    providerType: 'Provider type',
    allTypes: 'Individuals and businesses',
    INDIVIDUAL: 'Individual',
    BUSINESS: 'Business',
    category: 'Specialty',
    allCategories: 'All specialties · Base policy',
    categoryHint:
      'A specialty policy adds its documents to the base requirements. A trade licence needs a specific specialty.',
    unknownCategory: 'Historical specialty',
    documents: 'Required documents',
    verificationOptional: 'Verification is not required under this version.',
    published: 'Effective from',
    retired: 'Stopped for new cases',
    ACTIVE: 'Active',
    SCHEDULED: 'Scheduled',
    RETIRED: 'Stopped',
    stop: 'Stop using this version',
    review: 'Review publication',
    cancel: 'Cancel',
    publish: 'Publish version',
    publishing: 'Publishing…',
    stopping: 'Stopping…',
    loading: 'Loading verification policies…',
    retry: 'Try again',
    loadFailed: 'We could not load the policies. Try again before making changes.',
    optionsFailed:
      'Country and specialty choices could not be loaded. Retry to prepare a new version.',
    forbiddenTitle: 'Policy management access required',
    forbiddenBody:
      'Your account cannot manage verification policies. Ask an administrator responsible for access to enable this permission.',
    confirmPublish: 'Publish these requirements?',
    publishImpact:
      'This version takes effect immediately for new cases that match its scope. It does not approve a provider or change the policy recorded on an earlier case.',
    confirmStop: 'Stop using this policy version?',
    stopImpact:
      'New cases will use another applicable policy. If no suitable policy remains, starting verification may be blocked. Existing cases and their recorded requirements are preserved.',
    publishedSuccess: 'The new policy version was published.',
    stoppedSuccess: 'The policy was stopped for new cases. Its history is preserved.',
    versionRequired: 'Enter a version name.',
    documentsRequired: 'Select at least one required document.',
    categoryRequired: 'Select a specialty for the trade licence requirement.',
    failed:
      'We could not confirm the change. Your selections are still here; check the current policy list before retrying.',
    overlap:
      'An active or scheduled version already covers this exact scope. Review that version before publishing its replacement.',
    invalidVersion: 'Use a version name in this format: 2026.09-sy-v1.',
    versionExists:
      'This version name has already been published. Choose a new name to preserve its history.',
    categoryUnavailable:
      'This specialty is no longer available. Reload the choices and select an active specialty.',
    countryUnavailable:
      'This country is not configured. Reload the choices or configure the market first.',
    alreadyRetired:
      'Another administrator has already stopped this version. Refresh the list to see its current state.',
    noLongerAllowed: 'Your permission to manage policies has changed. This action was not saved.',
    notYetPublished:
      'This version is scheduled for later and cannot be stopped through this action yet.',
    invalidRequirements:
      'These document requirements are not valid for the selected scope. Review the specialty and document selection.',
  },
  ar: {
    title: 'سياسات التوثيق',
    eyebrow: 'الإعدادات · متطلبات المراجعة',
    description:
      'حدّد الوثائق المطلوبة حسب البلد ونوع المهني والتخصص. تتم مراجعة ملفات المهنيين في «طلبات المراجعة».',
    appendOnly:
      'تُحفظ الإصدارات المنشورة دون تعديل. لتغيير المتطلبات، انشر إصدارًا جديدًا؛ وتحتفظ القضايا السابقة بالسياسة المسجلة عليها.',
    newVersion: 'إصدار جديد',
    formTitle: 'إعداد سياسة جديدة',
    formDescription: 'حدّد نطاق السياسة والوثائق، ثم راجع أثرها قبل النشر.',
    history: 'الإصدارات المنشورة',
    empty: 'لم تُنشر إصدارات للسياسات بعد.',
    version: 'اسم الإصدار',
    versionHint: 'استخدم اسمًا فريدًا مثل 2026.09-sy-v1. لا يمكن تغيير الاسم بعد النشر.',
    country: 'البلد',
    allCountries: 'جميع البلدان',
    disabledMarket: 'غير متاح للمهنيين بعد',
    providerType: 'نوع المهني',
    allTypes: 'الأفراد والشركات',
    INDIVIDUAL: 'فرد',
    BUSINESS: 'شركة',
    category: 'التخصص',
    allCategories: 'جميع التخصصات · سياسة أساسية',
    categoryHint:
      'تُضاف وثائق سياسة التخصص إلى المتطلبات الأساسية. تتطلب رخصة المهنة اختيار تخصص محدد.',
    unknownCategory: 'تخصص سابق',
    documents: 'الوثائق المطلوبة',
    verificationOptional: 'التوثيق غير مطلوب بموجب هذا الإصدار.',
    published: 'بداية السريان',
    retired: 'تاريخ الإيقاف للطلبات الجديدة',
    ACTIVE: 'سارية',
    SCHEDULED: 'مجدولة',
    RETIRED: 'موقوفة',
    stop: 'إيقاف استخدام الإصدار',
    review: 'مراجعة النشر',
    cancel: 'إلغاء',
    publish: 'نشر الإصدار',
    publishing: 'جارٍ النشر…',
    stopping: 'جارٍ الإيقاف…',
    loading: 'جارٍ تحميل سياسات التوثيق…',
    retry: 'إعادة المحاولة',
    loadFailed: 'تعذّر تحميل السياسات. أعد المحاولة قبل إجراء تغييرات.',
    optionsFailed: 'تعذّر تحميل البلدان والتخصصات. أعد المحاولة لإعداد إصدار جديد.',
    forbiddenTitle: 'يلزم إذن إدارة سياسات التوثيق',
    forbiddenBody:
      'لا يملك حسابك إذن إدارة سياسات التوثيق. تواصل مع المسؤول عن صلاحيات الوصول لتفعيله.',
    confirmPublish: 'هل تريد نشر هذه المتطلبات؟',
    publishImpact:
      'يسري الإصدار فورًا على القضايا الجديدة المطابقة لنطاقه. لا يمنح المهني موافقة، ولا يغيّر السياسة المسجلة على قضية سابقة.',
    confirmStop: 'هل تريد إيقاف استخدام هذا الإصدار؟',
    stopImpact:
      'ستستخدم القضايا الجديدة سياسة أخرى مطابقة. إذا لم تبقَ سياسة مناسبة فقد يتعذر بدء التوثيق. تبقى القضايا السابقة ومتطلباتها المسجلة محفوظة.',
    publishedSuccess: 'تم نشر إصدار السياسة الجديد.',
    stoppedSuccess: 'تم إيقاف السياسة للطلبات الجديدة مع حفظ سجلها.',
    versionRequired: 'أدخل اسم الإصدار.',
    documentsRequired: 'اختر وثيقة مطلوبة واحدة على الأقل.',
    categoryRequired: 'اختر التخصص المطلوب لرخصة المهنة.',
    failed:
      'تعذّر تأكيد حفظ التغيير. اختياراتك محفوظة هنا؛ راجع قائمة السياسات الحالية قبل إعادة المحاولة.',
    overlap: 'يوجد إصدار سارٍ أو مجدول يغطي النطاق نفسه. راجع ذلك الإصدار قبل نشر بديله.',
    invalidVersion: 'استخدم اسم إصدار بهذه الصيغة: 2026.09-sy-v1.',
    versionExists: 'سبق نشر اسم الإصدار هذا. اختر اسمًا جديدًا للحفاظ على السجل السابق.',
    categoryUnavailable: 'لم يعد هذا التخصص متاحًا. أعد تحميل الخيارات واختر تخصصًا فعالًا.',
    countryUnavailable: 'هذا البلد غير مُعدّ في النظام. أعد تحميل الخيارات أو أضف السوق أولًا.',
    alreadyRetired: 'أوقف مسؤول آخر هذا الإصدار. حدّث القائمة لعرض حالته الحالية.',
    noLongerAllowed: 'تغيّر إذن إدارة السياسات لحسابك. لم تُحفظ هذه العملية.',
    notYetPublished: 'هذا الإصدار مجدول لوقت لاحق ولا يمكن إيقافه من خلال هذه العملية حاليًا.',
    invalidRequirements: 'متطلبات الوثائق لا تتوافق مع النطاق المحدد. راجع اختيار التخصص والوثائق.',
  },
} as const;

export type PolicyLanguage = keyof typeof POLICY_COPY;

export function policyErrorMessage(error: unknown, lang: PolicyLanguage): string {
  const t = POLICY_COPY[lang];
  const response = (
    error as {
      response?: {
        status?: number;
        data?: { error?: { code?: string; details?: { reason?: string } } };
      };
    }
  )?.response;
  if (response?.status === 403) return t.noLongerAllowed;
  const reason = response?.data?.error?.details?.reason;
  if (reason === 'OVERLAPPING_POLICY') return t.overlap;
  if (reason === 'INVALID_VERSION') return t.invalidVersion;
  if (reason === 'VERSION_EXISTS') return t.versionExists;
  if (reason === 'POLICY_CATEGORY_UNAVAILABLE') return t.categoryUnavailable;
  if (reason === 'POLICY_COUNTRY_UNAVAILABLE') return t.countryUnavailable;
  if (reason === 'ALREADY_RETIRED') return t.alreadyRetired;
  if (reason === 'NOT_YET_PUBLISHED') return t.notYetPublished;
  if (reason === 'CATEGORY_SCOPE_MISMATCH') return t.categoryRequired;
  if (response?.status === 409) return t.overlap;
  if (response?.status === 400) return t.invalidRequirements;
  return t.failed;
}

export function policyCountryName(country: string | null, lang: PolicyLanguage): string {
  if (!country) return POLICY_COPY[lang].allCountries;
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(country) ?? country;
  } catch {
    return country;
  }
}
