import type { Lang } from './onboarding-hub-copy';

const LABELS: Record<string, { en: string; ar: string }> = {
  displayName: { en: 'Display name', ar: 'الاسم' },
  providerType: { en: 'Individual or business', ar: 'نوع المهني' },
  legalBusinessName: { en: 'Legal business name', ar: 'الاسم القانوني للمنشأة' },
  phoneNumber: { en: 'Phone number', ar: 'رقم الهاتف' },
  profileImageUrl: { en: 'Profile photo', ar: 'الصورة الشخصية' },
  verificationDocuments: { en: 'Verification documents', ar: 'وثائق التوثيق' },
  identityDocument: { en: 'Identity document', ar: 'وثيقة الهوية' },
  categoryLicense: { en: 'Professional licence', ar: 'رخصة المهنة' },
  specialties: { en: 'Selected services', ar: 'الخدمات المختارة' },
  equipmentCodes: { en: 'Equipment', ar: 'المعدات' },
  yearsOfExperience: { en: 'Years of experience', ar: 'سنوات الخبرة' },
  professionSince: { en: 'Career start date', ar: 'تاريخ بدء المهنة' },
  transportModes: { en: 'Transport', ar: 'وسائل النقل' },
  serviceAreaCity: { en: 'City and service area', ar: 'المدينة ومنطقة العمل' },
  workArea: { en: 'Service areas', ar: 'مناطق العمل' },
  radiusKm: { en: 'Travel radius', ar: 'نطاق التنقل' },
  workshopAddressLine: { en: 'Workshop address', ar: 'عنوان الورشة' },
  availability: { en: 'Weekly working hours', ar: 'ساعات العمل الأسبوعية' },
  timezone: { en: 'Time zone', ar: 'المنطقة الزمنية' },
  headline: { en: 'Professional headline', ar: 'العنوان المهني' },
  bio: { en: 'About the professional', ar: 'نبذة عن المهني' },
  portfolio: { en: 'Portfolio image', ar: 'صورة من معرض الأعمال' },
  consent: { en: 'Terms and consent', ar: 'الشروط والموافقة' },
};

export function reviewCorrectionFieldLabel(field: string | undefined, lang: Lang): string {
  return (field && LABELS[field]?.[lang]) || (lang === 'ar' ? 'الخطوة كاملة' : 'Whole step');
}
