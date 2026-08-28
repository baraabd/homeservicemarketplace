// Sprint 9B.17 — every string Task 1 renders.
//
// Codes on the wire, prose here — the same rule the rest of the codebase
// follows, and the reason an Arabic and an English provider are filling in the
// same form rather than two different ones.

export type Lang = 'en' | 'ar';

export interface BasicsCopy {
  heading: string;
  /** Individual vs business. */
  typeLegend: string;
  typeHint: string;
  individual: string;
  individualHint: string;
  business: string;
  businessHint: string;
  /** Shown when switching type would change what is being asked for. */
  typeChangeTitle: string;
  typeChangeBody: string;
  typeChangeConfirm: string;
  typeChangeCancel: string;
  legalName: string;
  legalNameHint: string;
  displayName: string;
  displayNameHint: string;
  phone: string;
  phoneHint: string;
  phoneInvalid: string;
  /** The sentence that keeps "we have your number" from reading as "your
   *  number is verified". */
  phoneNotVerified: string;
  required: string;
  saving: string;
  saved: string;
  saveFailed: string;
  saveRetry: string;
  saveConflict: string;
  offline: string;
}

export const BASICS_COPY: Record<Lang, BasicsCopy> = {
  en: {
    heading: 'Your details',
    typeLegend: 'How do you work?',
    typeHint: 'This changes what we ask for and what we need to verify.',
    individual: 'On my own',
    individualHint: 'You work as an individual tradesperson.',
    business: 'As a business',
    businessHint: 'You have a registered company.',
    typeChangeTitle: 'Change how you work?',
    typeChangeBody:
      'Switching changes the details we ask for and the documents we need to verify. Nothing you have already sent us is deleted, and anything already reviewed stays on your record.',
    typeChangeConfirm: 'Yes, change it',
    typeChangeCancel: 'Keep it as it is',
    legalName: 'Registered business name',
    legalNameHint: 'Exactly as it appears on your registration.',
    displayName: 'Name customers see',
    displayNameHint: 'This is the name shown on your profile and your bids.',
    phone: 'Phone number',
    phoneHint: 'Include your country code, for example +963912345678.',
    phoneInvalid: 'Enter a phone number in international format, starting with +.',
    phoneNotVerified:
      'We will confirm this number later. You do not need to confirm it to continue.',
    required: 'Required',
    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: 'Could not save',
    saveRetry: 'Try again',
    saveConflict: 'This application was changed somewhere else. Reload to see the latest version.',
    offline: 'You are offline. We will save this when you are back.',
  },
  ar: {
    heading: 'البيانات الأساسية',
    typeLegend: 'كيف تعمل؟',
    typeHint: 'هذا يغيّر ما نطلبه منك وما نحتاج إلى التحقق منه.',
    individual: 'بشكل فردي',
    individualHint: 'تعمل كحرفي مستقل.',
    business: 'كمنشأة',
    businessHint: 'لديك سجل تجاري.',
    typeChangeTitle: 'تغيير طريقة عملك؟',
    typeChangeBody:
      'التغيير يبدّل البيانات التي نطلبها والمستندات التي نحتاجها للتحقق. لن يُحذف أي شيء أرسلته سابقاً، وما تمت مراجعته يبقى في سجلك.',
    typeChangeConfirm: 'نعم، غيّرها',
    typeChangeCancel: 'إبقاؤها كما هي',
    legalName: 'الاسم التجاري المسجّل',
    legalNameHint: 'كما يظهر تماماً في السجل التجاري.',
    displayName: 'الاسم الذي يراه العملاء',
    displayNameHint: 'هذا هو الاسم الظاهر في ملفك وفي عروضك.',
    phone: 'رقم الهاتف',
    phoneHint: 'أضف رمز الدولة، مثال ‎+963912345678.',
    phoneInvalid: 'أدخل رقم هاتف بصيغة دولية تبدأ بعلامة +.',
    phoneNotVerified: 'سنؤكد هذا الرقم لاحقاً. لست بحاجة إلى تأكيده للمتابعة.',
    required: 'مطلوب',
    saving: 'جارٍ الحفظ…',
    saved: 'تم الحفظ',
    saveFailed: 'تعذّر الحفظ',
    saveRetry: 'إعادة المحاولة',
    saveConflict: 'تم تعديل هذا الطلب في مكان آخر. أعد التحميل لعرض أحدث نسخة.',
    offline: 'أنت غير متصل. سنحفظ هذا عند عودة الاتصال.',
  },
};

export interface AvatarCopy {
  title: string;
  hint: string;
  previewAlt: string;
  takePhoto: string;
  choose: string;
  replace: string;
  rotate: string;
  remove: string;
  processing: string;
  uploading: string;
  checking: string;
  retry: string;
  /** Keyed by the refusal code the server sends back, so a provider is told
   *  which thing went wrong rather than "upload failed". */
  failure: Record<string, string>;
}

export const AVATAR_COPY: Record<Lang, AvatarCopy> = {
  en: {
    title: 'Profile photo',
    hint: 'A clear photo of your face. Customers see this on every job.',
    previewAlt: 'Your profile photo',
    takePhoto: 'Take photo',
    choose: 'Choose photo',
    replace: 'Replace',
    rotate: 'Rotate',
    remove: 'Remove',
    processing: 'Preparing your photo…',
    uploading: 'Uploading…',
    checking: 'Checking the photo…',
    retry: 'Try again',
    failure: {
      UNSUPPORTED_TYPE: 'That file is not an image we can use.',
      TOO_LARGE: 'That image is too large.',
      FILE_TOO_LARGE: 'That image is too large.',
      DECODE_FAILED: 'We could not open that image.',
      ENCODE_FAILED: 'We could not prepare that image.',
      CONTENT_MISMATCH: 'That file is not a usable image.',
      NOT_AN_AVATAR_KEY: 'That file cannot be used as a photo.',
      FILE_MISSING: 'The upload did not finish. Please try again.',
      DISALLOWED_FORMAT: 'Use a JPEG, PNG or WebP image.',
      REMOVE_FAILED: 'Could not remove the photo.',
      UPLOAD_FAILED: 'Could not upload the photo.',
    },
  },
  ar: {
    title: 'الصورة الشخصية',
    hint: 'صورة واضحة لوجهك. يراها العملاء في كل طلب.',
    previewAlt: 'صورتك الشخصية',
    takePhoto: 'التقاط صورة',
    choose: 'اختيار صورة',
    replace: 'استبدال',
    rotate: 'تدوير',
    remove: 'إزالة',
    processing: 'جارٍ تجهيز الصورة…',
    uploading: 'جارٍ الرفع…',
    checking: 'جارٍ فحص الصورة…',
    retry: 'إعادة المحاولة',
    failure: {
      UNSUPPORTED_TYPE: 'هذا الملف ليس صورة يمكننا استخدامها.',
      TOO_LARGE: 'حجم الصورة كبير جداً.',
      FILE_TOO_LARGE: 'حجم الصورة كبير جداً.',
      DECODE_FAILED: 'تعذّر فتح هذه الصورة.',
      ENCODE_FAILED: 'تعذّر تجهيز هذه الصورة.',
      CONTENT_MISMATCH: 'هذا الملف ليس صورة صالحة.',
      NOT_AN_AVATAR_KEY: 'لا يمكن استخدام هذا الملف كصورة شخصية.',
      FILE_MISSING: 'لم يكتمل الرفع. يرجى المحاولة مرة أخرى.',
      DISALLOWED_FORMAT: 'استخدم صورة بصيغة JPEG أو PNG أو WebP.',
      REMOVE_FAILED: 'تعذّرت إزالة الصورة.',
      UPLOAD_FAILED: 'تعذّر رفع الصورة.',
    },
  },
};
